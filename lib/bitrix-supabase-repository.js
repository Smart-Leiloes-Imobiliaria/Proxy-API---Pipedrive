"use strict";

const crypto = require("crypto");

function createBitrixSupabaseRepository(options) {
  const opt = options || {};
  const fetchImpl = opt.fetchImpl || global.fetch;
  const baseUrl = trustedSupabaseUrl_(opt.supabaseUrl || process.env.SUPABASE_URL);
  const secretKey = required_(opt.supabaseSecretKey || process.env.SUPABASE_SECRET_KEY, "missing_supabase_secret_key");
  const encryptionKey = parseEncryptionKey_(opt.encryptionKey || process.env.BITRIX_TOKEN_ENCRYPTION_KEY);
  const timeoutMs = positiveInt_(opt.timeoutMs || process.env.SUPABASE_FETCH_TIMEOUT_MS) || 10000;

  async function request_(path, init) {
    let response;
    try {
      response = await fetchImpl(baseUrl + "/rest/v1/" + path, Object.assign({}, init, {
        headers: Object.assign({
          apikey: secretKey,
          authorization: "Bearer " + secretKey,
          accept: "application/json",
          "content-type": "application/json"
        }, init && init.headers || {}),
        signal: AbortSignal.timeout(timeoutMs)
      }));
    } catch (_) {
      throw error_("supabase_unavailable", 503);
    }
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) {}
    if (!response.ok) {
      const error = error_(response.status === 409 ? "supabase_conflict" : "supabase_request_failed", response.status === 409 ? 409 : 503);
      error.upstreamStatus = response.status;
      throw error;
    }
    return payload;
  }

  async function getByMemberId(memberId) {
    const id = required_(memberId, "missing_member_id");
    const rows = await request_("bitrix_installations?select=*&member_id=eq." + encodeURIComponent(id) + "&limit=1", { method: "GET" });
    return Array.isArray(rows) && rows[0] ? hydrateInstallation_(rows[0], encryptionKey) : null;
  }

  async function getSoleInstallation() {
    const rows = await request_("bitrix_installations?select=*&order=created_at.asc&limit=2", { method: "GET" });
    return Array.isArray(rows) && rows.length === 1 ? hydrateInstallation_(rows[0], encryptionKey) : null;
  }

  async function countInstallations() {
    const rows = await request_("bitrix_installations?select=member_id&limit=2", { method: "GET" });
    return Array.isArray(rows) ? rows.length : 0;
  }

  async function saveInstallation(input) {
    const installation = normalizeInstallation_(input);
    const row = {
      member_id: installation.member_id,
      domain: installation.domain,
      client_endpoint: installation.client_endpoint,
      server_endpoint: installation.server_endpoint,
      scope: installation.scope,
      access_token_ciphertext: encrypt_(installation.access_token, encryptionKey, installation.member_id + ":access_token"),
      refresh_token_ciphertext: encrypt_(installation.refresh_token, encryptionKey, installation.member_id + ":refresh_token"),
      application_token_ciphertext: encrypt_(installation.application_token, encryptionKey, installation.member_id + ":application_token"),
      access_token_expires_at: new Date(installation.expires_at).toISOString(),
      updated_at: new Date().toISOString()
    };
    const rows = await request_("bitrix_installations?on_conflict=member_id", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row)
    });
    if (!Array.isArray(rows) || !rows[0]) throw error_("supabase_installation_not_saved", 503);
    return hydrateInstallation_(rows[0], encryptionKey);
  }

  async function updateTokens(memberId, tokens) {
    const id = required_(memberId, "missing_member_id");
    const accessToken = required_(tokens && tokens.access_token, "missing_access_token");
    const refreshToken = required_(tokens && tokens.refresh_token, "missing_refresh_token");
    const patch = {
      access_token_ciphertext: encrypt_(accessToken, encryptionKey, id + ":access_token"),
      refresh_token_ciphertext: encrypt_(refreshToken, encryptionKey, id + ":refresh_token"),
      access_token_expires_at: new Date(Number(tokens.expires_at) || Date.now() + 3600000).toISOString(),
      updated_at: new Date().toISOString()
    };
    const rows = await request_("bitrix_installations?member_id=eq." + encodeURIComponent(id), {
      method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify(patch)
    });
    if (!Array.isArray(rows) || !rows[0]) throw error_("bitrix_installation_not_found", 404);
    return hydrateInstallation_(rows[0], encryptionKey);
  }

  async function updateBinding(memberId, status, errorCode) {
    const patch = {
      event_binding_status: String(status || "pending"),
      event_binding_error: errorCode ? String(errorCode).slice(0, 120) : null,
      event_bound_at: status === "bound" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    };
    await request_("bitrix_installations?member_id=eq." + encodeURIComponent(required_(memberId, "missing_member_id")), {
      method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(patch)
    });
  }

  async function enqueueJob(job) {
    const row = normalizeJob_(job);
    try {
      const rows = await request_("bitrix_evaluation_jobs", {
        method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(row)
      });
      return { inserted: true, job: Array.isArray(rows) ? rows[0] : null };
    } catch (error) {
      if (error && error.code === "supabase_conflict") return { inserted: false, job: null };
      throw error;
    }
  }

  async function claimJobs(limit) {
    const rows = await request_("rpc/claim_bitrix_evaluation_jobs", {
      method: "POST",
      body: JSON.stringify({ max_jobs: Math.min(10, positiveInt_(limit) || 2) })
    });
    return Array.isArray(rows) ? rows : [];
  }

  async function completeJob(id, status) {
    const normalized = ["completed", "not_evaluable"].includes(status) ? status : "completed";
    await patchJob_(id, {
      status: normalized,
      last_error: null,
      completed_at: new Date().toISOString(),
      locked_at: null,
      updated_at: new Date().toISOString()
    });
  }

  async function failJob(job, errorCode, maxAttempts) {
    const attempts = positiveInt_(job && job.attempts);
    const retry = attempts < (positiveInt_(maxAttempts) || 5);
    const delayMinutes = Math.min(60, Math.max(1, 2 ** Math.max(0, attempts - 1)));
    await patchJob_(job && job.id, {
      status: "failed",
      last_error: safeCode_(errorCode),
      next_attempt_at: retry ? new Date(Date.now() + delayMinutes * 60000).toISOString() : null,
      locked_at: null,
      updated_at: new Date().toISOString()
    });
  }

  async function patchJob_(id, patch) {
    await request_("bitrix_evaluation_jobs?id=eq." + encodeURIComponent(required_(id, "missing_job_id")), {
      method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(patch)
    });
  }

  return {
    getByMemberId,
    getSoleInstallation,
    countInstallations,
    saveInstallation,
    updateTokens,
    updateBinding,
    enqueueJob,
    claimJobs,
    completeJob,
    failJob
  };
}

function normalizeInstallation_(input) {
  const value = input || {};
  const expiresIn = positiveInt_(value.expires_in) || 3600;
  return {
    member_id: required_(value.member_id, "missing_member_id"),
    domain: required_(value.domain, "missing_domain").toLowerCase(),
    client_endpoint: trustedBitrixEndpoint_(value.client_endpoint),
    server_endpoint: trustedOAuthEndpoint_(value.server_endpoint || "https://oauth.bitrix.info/rest/"),
    scope: required_(value.scope, "missing_scope"),
    access_token: required_(value.access_token, "missing_access_token"),
    refresh_token: required_(value.refresh_token, "missing_refresh_token"),
    application_token: required_(value.application_token, "missing_application_token"),
    expires_at: Number(value.expires_at) || Date.now() + expiresIn * 1000
  };
}

function normalizeJob_(input) {
  const job = input || {};
  return {
    event_key: required_(job.event_key, "missing_event_key"),
    member_id: required_(job.member_id, "missing_member_id"),
    event_id: positiveInt_(job.event_id),
    session_id: requiredPositiveInt_(job.session_id, "invalid_session_id"),
    chat_id: requiredPositiveInt_(job.chat_id, "invalid_chat_id"),
    line_id: positiveInt_(job.line_id) || null,
    connector_id: clean_(job.connector_id) || null,
    user_id: positiveInt_(job.user_id) || null,
    status: "pending",
    attempts: 0,
    received_at: new Date(job.received_at || Date.now()).toISOString(),
    next_attempt_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function hydrateInstallation_(row, key) {
  return Object.assign({}, row, {
    access_token: decrypt_(row.access_token_ciphertext, key, row.member_id + ":access_token"),
    refresh_token: decrypt_(row.refresh_token_ciphertext, key, row.member_id + ":refresh_token"),
    application_token: decrypt_(row.application_token_ciphertext, key, row.member_id + ":application_token"),
    expires_at: Date.parse(row.access_token_expires_at || "") || 0
  });
}

function encrypt_(value, key, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(required_(value, "missing_secret"), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

function decrypt_(value, key, aad) {
  const parts = clean_(value).split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw error_("bitrix_token_decryption_failed", 500);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch (_) {
    throw error_("bitrix_token_decryption_failed", 500);
  }
}

function parseEncryptionKey_(value) {
  const raw = required_(value, "missing_bitrix_token_encryption_key");
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw error_("invalid_bitrix_token_encryption_key", 500);
  return key;
}

function trustedSupabaseUrl_(value) {
  let parsed;
  try { parsed = new URL(required_(value, "missing_supabase_url")); } catch (_) { throw error_("invalid_supabase_url", 500); }
  if (parsed.protocol !== "https:" || !/\.supabase\.co$/i.test(parsed.hostname)) throw error_("invalid_supabase_url", 500);
  return parsed.origin;
}

function trustedBitrixEndpoint_(value) {
  let parsed;
  try { parsed = new URL(required_(value, "missing_client_endpoint")); } catch (_) { throw error_("bitrix_untrusted_client_endpoint", 400); }
  if (parsed.protocol !== "https:" || !/\.bitrix24\.(com|com\.br|eu|de|fr|es|in|cn)$/i.test(parsed.hostname)) throw error_("bitrix_untrusted_client_endpoint", 400);
  return parsed.toString();
}

function trustedOAuthEndpoint_(value) {
  let parsed;
  try { parsed = new URL(required_(value, "missing_server_endpoint")); } catch (_) { throw error_("bitrix_untrusted_server_endpoint", 400); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "oauth.bitrix.info") throw error_("bitrix_untrusted_server_endpoint", 400);
  return parsed.toString();
}

function requiredPositiveInt_(value, code) { const result = positiveInt_(value); if (!result) throw error_(code, 400); return result; }
function positiveInt_(value) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : 0; }
function required_(value, code) { const result = clean_(value); if (!result) throw error_(code, 500); return result; }
function clean_(value) { return String(value == null ? "" : value).trim(); }
function safeCode_(value) { const code = clean_(value); return /^[a-z0-9_]+$/i.test(code) ? code : "bitrix_job_failed"; }
function error_(code, statusCode) { const error = new Error(code); error.code = code; error.statusCode = statusCode; return error; }

module.exports = { createBitrixSupabaseRepository, encrypt_, decrypt_, parseEncryptionKey_ };
