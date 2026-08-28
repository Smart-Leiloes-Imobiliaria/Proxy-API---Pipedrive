"use strict";

// Orquestracao da avaliacao de atendimento. Dependencias externas sao injetadas
// para manter este fluxo testavel sem chamadas reais a ChatApp, OpenAI ou Google.

const AUTOMATION_PATTERN = /\b(bot|router|pipedrive|loop|nps|autom[aã]t|cen[aá]rio|scenario|migration)\b/i;
const DEFAULT_CHATAPP_TIME_OFFSET_HOURS = 3;
const MAX_EMPLOYEES_PER_EVALUATION = 2;
const BLOCKED_INTERNAL_ASSESSOR_IDENTIFIERS = new Set(["66345"]);
const KNOWN_ASSESSOR_IDS = {
  "evelycastro.smart@gmail.com": "101592",
  "analise de credito - yara": "99955",
  "marloon francisco": "98226",
  "joao victor": "99587",
  "isadoracampos.smart@gmail.com": "90720",
  "triagem - yasmin": "83408",
  "triagem - isaque coelho": "81040",
  "dimitri garcia": "78043"
};

function safeLog(obj) {
  try { process.stdout.write(JSON.stringify(obj) + "\n"); } catch (_) {}
}

async function handleEvaluation(input, dependencies) {
  const body = parseBody_(input && input.body);
  const headers = (input && input.headers) || {};
  if (!tokenValid_(headers)) return result_(401, { success: false, error: "unauthorized" });
  if (String(input && input.method || "").toUpperCase() !== "POST") {
    return result_(405, { success: false, error: "method_not_allowed" });
  }

  const request = normalizeRequest_(body);
  // closed_at is required (we don't substitute it). Optionally accept
  // `session_started_at` / `started_at` alongside closed_at to narrow the
  // transcript window — this is used together with closed_at, not in place of it.
  const missing = ["chat_id", "license_id", "messenger_type", "closed_at", "source"].find((key) => !request[key]);
  if (missing) return result_(400, { success: false, error: "missing_" + missing });
  if (!request.sourceLabel) return result_(400, { success: false, error: "invalid_source", message: "source must be chatapp or bitrix24" });
  // Validate normalized timestamps: closedAt must be a valid date and not before startedAt.
  const closedAtDate = toDate_(request.closedAt);
  const startedAtDate = request.sessionStartedAt ? toDate_(request.sessionStartedAt) : null;
  if (!closedAtDate) return invalidDateResult_("closed_at");
  if (request.sessionStartedAtRaw && !startedAtDate) return invalidDateResult_(request.sessionStartedAtField);
  if (startedAtDate && startedAtDate > closedAtDate) return result_(400, { success: false, error: "invalid_time_window", message: "session_started_at must be before or equal to closed_at" });

  // Configuracoes externas so sao lidas depois de autenticar/validar a chamada.
  const services = typeof dependencies === "function" ? dependencies() : (dependencies || {});
  try {
    const chatPromise = services.getChat(request);
    const messagesPromise = services.listMessages(request);
    const sheetRowsPromise = services.listRecords ? services.listRecords(request.chat_id, request.closedAt) : Promise.resolve(null);
    const chat = await chatPromise;
    const chatData = unwrapData_(chat);
    if (!chatData || !chatData.id) return result_(404, { success: false, error: "chat_not_found" });

    const metadata = {
      chatId: String(chatData.id),
      clientName: cleanText_(chatData.name) || "",
      responsibleId: cleanId_(chatData.responsible && chatData.responsible.id),
      closedAt: request.closedAt,
      closedAtDisplay: formatClosedAt_(request.closedAt)
    };
    let responsibleName = "";
    let employeePromise = null;
    if (metadata.responsibleId) {
      employeePromise = services.getEmployee(metadata.responsibleId, request);
    }
    const messages = await messagesPromise;
    if (employeePromise) {
      const employee = unwrapData_(await employeePromise);
      responsibleName = cleanText_(employee && employee.fullName);
      metadata.responsibleName = responsibleName;
    }

    // A consulta e paginada pelo cliente. `closed_at` sempre e o limite final;
    // o builder aceita sessionStartedAt para a futura integracao chatStatus.
    const transcriptSelection = selectTranscriptSelection_(messages, {
      responsibleId: metadata.responsibleId,
      responsibleName,
      rawSessionStartedAt: request.sessionStartedAtRaw,
      rawSessionClosedAt: request.closedAtRaw,
      sessionStartedAt: request.sessionStartedAt,
      sessionClosedAt: request.closedAt
    });
    if (!transcriptSelection) return notEvaluable_(metadata, "no_human_messages");
    const transcriptSummary = filterBlockedEvaluationSummary_(transcriptSelection.summary);
    const candidates = filterBlockedEvaluationCandidates_(evaluationCandidates_(transcriptSummary, {
      responsibleId: metadata.responsibleId,
      responsibleName
    }));
    if (!candidates.length) return notEvaluable_(metadata, "blocked_assessor");

    const sheetRows = await sheetRowsPromise;
    if (allCandidatesAlreadyProcessedFromRows_(sheetRows, candidates, metadata)) {
      return result_(200, { success: true, status: "already_processed", chat_id: metadata.chatId });
    }

    const pendingCandidates = candidates.filter((candidate) => !recordExistsInRows_(sheetRows, metadata.chatId, metadata.closedAtDisplay, candidate.name));
    if (!pendingCandidates.length) {
      return result_(200, { success: true, status: "already_processed", chat_id: metadata.chatId });
    }

    const evaluations = await Promise.all(pendingCandidates.map(async (candidate) => {
      const transcript = buildTranscriptFromSummary_(transcriptSummary, candidate);
      const capturedTexts = buildCapturedTextsFromSummary_(transcriptSummary);
      if (debugEnabled_()) safeLog({ event: "sending_to_model", candidate: candidate, transcript_excerpt: transcript.text && String(transcript.text).slice(0, 2000), targetHumanMessages: transcript.targetHumanMessages });
      const evaluation = await services.evaluate({
        responsibleName: candidate.name,
        transcript: transcript.text
      });
      if (debugEnabled_()) safeLog({ event: "model_result", candidate: candidate, evaluation });
      if (evaluation && evaluation.avaliavel === false && evaluation.nota === null) return null;
      if (!evaluation || evaluation.avaliavel !== true || !Number.isInteger(evaluation.nota) || evaluation.nota < 1 || evaluation.nota > 5) {
        throw externalError_("invalid_openai_response", 502);
      }
      return {
        chatId: metadata.chatId,
        responsibleName: candidate.name,
        closedAt: metadata.closedAtDisplay,
        clientName: sanitizeBlockedAssessorTrace_(metadata.clientName),
        nota: evaluation.nota,
        justificativa: sanitizeBlockedAssessorTrace_(evaluation.justificativa || ""),
        capturedTexts: sanitizeBlockedAssessorTrace_(capturedTexts),
        source: request.sourceLabel,
        messages: transcript.targetHumanMessages
      };
    }));

    // Keep the block enforced at the persistence boundary as a defense in depth
    // if a future candidate source bypasses the summary filter.
    const saved = evaluations.filter((item) => item && !isBlockedInternalAssessor_(item)).sort((a, b) => {
      const aIndex = pendingCandidates.findIndex((candidate) => candidate.name === a.responsibleName);
      const bIndex = pendingCandidates.findIndex((candidate) => candidate.name === b.responsibleName);
      return aIndex - bIndex;
    });
    if (!saved.length) return notEvaluable_(metadata, "model_not_evaluable");

    if (services.appendRecords) {
      await services.appendRecords(saved);
    } else {
      for (const record of saved) {
        await services.appendRecord(record);
      }
    }

    log_("evaluation_saved", { chatId: metadata.chatId, responsibleId: metadata.responsibleId, evaluations: saved.length });
    return result_(200, {
      success: true,
      status: "saved",
      chat_id: metadata.chatId,
      responsible_name: sanitizeBlockedAssessorTrace_(saved[0].responsibleName),
      evaluated_employees: saved.map((item) => ({ responsible_name: sanitizeBlockedAssessorTrace_(item.responsibleName), nota: item.nota })),
      client_name: sanitizeBlockedAssessorTrace_(metadata.clientName),
      nota: saved[0].nota
    });
  } catch (error) {
    const status = Number(error && error.statusCode) || 502;
    const code = String(error && error.code || "evaluation_failed");
    log_("evaluation_failed", { code, status, chatId: request.chat_id });
    return result_(status, { success: false, error: code });
  }
}

function buildTranscript(messages, options) {
  const summary = buildTranscriptSummary_(messages, options);
  const candidate = evaluationCandidates_(summary, options)[0] || {
    id: cleanId_(options && options.responsibleId),
    name: cleanText_(options && options.responsibleName)
  };
  return buildTranscriptFromSummary_(summary, candidate);
}

function selectTranscriptSelection_(messages, options) {
  const windows = transcriptWindows_(options);
  let best = null;

  for (const window of windows) {
    const summary = buildTranscriptSummary_(messages, window);
    const candidates = evaluationCandidates_(summary, options);
    if (!candidates.length) continue;

    const humanCount = (summary.participants || []).reduce((total, participant) => total + Number(participant && participant.count || 0), 0);
    const score = humanCount * 100 + candidates.length;
    if (!best || score > best.score) {
      best = { summary, candidates, score, window: window.windowLabel };
    }
  }

  if (debugEnabled_()) {
    safeLog({
      event: "transcript_window_selection",
      selected: best && best.window || null,
      score: best && best.score || 0,
      candidate_count: best ? best.candidates.length : 0,
      human_message_count: best ? best.summary.participants.reduce((total, participant) => total + Number(participant && participant.count || 0), 0) : 0
    });
  }

  return best;
}

function transcriptWindows_(options) {
  const windows = [];
  const rawStartedAt = parseChatAppDate_(options && options.rawSessionStartedAt);
  const rawClosedAt = parseChatAppDate_(options && options.rawSessionClosedAt);
  const adjustedStartedAt = toDate_(options && options.sessionStartedAt);
  const adjustedClosedAt = toDate_(options && options.sessionClosedAt);

  if (rawClosedAt) {
    windows.push({
      windowLabel: "raw",
      sessionStartedAt: rawStartedAt ? rawStartedAt.toISOString() : "",
      sessionClosedAt: rawClosedAt.toISOString()
    });
  }

  if (adjustedClosedAt) {
    const rawAndAdjustedAreEqual =
      rawClosedAt && rawStartedAt &&
      rawClosedAt.getTime() === adjustedClosedAt.getTime() &&
      (!!adjustedStartedAt === !!rawStartedAt) &&
      (!adjustedStartedAt || adjustedStartedAt.getTime() === rawStartedAt.getTime());

    if (!rawAndAdjustedAreEqual) {
      windows.push({
        windowLabel: "adjusted",
        sessionStartedAt: adjustedStartedAt ? adjustedStartedAt.toISOString() : "",
        sessionClosedAt: adjustedClosedAt.toISOString()
      });
    }
  }

  return windows;
}

function buildTranscriptSummary_(messages, options) {
  const opt = options || {};
  const closedAt = toDate_(opt.sessionClosedAt);
  const startedAt = toDate_(opt.sessionStartedAt);
  const lines = [];
  const participants = new Map();
  let hadReliableBoundary = !!startedAt;

  for (const message of Array.isArray(messages) ? messages : []) {
    const when = messageDate_(message);
    // Early debug: always log arrival and timestamp checks so we can see why a
    // message was skipped (outside window) before other filters.
      if (debugEnabled_()) {
        try {
          const msgInfoEarly = debugMessageInfo_(message);
          safeLog({ event: "message_received", id: msgInfoEarly.id, when: when ? when.toISOString() : null, closedAt: closedAt ? closedAt.toISOString() : null, startedAt: startedAt ? startedAt.toISOString() : null, info: msgInfoEarly });
        } catch (_) {}
      }
    if (closedAt && when && when > closedAt) continue;
    if (startedAt && when && when < startedAt) continue;
    // Session boundary detection is still a passthrough condition.
    if (isSessionBoundary_(message)) {
      hadReliableBoundary = true;
      if (debugEnabled_()) safeLog({ event: "message_session_boundary", info: debugMessageInfo_(message) });
      continue;
    }

    // Build debug info and log it when debugging is enabled.
    const msgInfo = debugMessageInfo_(message);
    if (debugEnabled_()) safeLog({ event: "message_inspect", info: msgInfo });

    const excludedReasons = exclusionReasons_(message);
    if (excludedReasons.length) {
      if (debugEnabled_()) safeLog({ event: "message_excluded", id: msgInfo.id, reasons: excludedReasons });
      continue;
    }
    const side = String(message && message.side || "").toLowerCase();
    const text = messageText_(message);
    if (!text) continue;
    const time = when ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(when) : "--:--";
    if (side === "in") {
      lines.push({ time, side: "in", author: { id: "", name: "CLIENTE" }, text: sanitizePii_(text) });
      continue;
    }
    if (side !== "out") continue;

    const author = authorOf_(message);
    if (!author.id && !author.name) continue; // autoria desconhecida nunca pontua o responsavel
    const key = participantKey_(author);
    const name = author.name || (author.id ? "Funcionário " + author.id : "não identificado");
    const participant = participants.get(key) || { id: author.id, name, identifiers: author.identifiers || [], count: 0 };
    participant.count += 1;
    participants.set(key, participant);
    lines.push({ time, side: "out", author: { id: author.id, name, identifiers: author.identifiers || [] }, text: sanitizePii_(text) });
  }

  return { lines, participants: Array.from(participants.values()), hadReliableBoundary };
}

function buildTranscriptFromSummary_(summary, candidate) {
  const target = candidate || {};
  let targetHumanMessages = 0;
  const lines = [];
  for (const line of summary.lines || []) {
    if (typeof line === "string") {
      lines.push(line);
      continue;
    }
    if (line.side === "in") {
      lines.push("[" + line.time + "] CLIENTE: " + line.text);
      continue;
    }
    const isTarget = participantMatches_(line.author, target);
    const label = isTarget ? "ASSESSOR - " + target.name : "OUTRO PARTICIPANTE - " + (line.author && line.author.name || "não identificado");
    lines.push("[" + line.time + "] " + label + ": " + line.text);
    if (isTarget) targetHumanMessages += 1;
  }
  return { text: lines.join("\n"), targetHumanMessages, hadReliableBoundary: !!summary.hadReliableBoundary };
}

function buildCapturedTextsFromSummary_(summary) {
  const lines = [];
  for (const line of summary.lines || []) {
    if (typeof line === "string") {
      const parsed = line.match(/^\[([^\]]+)\]\s*([^:]+):\s*(.*)$/);
      if (parsed) lines.push(cleanText_(parsed[2]) + " - " + cleanText_(parsed[1]) + " - " + cleanText_(parsed[3]));
      continue;
    }
    const author = line.side === "in" ? "CLIENTE" : cleanText_(line.author && line.author.name) || "não identificado";
    const time = cleanText_(line.time) || "--:--";
    const text = cleanText_(line.text);
    if (text) lines.push(author + " - " + time + " - " + text);
  }
  return lines.join("\n");
}

function evaluationCandidates_(summary, options) {
  const opt = options || {};
  const responsible = { id: cleanId_(opt.responsibleId), name: cleanText_(opt.responsibleName) };
  const participants = (summary.participants || []).slice().sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
  if (!participants.length) return [];
  const selected = [];
  const responsibleParticipant = participants.find((participant) => participantMatches_(participant, responsible));
  if (responsibleParticipant) selected.push({ id: responsibleParticipant.id || responsible.id, name: responsible.name || responsibleParticipant.name, identifiers: responsibleParticipant.identifiers || [], count: responsibleParticipant.count });
  for (const participant of participants) {
    if (selected.length >= MAX_EMPLOYEES_PER_EVALUATION) break;
    if (selected.some((item) => participantMatches_(participant, item))) continue;
    selected.push({ id: participant.id, name: participant.name, identifiers: participant.identifiers || [], count: participant.count });
  }
  return selected.filter((item) => item.name && item.count > 0);
}

function filterBlockedEvaluationCandidates_(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!blockInternalAssessorEvaluation_()) return list;
  return list.filter((candidate) => !isBlockedInternalAssessor_(candidate));
}

function isBlockedInternalAssessor_(candidate) {
  const identifiers = candidateIdentifiers_(candidate);
  return identifiers.some((identifier) => BLOCKED_INTERNAL_ASSESSOR_IDENTIFIERS.has(identifier));
}

function candidateIdentifiers_(candidate) {
  const identifiers = [];
  const raw = cleanId_(candidate && candidate.id);
  if (raw) {
    identifiers.push(raw);
    const digits = raw.replace(/\D/g, "");
    if (digits) identifiers.push(digits);
  }
  const name = cleanText_(candidate && candidate.name);
  const nameDigits = name.replace(/\D/g, "");
  if (nameDigits && !/[A-Za-zÀ-ÿ]/.test(name)) identifiers.push(nameDigits);
  for (const value of Array.isArray(candidate && candidate.identifiers) ? candidate.identifiers : []) {
    const rawValue = cleanId_(value);
    if (!rawValue) continue;
    identifiers.push(rawValue);
    const digits = rawValue.replace(/\D/g, "");
    if (digits) identifiers.push(digits);
  }
  return Array.from(new Set(identifiers));
}

function filterBlockedEvaluationSummary_(summary) {
  if (!blockInternalAssessorEvaluation_() || !summary) return summary;
  return {
    lines: (Array.isArray(summary.lines) ? summary.lines : [])
      .filter((line) => !(line && typeof line === "object" && line.side === "out" && isBlockedInternalAssessor_(line.author)))
      .map((line) => {
        if (typeof line === "string") return sanitizeBlockedAssessorTrace_(line);
        return Object.assign({}, line, {
          text: sanitizeBlockedAssessorTrace_(line.text),
          author: line.author && Object.assign({}, line.author, {
            name: sanitizeBlockedAssessorTrace_(line.author.name)
          })
        });
      }),
    participants: (Array.isArray(summary.participants) ? summary.participants : [])
      .filter((participant) => !isBlockedInternalAssessor_(participant)),
    hadReliableBoundary: !!summary.hadReliableBoundary
  };
}

function allCandidatesAlreadyProcessedFromRows_(rows, candidates, metadata) {
  if (!Array.isArray(rows) || !candidates.length) return false;
  return candidates.every((candidate) => recordExistsInRows_(rows, metadata.chatId, metadata.closedAtDisplay, candidate.name));
}

function recordExistsInRows_(rows, chatId, closedAt, responsibleName) {
  return Array.isArray(rows) && rows.some((row) => String(row[0] || "") === String(chatId) && String(row[2] || "") === String(closedAt) && normalizeName_(row[1]) === normalizeName_(responsibleName));
}

function normalizeRequest_(body) {
  const closedDate = offsetChatAppDate_(parseChatAppDate_(body.closed_at));
  const closedAtIso = closedDate && closedDate.toISOString();
  // Accept either `session_started_at` or `started_at` as the started timestamp.
  const startedAtRaw = body.session_started_at || body.started_at;
  const startedAtField = body.session_started_at ? "session_started_at" : "started_at";
  const startedDate = offsetChatAppDate_(parseChatAppDate_(startedAtRaw));
  const startedAtIso = startedDate ? startedDate.toISOString() : "";
  if (debugEnabled_()) safeLog({ event: 'normalized_request', raw_closed_at: body.closed_at, closedAt: closedAtIso, raw_started_at: startedAtRaw, startedAt: startedAtIso });
  return {
    chat_id: cleanId_(body.chat_id), license_id: cleanId_(body.license_id),
    messenger_type: cleanText_(body.messenger_type), source: cleanText_(body.source),
    sourceLabel: normalizeEvaluationSource_(body.source),
    closed_at: cleanText_(body.closed_at), closedAt: closedAtIso,
    // sessionStartedAt is optional and used together with closedAt when provided
    sessionStartedAt: startedAtIso,
    closedAtRaw: cleanText_(body.closed_at),
    sessionStartedAtRaw: cleanText_(startedAtRaw),
    sessionStartedAtField: startedAtField
  };
}

function notEvaluable_(metadata, reason) {
  log_("evaluation_not_evaluable", { reason, chatId: metadata.chatId, responsibleId: metadata.responsibleId });
  return result_(200, { success: true, status: "not_evaluable", chat_id: metadata.chatId, reason });
}

function parseBody_(body) {
  if (body && typeof body === "object") return body;
  try { return JSON.parse(String(body || "{}")); } catch (_) { return {}; }
}
function tokenValid_(headers) {
  const expected = String(process.env.CHATAPP_INTERNAL_TOKEN || "").trim();
  const match = String(headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return !!expected && !!match && match[1].trim() === expected;
}
function unwrapData_(value) { return value && value.data ? value.data : value; }
function cleanText_(value) { return String(value == null ? "" : value).trim(); }
function cleanId_(value) { return cleanText_(value); }
function toDate_(value) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function parseChatAppDate_(value) {
  const raw = cleanText_(value);
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return toDate_(raw);

  const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;

  // ChatApp sends a local wall-clock value. Keep the components stable here;
  // offsetChatAppDate_ applies the project/proxy offset before internal ISO use.
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) return null;
  return date;
}
function normalizeEvaluationSource_(value) {
  const source = cleanText_(value).toLowerCase();
  if (source === "chatapp") return "ChatApp";
  if (source === "bitrix24") return "Bitrix24";
  return "";
}
function invalidDateResult_(field) {
  return result_(400, {
    success: false,
    error: "invalid_" + field,
    message: field + " must be a valid date in ISO format or ChatApp format DD.MM.YYYY HH:MM:SS"
  });
}
function result_(status, payload) { return { status, payload }; }
function externalError_(code, statusCode) { const e = new Error(code); e.code = code; e.statusCode = statusCode; return e; }
function log_(event, details) { safeLog(Object.assign({ event, feature: "chatapp_evaluation" }, details || {})); }

function messageDate_(message) {
  if (!message) return null;
  // Common shapes:
  // - message.time (epoch seconds)
  // - message.createdAt (ISO)
  // - message.created_at (ISO)
  // - message.created.date / created.at (ISO or epoch)
  if (typeof message.time === 'number') return new Date(message.time * 1000);
  const created = message.created;
  if (typeof message.createdAt === 'string') return toDate_(message.createdAt);
  if (typeof message.created_at === 'string') return toDate_(message.created_at);
  if (created) {
    if (typeof created.date === 'string' || typeof created.date === 'number') return toDate_(created.date);
    if (typeof created.at === 'string' || typeof created.at === 'number') return toDate_(created.at);
    // Some responses include created as an object with numeric id only — ignore.
    if (typeof created === 'string' || typeof created === 'number') return toDate_(created);
  }
  return null;
}
function messageText_(message) {
  if (!message) return "";
  // Possible shapes:
  // - message.text (string)
  // - message.message.text (string)
  // - message.content.text or message.content.body
  // - message.payload.text
  const topText = typeof message.text === 'string' && message.text.trim() ? message.text.trim() : null;
  if (topText) return topText;
  const nestedMsg = message.message;
  if (nestedMsg && typeof nestedMsg === 'object') {
    if (typeof nestedMsg.text === 'string' && nestedMsg.text.trim()) return nestedMsg.text.trim();
    if (typeof nestedMsg.caption === 'string' && nestedMsg.caption.trim()) return nestedMsg.caption.trim();
  }
  if (message.content && typeof message.content === 'object') {
    if (typeof message.content.text === 'string' && message.content.text.trim()) return message.content.text.trim();
    if (typeof message.content.body === 'string' && message.content.body.trim()) return message.content.body.trim();
  }
  if (message.payload && typeof message.payload.text === 'string' && message.payload.text.trim()) return message.payload.text.trim();
  if (message && (message.file || message.attachment || message.attachments)) return "[arquivo enviado]";
  return "";
}
function authorOf_(message) {
  // Prefer `created.id` as the authoritative responsible id (ChatApp provides
  // employee id there). `fromUser` typically contains the phone number.
  const sender = message && (message.fromUser || message.sender || (message.fromApp && message.fromApp.sender) || {});
  const createdId = message && message.created && message.created.id;
  const senderName = (sender && (sender.fullName || sender.name)) ||
    (message && message.created && message.created.name) ||
    (message && message.fromApp && (message.fromApp.name || message.fromApp.id)) || "";
  const rawName = senderName;
  const mappedId = KNOWN_ASSESSOR_IDS[normalizeName_(rawName)];
  const senderId = sender && sender.id;
  const id = mappedId || createdId || senderId || null;
  return {
    id: cleanId_(id),
    name: cleanText_(rawName),
    identifiers: [cleanId_(id), cleanId_(createdId)].filter(Boolean)
  };
}
function isExcluded_(message) {
  const reasons = exclusionReasons_(message);
  return reasons.length > 0;
}

function debugEnabled_() { return !!String(process.env.DEBUG_CHATAPP_EVAL || "").trim(); }
function blockInternalAssessorEvaluation_() { return cleanText_(process.env.CHATAPP_EVALUATION_BLOCK_INTERNAL_ASSESSOR).toLowerCase() === "true"; }

function exclusionReasons_(message) {
  const reasons = [];
  const text = messageText_(message);
  const sender = authorOf_(message);
  const kind = String(message && (message.type || message.kind || message.event) || "");
  const subtype = String(message && message.subtype || "").toLowerCase();
  const fromAppId = message && message.fromApp && String(message.fromApp.id || "").toLowerCase();

  if (!text) reasons.push("no_text");
  if (subtype === "command") reasons.push("subtype_command");
  if (/^\//.test(text)) reasons.push("leading_slash_command");
  if (/system|debug|technical/i.test(kind)) reasons.push("technical_event");
  if (message && (message.system || message.isSystem || message.automated || message.isBot)) reasons.push("system_flag");
  if (AUTOMATION_PATTERN.test(sender.name)) reasons.push("automation_name_sender");
  if (AUTOMATION_PATTERN.test(String(message && message.fromApp && message.fromApp.name || ""))) reasons.push("automation_name_fromApp");
  if (fromAppId === "msbot") reasons.push("fromapp_msbot");

  return reasons;
}

function debugMessageInfo_(message) {
  const info = {
    id: message && (message.id || message.internalId || null),
    side: String(message && message.side || "").toLowerCase(),
    subtype: message && message.subtype || null,
    fromAppId: message && message.fromApp && message.fromApp.id || null,
    fromAppName: message && message.fromApp && (message.fromApp.name || message.fromApp.sender) || null,
    fromUserName: message && message.fromUser && (message.fromUser.name || message.fromUser.username) || null,
    text: messageText_(message),
    reasons: exclusionReasons_(message)
  };
  return info;
}
function isSessionBoundary_(message) {
  const value = String(message && (message.event || message.type || message.status) || "").toLowerCase();
  return /chatstatus|reopen|\bopen\b/.test(value) && !!(message && (message.system || message.isSystem));
}
function namesMatch_(a, b) { return normalizeName_(a) && normalizeName_(a) === normalizeName_(b); }
function normalizeName_(value) { return cleanText_(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function participantKey_(author) { return author.id ? "id:" + author.id : "name:" + normalizeName_(author.name); }
function participantMatches_(author, target) {
  return !!(author && target) && ((author.id && target.id && cleanId_(author.id) === cleanId_(target.id)) || namesMatch_(author.name, target.name));
}
function offsetChatAppDate_(date) {
  if (!date) return null;
  return new Date(date.getTime() + chatAppTimeOffsetHours_() * 60 * 60 * 1000);
}
function chatAppTimeOffsetHours_() {
  const raw = process.env.CHATAPP_EVALUATION_TIME_OFFSET_HOURS;
  if (raw == null || raw === "") return DEFAULT_CHATAPP_TIME_OFFSET_HOURS;
  const value = Number(raw);
  return Number.isFinite(value) ? value : DEFAULT_CHATAPP_TIME_OFFSET_HOURS;
}
function sanitizePii_(text) {
  return String(text).replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-mail removido]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf removido]")
    .replace(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[\s-]?\d{4}\b/g, "[telefone removido]");
}
function sanitizeBlockedAssessorTrace_(value) {
  const text = cleanText_(value);
  if (!blockInternalAssessorEvaluation_() || !text) return text;
  return text
    .replace(/5531973239098/g, "[assessor bloqueado]")
    .replace(/\b66345\b/g, "[assessor bloqueado]");
}
function formatClosedAt_(iso) {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return byType.year + "-" + byType.month + "-" + byType.day + " " + byType.hour + ":" + byType.minute + ":" + byType.second;
}

module.exports = { handleEvaluation, buildTranscript, formatClosedAt_, parseChatAppDate_, buildCapturedTextsFromSummary_, normalizeEvaluationSource_ };
