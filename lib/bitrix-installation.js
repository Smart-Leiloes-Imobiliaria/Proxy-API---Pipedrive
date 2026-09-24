"use strict";

const { parseBitrixRequestBody, requestSizeAllowed } = require("./bitrix-request.js");
const { createBitrixClient } = require("./bitrix-client.js");
const { createBitrixSupabaseRepository } = require("./bitrix-supabase-repository.js");

async function handleBitrixInstallation(input, dependencies) {
  if (String(input && input.method || "").toUpperCase() !== "POST") return result_(405, { success: false, error: "method_not_allowed" });
  if (!requestSizeAllowed(input && input.body)) return result_(413, { success: false, error: "payload_too_large" });

  const services = dependencies || createInstallationServices();
  try {
    const body = parseBitrixRequestBody(input && input.body);
    const auth = normalizeAuth_(body);
    validatePortal_(auth);
    validateScope_(auth.scope);

    const existing = await services.installationRepository.getByMemberId(auth.member_id);
    if (!existing && clean_(process.env.BITRIX_SINGLE_TENANT || "true").toLowerCase() !== "false") {
      const count = await services.installationRepository.countInstallations();
      if (count > 0) return result_(403, { success: false, error: "bitrix_tenant_already_installed" });
    }

    await services.verifyAuth(auth);
    const installation = await services.installationRepository.saveInstallation(auth);
    let bound = false;
    let bindingError = "";
    try {
      bound = await services.bindOnSessionFinish(installation);
      await services.installationRepository.updateBinding(auth.member_id, bound ? "bound" : "pending", bound ? "" : "bitrix_event_binding_not_confirmed");
    } catch (error) {
      bindingError = safeCode_(error, "bitrix_event_binding_failed");
      await services.installationRepository.updateBinding(auth.member_id, "pending", bindingError);
    }

    return result_(200, {
      success: true,
      status: bound ? "installed" : "installed_binding_pending",
      member_id: auth.member_id,
      events_bound: bound ? ["ONSESSIONFINISH"] : [],
      binding_error: bound ? undefined : bindingError || "bitrix_event_binding_not_confirmed"
    });
  } catch (error) {
    return result_(Number(error && error.statusCode) || 400, { success: false, error: safeCode_(error, "bitrix_installation_failed") });
  }
}

function createInstallationServices(options) {
  const opt = options || {};
  const repository = opt.installationRepository || createBitrixSupabaseRepository(opt);
  const fetchImpl = opt.fetchImpl || global.fetch;
  const client = createBitrixClient({ installationRepository: repository, fetchImpl, config: opt.bitrixConfig });
  return {
    installationRepository: repository,
    verifyAuth: (auth) => verifyAuth_(auth, fetchImpl),
    bindOnSessionFinish: async (installation) => {
      const handler = trustedHandlerUrl_(opt.eventHandlerUrl || process.env.BITRIX_EVENT_HANDLER_URL || "https://api-zendesk-vercel-proxy.vercel.app/api/bitrix/events");
      await client.callMethod(installation.member_id, "event.bind", { event: "ONSESSIONFINISH", handler });
      const bindings = await client.callMethod(installation.member_id, "event.get", {});
      return JSON.stringify(bindings || []).toUpperCase().includes("ONSESSIONFINISH");
    }
  };
}

function normalizeAuth_(body) {
  const nested = body && body.auth && typeof body.auth === "object" ? body.auth : {};
  const domain = clean_(nested.domain || body.DOMAIN || body.domain).toLowerCase();
  const clientEndpoint = clean_(nested.client_endpoint || body.client_endpoint || (domain ? "https://" + domain + "/rest/" : ""));
  return {
    access_token: clean_(nested.access_token || body.AUTH_ID || body.access_token),
    refresh_token: clean_(nested.refresh_token || body.REFRESH_ID || body.refresh_token),
    expires_in: positiveInt_(nested.expires_in || body.AUTH_EXPIRES || body.expires_in) || 3600,
    scope: clean_(nested.scope || body.APPLICATION_SCOPE || body.scope),
    domain,
    server_endpoint: clean_(nested.server_endpoint || body.SERVER_ENDPOINT || body.server_endpoint || "https://oauth.bitrix.info/rest/"),
    client_endpoint: clientEndpoint,
    member_id: clean_(nested.member_id || body.member_id),
    application_token: clean_(nested.application_token || body.APPLICATION_TOKEN || body.application_token)
  };
}

function validatePortal_(auth) {
  const required = ["access_token", "refresh_token", "scope", "domain", "client_endpoint", "member_id", "application_token"];
  for (const key of required) if (!clean_(auth[key])) throw error_("missing_" + key, 400);
  const expectedDomain = clean_(process.env.BITRIX_PORTAL_DOMAIN).replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
  if (expectedDomain && auth.domain !== expectedDomain) throw error_("bitrix_domain_not_allowed", 403);
  const expectedMember = clean_(process.env.BITRIX_EXPECTED_MEMBER_ID);
  if (expectedMember && auth.member_id !== expectedMember) throw error_("bitrix_member_not_allowed", 403);
  let endpoint;
  try { endpoint = new URL(auth.client_endpoint); } catch (_) { throw error_("bitrix_untrusted_client_endpoint", 400); }
  if (endpoint.protocol !== "https:" || endpoint.hostname.toLowerCase() !== auth.domain) throw error_("bitrix_untrusted_client_endpoint", 400);
}

function validateScope_(value) {
  const scopes = clean_(value).split(/[,\s]+/).filter(Boolean);
  if (!scopes.includes("imopenlines")) throw error_("missing_imopenlines_scope", 400);
}

async function verifyAuth_(auth, fetchImpl) {
  let endpoint;
  try { endpoint = new URL(auth.client_endpoint); } catch (_) { throw error_("bitrix_untrusted_client_endpoint", 400); }
  const url = endpoint.toString().replace(/\/$/, "") + "/profile.json";
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ auth: auth.access_token }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (_) {
    throw error_("bitrix_installation_verification_failed", 502);
  }
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok || !payload || payload.error || !payload.result) throw error_("bitrix_installation_verification_failed", 403);
  return true;
}

function trustedHandlerUrl_(value) {
  let parsed;
  try { parsed = new URL(clean_(value)); } catch (_) { throw error_("bitrix_invalid_event_handler_url", 500); }
  if (parsed.protocol !== "https:") throw error_("bitrix_invalid_event_handler_url", 500);
  return parsed.toString();
}

function safeCode_(error, fallback) { const code = clean_(error && error.code); return /^[a-z0-9_]+$/i.test(code) ? code : fallback; }
function result_(status, payload) { return { status, payload }; }
function positiveInt_(value) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : 0; }
function clean_(value) { return String(value == null ? "" : value).trim(); }
function error_(code, statusCode) { const error = new Error(code); error.code = code; error.statusCode = statusCode; return error; }

module.exports = { handleBitrixInstallation, createInstallationServices, normalizeAuth_, verifyAuth_ };
