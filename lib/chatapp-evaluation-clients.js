"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function safeLog(obj) { try { process.stdout.write(JSON.stringify(obj) + "\n"); } catch (_) {} }

const MAX_MESSAGE_PAGES = 6;

let chatAppTokenState_ = null;
let chatAppTokenRefreshPromise_ = null;
let googleTokenState_ = null;
let googleTokenRefreshPromise_ = null;

function createServices() {
  const chatapp = createChatAppClient_();
  const sheets = createSheetsRepository_();
  return {
    getChat: chatapp.getChat,
    getEmployee: chatapp.getEmployee,
    listMessages: chatapp.listMessages,
    evaluate: evaluateWithOpenAI_,
    listRecords: sheets.listRecords,
    hasRecord: sheets.hasRecord,
    appendRecords: sheets.appendRecords,
    appendRecord: sheets.appendRecord
  };
}

function createChatAppClient_() {
  const baseUrl = requiredEnv_("CHATAPP_API_BASE_URL").replace(/\/$/, "");
  const companyId = requiredEnv_("CHATAPP_COMPANY_ID");
  const request = async (path) => chatAppRequest_(baseUrl, path);
  return {
    getChat: (data) => request("/v1/licenses/" + encodeURIComponent(data.license_id) + "/messengers/" + encodeURIComponent(data.messenger_type) + "/chats/" + encodeURIComponent(data.chat_id)),
    getEmployee: (employeeId) => request("/v1/companies/" + encodeURIComponent(companyId) + "/employees/" + encodeURIComponent(employeeId)),
    listMessages: async (data) => {
      const base = "/v1/licenses/" + encodeURIComponent(data.license_id) + "/messengers/" + encodeURIComponent(data.messenger_type) + "/chats/" + encodeURIComponent(data.chat_id) + "/messages";
      const messages = [];
      const windowStart = resolveWindowStart_(data);
      const softLookbackMs = resolveSoftLookbackMs_(data);
      let next = base + "?limit=100&includeSystemMessages=0";
      let pageCount = 0;
      while (next) {
        const page = await request(next);
        const body = page && page.data ? page.data : page;
        const pageMessages = Array.isArray(body) ? body : body.messages || body.items || [];
        if (!pageMessages.length) break;
        messages.push(...pageMessages);
        pageCount += 1;

        if (shouldStopListingMessages_(pageMessages, windowStart, softLookbackMs)) break;
        next = nextPage_(page, body, next, base);
        if (pageCount >= 8) break;
      }
      return messages;
    }
  };
}

async function chatAppRequest_(baseUrl, path) {
  let token = await chatAppToken_(baseUrl);
  try {
    return await fetchJson_(absoluteUrl_(baseUrl, path), { authorization: token }, "chatapp");
  } catch (error) {
    if (!error || error.statusCode !== 401) throw error;
    token = await chatAppToken_(baseUrl, true);
    return fetchJson_(absoluteUrl_(baseUrl, path), { authorization: token }, "chatapp");
  }
}

async function chatAppToken_(baseUrl, forceRefresh) {
  let state = chatAppTokenState_ || loadChatAppTokenState_();
  if (!forceRefresh && isChatAppAccessTokenValid_(state, 300)) return state.accessToken;
  if (!chatAppTokenRefreshPromise_) {
    chatAppTokenRefreshPromise_ = refreshChatAppTokenState_(baseUrl, state)
      .finally(() => { chatAppTokenRefreshPromise_ = null; });
  }
  state = await chatAppTokenRefreshPromise_;
  return state.accessToken;
}

function loadChatAppTokenState_() {
  chatAppTokenState_ = {
    accessToken: env_("CHATAPP_ACCESS_TOKEN") || env_("CHATAPP_API_TOKEN"),
    accessTokenEndTime: Number(env_("CHATAPP_ACCESS_TOKEN_END_TIME") || 0),
    refreshToken: env_("CHATAPP_REFRESH_TOKEN"),
    refreshTokenEndTime: Number(env_("CHATAPP_REFRESH_TOKEN_END_TIME") || 0)
  };
  return chatAppTokenState_;
}

async function refreshChatAppTokenState_(baseUrl, state) {
  try {
    if (state.refreshToken && isChatAppRefreshTokenValid_(state, 60)) return await chatAppRefresh_(baseUrl, state.refreshToken);
  } catch (_) {
    // Token de refresh expirado ou recusado: login completo abaixo.
  }
  return chatAppLogin_(baseUrl);
}

async function chatAppLogin_(baseUrl) {
  const body = {
    email: requiredEnv_("CHATAPP_EMAIL"),
    password: requiredEnv_("CHATAPP_PASSWORD"),
    appId: requiredEnv_("CHATAPP_APP_ID")
  };
  const response = await fetchJson_(absoluteUrl_(baseUrl, "/v1/tokens"), { Lang: "pt", Accept: "application/json", "content-type": "application/json" }, "chatapp_auth", { method: "POST", body: JSON.stringify(body) });
  return saveChatAppTokens_(response);
}

async function chatAppRefresh_(baseUrl, refreshToken) {
  const response = await fetchJson_(absoluteUrl_(baseUrl, "/v1/tokens/refresh"), { Refresh: refreshToken, Lang: "pt", Accept: "application/json" }, "chatapp_auth", { method: "POST" });
  return saveChatAppTokens_(response);
}

function saveChatAppTokens_(data) {
  if (data && data.data && !data.accessToken) data = data.data;
  const accessToken = String(data && data.accessToken || "").trim();
  if (!accessToken) throw externalError_("chatapp_auth_missing_access_token", 502);
  chatAppTokenState_ = {
    accessToken,
    accessTokenEndTime: Number(data.accessTokenEndTime || 0),
    refreshToken: data.refreshToken ? String(data.refreshToken) : chatAppTokenState_ && chatAppTokenState_.refreshToken || "",
    refreshTokenEndTime: Number(data.refreshTokenEndTime || chatAppTokenState_ && chatAppTokenState_.refreshTokenEndTime || 0)
  };
  return chatAppTokenState_;
}

function isChatAppAccessTokenValid_(state, skewSeconds) {
  if (!state || !state.accessToken) return false;
  if (!state.accessTokenEndTime) return !state.refreshToken && !env_("CHATAPP_EMAIL");
  return Math.floor(Date.now() / 1000) < state.accessTokenEndTime - skewSeconds;
}

function isChatAppRefreshTokenValid_(state, skewSeconds) {
  if (!state || !state.refreshToken) return false;
  if (!state.refreshTokenEndTime) return true;
  return Math.floor(Date.now() / 1000) < state.refreshTokenEndTime - skewSeconds;
}

async function evaluateWithOpenAI_(input) {
  const prompt = evaluationPrompt_();
  const transcriptText = String(input && input.transcript || "").trim();
  const transcriptLimit = Number(process.env.CHATAPP_EVAL_MAX_TRANSCRIPT_CHARS || "4000");
  const boundedTranscript = Number.isFinite(transcriptLimit) && transcriptLimit > 0 && transcriptText.length > transcriptLimit ? transcriptText.slice(-transcriptLimit) : transcriptText;
  const requestBody = {
    model: requiredEnv_("OPENAI_MODEL"), store: false, max_output_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || "420"),
    instructions: prompt,
    input: "FUNCIONÁRIO AVALIADO: " + input.responsibleName + "\n\nCONTEXTO DO ATENDIMENTO: avalie exclusivamente a conduta atribuível ao funcionário avaliado.\n\nTRANSCRIPT NORMALIZADO:\n" + boundedTranscript + "\n\nResponda somente no formato solicitado.",
    text: {
      format: {
        type: "json_schema", name: "avaliacao_atendimento", strict: true,
        schema: {
          type: "object", additionalProperties: false, required: ["avaliavel", "nota", "justificativa"],
          properties: {
            avaliavel: { type: "boolean" },
            nota: { type: ["integer", "null"], minimum: 1, maximum: 5 },
            justificativa: { type: "string", maxLength: 900 }
          }
        }
      }
    }
  };

  if (String(process.env.DEBUG_CHATAPP_EVAL || "").trim()) {
    try {
      safeLog({ event: "openai_request", model: requestBody.model, instructions_excerpt: String(requestBody.instructions || "").slice(0, 300), transcript_excerpt: String(input.transcript || "").slice(0, 1000), max_output_tokens: requestBody.max_output_tokens });
    } catch (_) {}
  }

  const response = await fetchJson_("https://api.openai.com/v1/responses", {
    authorization: "Bearer " + requiredEnv_("OPENAI_API_KEY"), "content-type": "application/json"
  }, "openai", {
    method: "POST",
    body: JSON.stringify(requestBody),
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || "25000")
  });

  if (String(process.env.DEBUG_CHATAPP_EVAL || "").trim()) {
    try {
      const rawText = response && (response.output_text || outputText_(response)) || "";
      safeLog({ event: "openai_response", output_text_excerpt: String(rawText).slice(0, 2000), full_response_keys: response && Object.keys(response) });
    } catch (_) {}
  }
  let parsed;
  try { parsed = JSON.parse(response.output_text || outputText_(response)); } catch (_) { throw externalError_("invalid_openai_response", 502); }
  if (!parsed || typeof parsed.avaliavel !== "boolean" || (parsed.avaliavel && !Number.isInteger(parsed.nota)) || (!parsed.avaliavel && parsed.nota !== null) || typeof parsed.justificativa !== "string") throw externalError_("invalid_openai_response", 502);
  // Mantem a planilha legivel, mas permite uma justificativa diagnostica.
  parsed.justificativa = String(parsed.justificativa || "").trim().replace(/\s+/g, " ").slice(0, 900);
  return parsed;
}

function createSheetsRepository_() {
  const spreadsheetId = requiredEnv_("GOOGLE_SHEETS_SPREADSHEET_ID");
  const sheetName = requiredEnv_("GOOGLE_SHEETS_SHEET_NAME");
  const range = encodeURIComponent("'" + sheetName.replace(/'/g, "''") + "'!A:F");
  const url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(spreadsheetId) + "/values/" + range;
  return {
    listRecords: async () => (await sheetsRequest_(url, "GET")).values || [],
    hasRecord: async (chatId, closedAt) => {
      const values = (await sheetsRequest_(url, "GET")).values || [];
      return values.some((row) => String(row[0] || "") === String(chatId) && String(row[2] || "") === String(closedAt));
    },
    hasEvaluationRecord: async (chatId, closedAt, responsibleName) => {
      const values = (await sheetsRequest_(url, "GET")).values || [];
      return values.some((row) => String(row[0] || "") === String(chatId) && String(row[2] || "") === String(closedAt) && normalizeName_(row[1]) === normalizeName_(responsibleName));
    },
    appendRecords: async (records) => {
      const rows = Array.isArray(records) ? records : [];
      if (!rows.length) return;
      await sheetsRequest_(url + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", "POST", {
        values: rows.map((record) => [record.chatId, record.responsibleName, record.closedAt, record.clientName, record.nota, record.justificativa || ""])
      });
    },
    appendRecord: async (record) => {
      await sheetsRequest_(url + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", "POST", { values: [[record.chatId, record.responsibleName, record.closedAt, record.clientName, record.nota, record.justificativa || ""]] });
    }
  };
}

async function sheetsRequest_(url, method, body) {
  const token = await googleAccessToken_();
  return fetchJson_(url, { authorization: "Bearer " + token, "content-type": "application/json" }, "google_sheets", body && { method, body: JSON.stringify(body) });
}
async function googleAccessToken_() {
  let state = googleTokenState_ || loadGoogleTokenState_();
  if (isGoogleAccessTokenValid_(state, 300)) return state.accessToken;
  if (!googleTokenRefreshPromise_) {
    googleTokenRefreshPromise_ = refreshGoogleTokenState_().finally(() => { googleTokenRefreshPromise_ = null; });
  }
  state = await googleTokenRefreshPromise_;
  return state.accessToken;
}
function loadGoogleTokenState_() {
  googleTokenState_ = {
    accessToken: "",
    accessTokenEndTime: 0
  };
  return googleTokenState_;
}
function isGoogleAccessTokenValid_(state, skewSeconds) {
  if (!state || !state.accessToken) return false;
  if (!state.accessTokenEndTime) return false;
  return Math.floor(Date.now() / 1000) < state.accessTokenEndTime - skewSeconds;
}
async function refreshGoogleTokenState_() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url_(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url_(JSON.stringify({ iss: requiredEnv_("GOOGLE_SERVICE_ACCOUNT_EMAIL"), scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const rawKey = requiredEnv_("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  const privateKey = sanitizePrivateKey_(rawKey);
  let signature;
  try {
    const toSign = Buffer.from(header + "." + claim, "utf8");
    signature = crypto.sign("sha256", toSign, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING });
  } catch (err) {
    // Fallback: try parsing the key as a KeyObject and sign again.
    try {
      const keyObj = crypto.createPrivateKey({ key: privateKey, format: 'pem' });
      const toSign = Buffer.from(header + "." + claim, "utf8");
      signature = crypto.sign("sha256", toSign, { key: keyObj, padding: crypto.constants.RSA_PKCS1_PADDING });
    } catch (err2) {
      const codeMsg = String((err && (err.code || err.message)) || (err2 && (err2.code || err2.message)) || "signing_failed");
      if (String(codeMsg).includes('ERR_OSSL_UNSUPPORTED')) throw externalError_('ERR_OSSL_UNSUPPORTED', 502);
      throw externalError_("google_key_signing_failed:" + codeMsg, 502);
    }
  }
  const assertion = header + "." + claim + "." + Buffer.from(signature).toString("base64url");
  const payload = await fetchJson_("https://oauth2.googleapis.com/token", { "content-type": "application/x-www-form-urlencoded" }, "google_auth", { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString() });
  if (!payload.access_token) throw externalError_("google_auth_failed", 502);
  googleTokenState_ = {
    accessToken: payload.access_token,
    accessTokenEndTime: Number(payload.expires_in ? Math.floor(Date.now() / 1000) + Number(payload.expires_in) : 0)
  };
  return googleTokenState_;
}
async function fetchJson_(url, headers, service, options) {
  const timeoutMs = Number((options && options.timeoutMs) || 8000);
  const requestOptions = Object.assign({}, options || {});
  delete requestOptions.timeoutMs;
  requestOptions.headers = headers;
  requestOptions.signal = AbortSignal.timeout(timeoutMs);
  let response;
  try { response = await fetch(url, requestOptions); }
  catch (_) { throw externalError_(service + "_timeout", 504); }
  let body; try { body = await response.json(); } catch (_) { body = null; }
  if (!response.ok) throw externalError_(service + "_http_" + response.status, [401, 403, 404, 429].includes(response.status) ? response.status : 502);
  return body;
}
function nextPage_(page, body, current, base) {
  const raw = page && (page.nextPage || page.next_page || page.meta && (page.meta.nextPage || page.meta.next_page) || page.pagination && (page.pagination.nextPage || page.pagination.next_page)) || body && (body.nextPage || body.next_page || body.pagination && (body.pagination.nextPage || body.pagination.next_page));
  if (!raw) return "";
  if (typeof raw === "string" && /^https?:\/\//.test(raw)) return raw;
  if (typeof raw === "string" && raw.startsWith("/")) return raw;
  if (typeof raw === "string" && raw.startsWith("?")) return base + raw;
  if (typeof raw === "string") {
    const url = new URL(base, "https://placeholder.invalid");
    url.searchParams.set("nextPage", raw);
    return /^https?:\/\//.test(current) ? url.toString() : url.pathname + url.search;
  }
  const cursor = typeof raw === "object" && (raw.cursor || raw.nextCursor);
  const pageNumber = typeof raw === "number" ? raw : (typeof raw === "object" && raw.page);
  if (cursor || pageNumber) {
    const url = new URL(current, "https://placeholder.invalid");
    url.searchParams.set(cursor ? "cursor" : "page", String(cursor || pageNumber));
    return /^https?:\/\//.test(current) ? url.toString() : url.pathname + url.search;
  }
  return "";
}
function resolveWindowStart_(data) {
  const raw = data && (data.sessionStartedAt || data.started_at || data.session_start || data.startedAt);
  const value = toDate_(raw);
  return value ? value.getTime() : null;
}
function resolveSoftLookbackMs_(data) {
  const raw = data && (data.closedAt || data.closed_at);
  const closedMs = toDate_(raw) ? toDate_(raw).getTime() : null;
  if (!closedMs) return null;
  const explicitStart = resolveWindowStart_(data);
  if (explicitStart) return null;
  const configured = Number(process.env.CHATAPP_EVALUATION_LOOKBACK_MS || "" );
  if (Number.isFinite(configured) && configured > 0) return configured;
  return 6 * 60 * 60 * 1000;
}
function shouldStopListingMessages_(pageMessages, windowStart, softLookbackMs) {
  if (!Array.isArray(pageMessages) || !pageMessages.length) return true;
  if (windowStart != null) {
    const newestInPage = pageMessages.reduce((latest, item) => {
      const ts = messageTimestamp_(item);
      if (ts == null) return latest;
      return ts > latest ? ts : latest;
    }, Number.NEGATIVE_INFINITY);
    return Number.isFinite(newestInPage) && newestInPage < windowStart;
  }
  if (softLookbackMs != null) {
    const newestInPage = pageMessages.reduce((latest, item) => {
      const ts = messageTimestamp_(item);
      if (ts == null) return latest;
      return ts > latest ? ts : latest;
    }, Number.NEGATIVE_INFINITY);
    const oldestInPage = pageMessages.reduce((oldest, item) => {
      const ts = messageTimestamp_(item);
      if (ts == null) return oldest;
      return ts < oldest ? ts : oldest;
    }, Number.POSITIVE_INFINITY);
    if (!Number.isFinite(newestInPage) || !Number.isFinite(oldestInPage)) return false;
    return newestInPage - oldestInPage > softLookbackMs;
  }
  return false;
}
function messageTimestamp_(message) {
  if (!message) return null;
  if (typeof message.time === "number") return message.time * 1000;
  if (typeof message.createdAt === "string") return toDate_(message.createdAt) ? toDate_(message.createdAt).getTime() : null;
  if (typeof message.created_at === "string") return toDate_(message.created_at) ? toDate_(message.created_at).getTime() : null;
  const created = message.created;
  if (created) {
    if (typeof created.date === "string" || typeof created.date === "number") return toDate_(created.date) ? toDate_(created.date).getTime() : null;
    if (typeof created.at === "string" || typeof created.at === "number") return toDate_(created.at) ? toDate_(created.at).getTime() : null;
    if (typeof created === "string" || typeof created === "number") return toDate_(created) ? toDate_(created).getTime() : null;
  }
  return null;
}
function toDate_(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function absoluteUrl_(baseUrl, path) {
  if (/^https?:\/\//.test(path)) return path;
  return baseUrl + path;
}
function evaluationPrompt_() {
  const filePath = env_("EVALUATION_PROMPT_FILE");
  if (filePath) {
    const absolutePath = path.resolve(process.cwd(), filePath);
    const value = fs.readFileSync(absolutePath, "utf8").trim();
    if (!value) throw externalError_("missing_evaluation_prompt_file_content", 500);
    return value;
  }
  return requiredEnv_("EVALUATION_PROMPT");
}
function outputText_(response) { for (const item of response.output || []) for (const content of item.content || []) if (content.type === "output_text") return content.text; return ""; }
function env_(name) { return String(process.env[name] || "").trim(); }
function requiredEnv_(name) { const value = String(process.env[name] || "").trim(); if (!value) throw externalError_("missing_env", 500); return value; }

function sanitizePrivateKey_(value) {
  if (!value) return value;
  let v = String(value).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  v = v.replace(/\\n/g, "\n");
  return v;
}
function externalError_(code, statusCode) { const error = new Error(code); error.code = code; error.statusCode = statusCode; return error; }
function base64url_(value) { return Buffer.from(value).toString("base64url"); }
function normalizeName_(value) { return String(value == null ? "" : value).trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

module.exports = { createServices };
