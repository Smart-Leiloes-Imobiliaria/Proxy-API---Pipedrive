"use strict";

const crypto = require("crypto");
const { parseBitrixRequestBody, requestSizeAllowed } = require("./bitrix-request.js");
const { createBitrixSupabaseRepository } = require("./bitrix-supabase-repository.js");

async function handleBitrixEvent(input, dependencies) {
  if (String(input && input.method || "").toUpperCase() !== "POST") return result_(405, { success: false, error: "method_not_allowed" });
  if (!requestSizeAllowed(input && input.body)) return result_(413, { success: false, error: "payload_too_large" });
  const services = dependencies || createEventServices_();

  try {
    const body = parseBitrixRequestBody(input && input.body);
    const auth = body && body.auth && typeof body.auth === "object" ? body.auth : {};
    const memberId = clean_(auth.member_id || body.member_id);
    if (!memberId) return result_(400, { success: false, error: "missing_member_id" });
    const installation = await services.installationRepository.getByMemberId(memberId);
    if (!installation) return result_(403, { success: false, error: "bitrix_installation_not_found" });
    if (!safeEqual_(installation.application_token, auth.application_token)) return result_(403, { success: false, error: "invalid_application_token" });

    const event = clean_(body.event).toUpperCase();
    if (event !== "ONSESSIONFINISH") return result_(200, { success: true, status: "ignored", reason: "unsupported_event" });
    const eventId = positiveInt_(body.eventId || body.event_id);
    if (!eventId) return result_(400, { success: false, error: "invalid_event_id" });
    const scope = eventScope_();
    if (!scope.sessions.size && !scope.chats.size && !scope.lines.size && !scope.connectors.size) {
      return result_(503, { success: false, error: "bitrix_event_scope_not_configured" });
    }

    let accepted = 0;
    let duplicates = 0;
    let ignored = 0;
    for (const item of dataItems_(body && body.data && body.data.DATA)) {
      const extracted = extractEventItem_(item);
      if (!extracted || extracted.closed !== "Y" || !scopeAllows_(scope, extracted)) {
        ignored += 1;
        continue;
      }
      const eventKey = "bitrix-event:" + memberId + ":" + eventId + ":" + extracted.sessionId;
      const stored = await services.installationRepository.enqueueJob({
        event_key: eventKey,
        member_id: memberId,
        event_id: eventId,
        session_id: extracted.sessionId,
        chat_id: extracted.chatId,
        line_id: extracted.lineId,
        connector_id: extracted.connectorId,
        user_id: extracted.userId,
        received_at: new Date().toISOString()
      });
      if (stored.inserted) accepted += 1;
      else duplicates += 1;
    }

    if (accepted > 0 && typeof services.scheduleProcessing === "function") {
      try { services.scheduleProcessing(); } catch (_) {}
    }

    return result_(202, { success: true, status: "accepted", accepted, duplicates, ignored });
  } catch (error) {
    return result_(Number(error && error.statusCode) || 400, { success: false, error: safeCode_(error, "bitrix_event_failed") });
  }
}

function createEventServices_() {
  const repository = createBitrixSupabaseRepository();
  return {
    installationRepository: repository,
    scheduleProcessing: () => {
      const { waitUntil } = require("@vercel/functions");
      const { createWorkerServices, processBitrixQueue } = require("./bitrix-queue-worker.js");
      waitUntil(processBitrixQueue(createWorkerServices({ repository })).catch(() => undefined));
    }
  };
}

function extractEventItem_(item) {
  if (!item || typeof item !== "object") return null;
  const connector = item.connector && typeof item.connector === "object" ? item.connector : {};
  const session = item.session && typeof item.session === "object" ? item.session : {};
  const chat = item.chat && typeof item.chat === "object" ? item.chat : {};
  const user = item.user && typeof item.user === "object" ? item.user : {};
  const connectorChatId = positiveInt_(connector.chat_id);
  const chatId = positiveInt_(chat.id) || connectorChatId;
  if (!positiveInt_(session.id) || !chatId || connectorChatId && connectorChatId !== chatId) return null;
  return {
    connectorId: clean_(connector.connector_id),
    lineId: positiveInt_(connector.line_id),
    chatId,
    userId: positiveInt_(user.id || connector.user_id),
    sessionId: positiveInt_(session.id),
    closed: clean_(session.closed).toUpperCase()
  };
}

function dataItems_(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.keys(value).sort((a, b) => Number(a) - Number(b)).map((key) => value[key]);
  return [];
}

function eventScope_() {
  return {
    sessions: intSet_(process.env.BITRIX_ALLOWED_SESSION_IDS),
    chats: intSet_(process.env.BITRIX_ALLOWED_CHAT_IDS),
    lines: intSet_(process.env.BITRIX_ALLOWED_LINE_IDS),
    connectors: stringSet_(process.env.BITRIX_ALLOWED_CONNECTORS)
  };
}

function scopeAllows_(scope, item) {
  if (scope.sessions.size && !scope.sessions.has(item.sessionId)) return false;
  if (scope.chats.size && !scope.chats.has(item.chatId)) return false;
  if (scope.lines.size && !scope.lines.has(item.lineId)) return false;
  if (scope.connectors.size && !scope.connectors.has(item.connectorId.toLowerCase())) return false;
  return true;
}

function safeEqual_(expectedValue, suppliedValue) {
  const expected = Buffer.from(clean_(expectedValue));
  const supplied = Buffer.from(clean_(suppliedValue));
  return expected.length > 0 && expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function intSet_(value) { return new Set(clean_(value).split(",").map(positiveInt_).filter(Boolean)); }
function stringSet_(value) { return new Set(clean_(value).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)); }
function safeCode_(error, fallback) { const code = clean_(error && error.code); return /^[a-z0-9_]+$/i.test(code) ? code : fallback; }
function positiveInt_(value) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : 0; }
function clean_(value) { return String(value == null ? "" : value).trim(); }
function result_(status, payload) { return { status, payload }; }

module.exports = { handleBitrixEvent, createEventServices_, extractEventItem_, dataItems_, scopeAllows_, safeEqual_ };
