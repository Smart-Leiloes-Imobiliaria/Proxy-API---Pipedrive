"use strict";

const crypto = require("crypto");
const transcript = require("./bitrix-transcript.js");
const { parseBitrixRequestBody } = require("./bitrix-request.js");

async function handleBitrixEvaluation(input, dependencies) {
  if (String(input && input.method || "").toUpperCase() !== "POST") return result_(405, { success: false, error: "method_not_allowed" });
  if (!tokenValid_(input && input.headers || {})) return result_(401, { success: false, error: "unauthorized" });

  let body;
  try { body = parseBitrixRequestBody(input && input.body); } catch (error) {
    return result_(Number(error && error.statusCode) || 400, { success: false, error: safeErrorCode_(error) });
  }
  return evaluateBitrixAttendance(body, dependencies);
}

async function evaluateBitrixAttendance(body, dependencies) {
  body = body || {};
  const memberId = clean_(body.member_id || process.env.BITRIX_MEMBER_ID);
  const requestedSessionId = body.session_id == null || body.session_id === "" ? 0 : positiveInt_(body.session_id);
  const requestedChatId = body.chat_id == null || body.chat_id === "" ? 0 : positiveInt_(body.chat_id);
  const dryRun = body.dry_run === true;
  const force = body.force === true;
  if (!memberId) return result_(400, { success: false, error: "missing_member_id" });
  if (body.session_id != null && body.session_id !== "" && !requestedSessionId) return result_(400, { success: false, error: "invalid_session_id" });
  if (body.chat_id != null && body.chat_id !== "" && !requestedChatId) return result_(400, { success: false, error: "invalid_chat_id" });
  if (!requestedSessionId && !requestedChatId) return result_(400, { success: false, error: "missing_session_id_or_chat_id" });
  if (!clean_(body.source)) return result_(400, { success: false, error: "missing_source" });
  if (!["bitrix24", "manual", "on_session_finish"].includes(clean_(body.source).toLowerCase())) return result_(400, { success: false, error: "invalid_source" });
  if (force && clean_(process.env.BITRIX_ALLOW_FORCE).toLowerCase() !== "true") return result_(403, { success: false, error: "bitrix_force_not_allowed" });

  const scope = testScope_();
  if (!scope.sessions.size && !scope.chats.size && !scope.lines.size) return result_(403, { success: false, error: "bitrix_test_scope_not_configured" });
  if (requestedSessionId && scope.sessions.size && !scope.sessions.has(requestedSessionId) && !scope.chats.size && !scope.lines.size) return result_(403, { success: false, error: "bitrix_session_not_allowed" });
  if (requestedChatId && scope.chats.size && !scope.chats.has(requestedChatId) && !scope.sessions.size && !scope.lines.size) return result_(403, { success: false, error: "bitrix_chat_not_allowed" });

  const services = typeof dependencies === "function" ? dependencies() : dependencies || {};
  try {
    const history = await services.getSessionHistory(memberId, { sessionId: requestedSessionId, chatId: requestedChatId });
    const normalized = transcript.normalizeBitrixHistory(history, { sessionId: requestedSessionId || undefined, chatId: requestedChatId || undefined });
    const sessionId = normalized.sessionId;
    if (!scopeAllows_(scope, normalized)) return result_(403, { success: false, error: "bitrix_chat_not_allowed" });
    if (!normalized.candidateEmployees.length) return notEvaluable_(memberId, normalized, "no_attributable_operator_messages");

    const capturedTexts = transcript.buildCapturedTexts(normalized);
    if (dryRun) {
      return result_(200, {
        success: true, status: "dry_run", member_id: memberId, session_id: sessionId,
        chat_id: normalized.chatId, line_id: normalized.lineId || null, connector_id: normalized.connectorId || null,
        chat_link: bitrixChatLink_(normalized.chatId), session_resolution: requestedSessionId ? "provided" : "latest_by_chat_id",
        candidate_employees: normalized.candidateEmployees.map(publicCandidate_), transcript: capturedTexts
      });
    }

    const rows = services.listRecords ? await services.listRecords() : [];
    const sessionClosedAt = closedAt_(normalized.lines);
    const pending = normalized.candidateEmployees.filter((candidate) => force || !recordExists_(rows, memberId, sessionId, candidate.id, {
      chatId: normalized.chatId,
      closedAt: sessionClosedAt,
      responsibleName: candidate.name
    }));
    if (!pending.length) return result_(200, { success: true, status: "already_processed", member_id: memberId, session_id: sessionId });

    const saved = [];
    for (const candidate of pending) {
      const evaluation = await services.evaluate({ responsibleName: candidate.name, transcript: transcript.buildTranscript(normalized, candidate) });
      if (evaluation && evaluation.avaliavel === false && evaluation.nota === null) continue;
      if (!evaluation || evaluation.avaliavel !== true || !Number.isInteger(evaluation.nota) || evaluation.nota < 1 || evaluation.nota > 5) throw error_("invalid_openai_response", 502);
      saved.push({
        memberId, sessionId, chatId: normalized.chatId, lineId: normalized.lineId, connectorId: normalized.connectorId,
        chatLink: bitrixChatLink_(normalized.chatId),
        responsibleId: candidate.id, responsibleName: candidate.name, closedAt: sessionClosedAt, clientName: normalized.clientName,
        nota: evaluation.nota, justificativa: clean_(evaluation.justificativa).slice(0, 900), capturedTexts
      });
    }
    if (!saved.length) return notEvaluable_(memberId, normalized, "model_not_evaluable");
    await services.appendRecords(saved);
    return result_(200, {
      success: true, status: "saved", member_id: memberId, session_id: sessionId, chat_id: normalized.chatId,
      chat_link: bitrixChatLink_(normalized.chatId), session_resolution: requestedSessionId ? "provided" : "latest_by_chat_id",
      evaluated_employees: saved.map((item) => ({ responsible_id: item.responsibleId, responsible_name: item.responsibleName, nota: item.nota }))
    });
  } catch (error) {
    const code = safeErrorCode_(error);
    return result_(Number(error && error.statusCode) || 502, { success: false, error: code });
  }
}

function testScope_() { return { sessions: intSet_(process.env.BITRIX_ALLOWED_SESSION_IDS), chats: intSet_(process.env.BITRIX_ALLOWED_CHAT_IDS), lines: intSet_(process.env.BITRIX_ALLOWED_LINE_IDS) }; }
function scopeAllows_(scope, data) { return scope.sessions.has(data.sessionId) || scope.chats.has(data.chatId) || data.lineId && scope.lines.has(data.lineId); }
function intSet_(value) { return new Set(clean_(value).split(",").map((item) => positiveInt_(item)).filter(Boolean)); }
function recordExists_(rows, memberId, sessionId, responsibleId, metadata) {
  const chatId = positiveInt_(metadata && metadata.chatId);
  const closedAt = clean_(metadata && metadata.closedAt);
  const responsibleName = normalizeName_(metadata && metadata.responsibleName);
  return (Array.isArray(rows) ? rows : []).some((row) =>
    positiveInt_(row[0]) === chatId &&
    clean_(row[3]) === closedAt &&
    normalizeName_(row[2]) === responsibleName &&
    clean_(row[8]).toLowerCase() === "bitrix24"
  );
}
function publicCandidate_(candidate) { return { responsible_id: candidate.id, responsible_name: candidate.name, message_count: candidate.count }; }
function closedAt_(lines) { const last = lines[lines.length - 1]; return formatDate_(last && last.date || new Date().toISOString()); }
function bitrixChatLink_(chatId) {
  const domain = clean_(process.env.BITRIX_PORTAL_DOMAIN || "smartcaixa.bitrix24.com.br").replace(/^https?:\/\//i, "").replace(/\/$/, "");
  if (!/^[a-z0-9.-]+\.bitrix24\.com\.br$/i.test(domain)) throw error_("bitrix_invalid_portal_domain", 500);
  return "https://" + domain + "/online/?IM_LINES=chat" + positiveInt_(chatId);
}
function formatDate_(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return byType.year + "-" + byType.month + "-" + byType.day + " " + byType.hour + ":" + byType.minute + ":" + byType.second;
}
function notEvaluable_(memberId, data, reason) { return result_(200, { success: true, status: "not_evaluable", member_id: memberId, session_id: data.sessionId, chat_id: data.chatId, reason }); }
function tokenValid_(headers) {
  const expected = Buffer.from(clean_(process.env.BITRIX_INTERNAL_TOKEN));
  const supplied = Buffer.from(clean_(headers.authorization || headers.Authorization).replace(/^Bearer\s+/i, ""));
  return expected.length > 0 && expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}
function safeErrorCode_(error) { const code = clean_(error && error.code || "bitrix_evaluation_failed"); return /^[a-z0-9_]+$/i.test(code) ? code : "bitrix_evaluation_failed"; }
function result_(status, payload) { return { status, payload }; }
function positiveInt_(value) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : 0; }
function clean_(value) { return String(value == null ? "" : value).trim(); }
function normalizeName_(value) { return clean_(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function error_(code, statusCode) { const error = new Error(code); error.code = code; error.statusCode = statusCode; return error; }

module.exports = { handleBitrixEvaluation, evaluateBitrixAttendance, recordExists_, bitrixChatLink_ };
