"use strict";

const MAX_EMPLOYEES = 2;

function normalizeBitrixHistory(result, options) {
  const opt = options || {};
  const sessionId = positiveInt_(result && result.sessionId);
  const chatId = positiveInt_(result && result.chatId);
  if (!sessionId || opt.sessionId && sessionId !== positiveInt_(opt.sessionId)) throw error_("bitrix_session_mismatch");
  if (!chatId || opt.chatId && chatId !== positiveInt_(opt.chatId)) throw error_("bitrix_chat_mismatch");
  if (!result.message || typeof result.message !== "object" || !result.users || typeof result.users !== "object") throw error_("bitrix_invalid_history");
  const chat = result.chat && (result.chat[String(chatId)] || result.chat[chatId]);
  if (!chat) throw error_("bitrix_chat_missing");

  const entityParts = String(chat.entityId || chat.entity_id || "").split("|");
  const connectorId = entityParts[0] || "";
  const lineId = positiveInt_(entityParts[1]);
  const users = result.users || {};
  const ownerId = cleanId_(chat.owner);
  const managerIds = new Set((chat.managerList || chat.manager_list || []).map(cleanId_).filter(Boolean));
  const files = result.files || {};
  const participants = new Map();
  const externalUsers = [];

  for (const user of Object.values(users)) {
    if (user && user.connector === true) externalUsers.push(user);
  }

  const rawMessages = Object.values(result.message);
  const shouldIsolateRecent = opt.isolateRecentSession !== false && cleanText_(process.env.BITRIX_ISOLATE_RECENT_ATTENDANCE).toLowerCase() !== "false";
  const messagesToProcess = shouldIsolateRecent
    ? selectRecentAttendanceMessages_(rawMessages, users, opt)
    : rawMessages;

  const lines = messagesToProcess.map((message) => {
    const senderId = cleanId_(message && (message.senderid || message.senderId));
    const user = users[senderId] || {};
    const rawText = cleanText_(message && (message.text || message.textlegacy));
    const text = sanitizePii_(stripBitrixMarkup_(rawText));
    const markers = attachmentMarkers_(message, files);
    const system = isSystemMessage_(message, senderId, user, rawText);
    if (system || !text && !markers.length) return null;

    // O livechat real do portal pode omitir o usuario externo de `users` e
    // representar a mensagem humana recebida com senderid=0. Nesse caso so a
    // aceitamos como cliente depois de excluir componentes/formularios do OL.
    const isClient = user.connector === true || senderId === "0";
    const isInternal = user.connector === false && !!senderId;
    const authorName = sanitizePii_(cleanText_(user.name || [user.firstName, user.lastName].filter(Boolean).join(" ")) || (isClient ? "Cliente" : "Participante"));
    let role = isClient ? "CLIENTE" : isInternal ? "ASSESSOR" : "OUTRO PARTICIPANTE";
    if (isInternal) {
      const current = participants.get(senderId) || { id: senderId, name: authorName, count: 0, owner: senderId === ownerId, manager: managerIds.has(senderId) };
      current.count += 1;
      participants.set(senderId, current);
    }
    const date = validDate_(message.date);
    return {
      messageId: cleanId_(message.id) || "0",
      date: date ? date.toISOString() : "",
      time: date ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "--:--",
      role, authorId: senderId, authorName, text: [text, ...markers].filter(Boolean).join(" "), attachmentMarkers: markers
    };
  }).filter(Boolean).sort(compareLines_);

  const candidateEmployees = Array.from(participants.values()).sort((a, b) => Number(b.owner) - Number(a.owner) || b.count - a.count || a.name.localeCompare(b.name)).slice(0, MAX_EMPLOYEES);
  const client = externalUsers[0] || {};
  return {
    sessionId, chatId, lineId, connectorId,
    clientName: sanitizePii_(cleanText_(client.name || [client.firstName, client.lastName].filter(Boolean).join(" ")) || cleanText_(chat.name) || "Cliente"),
    lines, participants: Array.from(participants.values()), candidateEmployees,
    totalMessages: rawMessages.length,
    selectedMessages: messagesToProcess.length,
    isolatedRecent: shouldIsolateRecent
  };
}

function buildTranscript(normalized, candidate) {
  const targetId = cleanId_(candidate && candidate.id);
  return normalized.lines.map((line) => {
    let label = line.role;
    if (line.role === "ASSESSOR") label = line.authorId === targetId ? "ASSESSOR: " + line.authorName : "OUTRO PARTICIPANTE: " + line.authorName;
    return label + " - " + line.time + " - " + line.text;
  }).join("\n");
}
function buildCapturedTexts(normalized) { return normalized.lines.map((line) => line.role + (line.role === "ASSESSOR" ? ": " + line.authorName : "") + " - " + line.time + " - " + line.text).join("\n"); }

function attachmentMarkers_(message, files) {
  const ids = [];
  const params = message && message.params || {};
  for (const key of ["FILE_ID", "FILE_IDS", "FILES"]) {
    const value = params[key];
    if (Array.isArray(value)) ids.push(...value); else if (value != null) ids.push(value);
  }
  return [...new Set(ids.map(String))].map((id) => markerForFile_(files[id] || {}));
}
function markerForFile_(file) {
  const ext = cleanText_(file.extension).toLowerCase();
  const type = cleanText_(file.type).toLowerCase();
  if (/audio|voice/.test(type) || /^(mp3|ogg|wav|m4a)$/.test(ext)) return "[áudio anexado]";
  if (/image/.test(type) || /^(png|jpe?g|gif|webp)$/.test(ext)) return "[imagem anexada]";
  return "[documento anexado" + (ext ? ": " + ext.toUpperCase() : "") + "]";
}
function isSystemMessage_(message, senderId, user, rawText) {
  const params = message && message.params || {};
  if (!senderId) return true;
  if (ignoredUserIds_().has(senderId)) return true;
  if (params.IS_SYSTEM === "Y" || params.SYSTEM === "Y" || message.system === true) return true;
  if (senderId === "0" && (params.class || params.componentId || params.code || params.notify || params.imolForm || params.imolVoteSid || params.attach)) return true;
  if (/bot|system/i.test(cleanText_(user.type || user.externalAuthId))) return true;
  if (senderId === "0" && /\b(aceitou|entrou|saiu|foi transferid[oa]|encerrou|fechou|finalizou)\s+(a|da|na|no)?\s*(conversa|diálogo|dialogo|sessão|sessao|bate-papo|chat)\b/i.test(rawText)) return true;
  if (/forms\.gle\//i.test(rawText) && /sua opini[aã]o [ée] muito importante/i.test(rawText) && /atenciosamente[,.\s]+equipe/i.test(rawText)) return true;
  return false;
}

function selectRecentAttendanceMessages_(messages, users, options) {
  const opt = options || {};
  const maxGapHours = positiveInt_(opt.maxGapHours || process.env.BITRIX_SESSION_MAX_GAP_HOURS) || 4;
  const maxGapMs = maxGapHours * 3600 * 1000;
  const sorted = [...messages].filter(Boolean).sort(compareMessagesChronological_);
  if (!sorted.length) return [];

  const partitions = [];
  let current = [];
  let closed = false;

  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    const prev = current[current.length - 1];
    const isEnd = isSessionEndMarker_(m);

    let shouldSplit = false;
    if (prev) {
      const prevDate = validDate_(prev.date);
      const currDate = validDate_(m.date);
      if (prevDate && currDate && (currDate - prevDate > maxGapMs)) {
        shouldSplit = true;
      } else if (closed && !isEnd) {
        shouldSplit = true;
      }
    }

    if (shouldSplit && current.length) {
      partitions.push(current);
      current = [];
      closed = false;
    }

    current.push(m);
    if (isEnd) closed = true;
  }
  if (current.length) partitions.push(current);

  for (let i = partitions.length - 1; i >= 0; i--) {
    const part = partitions[i];
    const hasHuman = part.some((m) => {
      const sender = cleanId_(m && (m.senderid || m.senderId));
      const u = users[sender] || {};
      return sender !== "0" && !/bot|system/i.test(cleanText_(u.type || u.externalAuthId));
    });
    if (hasHuman) {
      const trailing = partitions.slice(i + 1).flat();
      return [...part, ...trailing];
    }
  }

  return sorted;
}

function isSessionEndMarker_(message) {
  const text = cleanText_(message && (message.text || message.textlegacy));
  const params = message && message.params || {};
  return /\b(encerrou a (conversa|sess[aã]o)|atendimento encerrado|conversa fechada)\b/i.test(text) ||
    params.class === "bx-messenger-content-item-ol-end" ||
    params.imolForm === "history" ||
    params.imolForm === "like";
}

function compareMessagesChronological_(a, b) {
  const da = validDate_(a && a.date);
  const db = validDate_(b && b.date);
  const diff = (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
  return diff || (Number(a && a.id) || 0) - (Number(b && b.id) || 0);
}
function compareLines_(a, b) { const date = String(a.date).localeCompare(String(b.date)); return date || Number(a.messageId) - Number(b.messageId); }
function stripBitrixMarkup_(text) {
  return String(text || "")
    .replace(/\[USER=[^\]]+\]([^[]*)\[\/USER\]/gi, "$1")
    .replace(/\[URL=([^\]]+)\]([\s\S]*?)\[\/URL\]/gi, "$2 ($1)")
    .replace(/\[URL\]([\s\S]*?)\[\/URL\]/gi, "$1")
    .replace(/\[BR\]/gi, "\n")
    .replace(/\[(?:\/?(?:B|I|U|S|COLOR|SIZE|FONT|QUOTE|CODE)|[^\]]+REPLACE)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
function ignoredUserIds_() { return new Set(cleanText_(process.env.BITRIX_IGNORED_USER_IDS).split(",").map(cleanId_).filter(Boolean)); }
function sanitizePii_(text) { return String(text || "").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-mail removido]").replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf removido]").replace(/(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[\s-]?\d{4}(?!\d)/g, "[telefone removido]"); }
function validDate_(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function positiveInt_(value) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : 0; }
function cleanId_(value) { return String(value == null ? "" : value).trim(); }
function cleanText_(value) { return String(value == null ? "" : value).replace(/\s+/g, " ").trim(); }
function error_(code) { const error = new Error(code); error.code = code; error.statusCode = 502; return error; }

module.exports = { normalizeBitrixHistory, buildTranscript, buildCapturedTexts, sanitizePii_, stripBitrixMarkup_ };
