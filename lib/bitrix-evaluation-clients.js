"use strict";

const shared = require("./chatapp-evaluation-clients.js");
const { createBitrixClient } = require("./bitrix-client.js");
const { createBitrixSupabaseRepository } = require("./bitrix-supabase-repository.js");

function createServices(options) {
  const opt = options || {};
  const installationRepository = opt.installationRepository || configuredInstallationRepository_();
  const client = createBitrixClient({ installationRepository, fetchImpl: opt.fetchImpl });
  return {
    getSessionHistory: (memberId, identifiers) => {
      const ids = identifiers || {};
      const params = ids.sessionId ? { SESSION_ID: ids.sessionId } : { CHAT_ID: ids.chatId };
      return client.callMethod(memberId, "imopenlines.session.history.get", params);
    },
    evaluate: (input) => shared.evaluateWithOpenAI(input, {
      promptFileEnv: "BITRIX_EVALUATION_PROMPT_FILE",
      fallbackPromptFileEnv: "EVALUATION_PROMPT_FILE",
      transcriptLimitEnv: "BITRIX_EVAL_MAX_TRANSCRIPT_CHARS",
      defaultTranscriptLimit: "12000",
      debugEnv: "BITRIX_DEBUG"
    }),
    listRecords: (...args) => createSheetRepository_().listRecords(...args),
    appendRecords: (...args) => createSheetRepository_().appendRecords(...args),
    installationRepository
  };
}

function configuredInstallationRepository_() {
  if (!clean_(process.env.SUPABASE_URL) || !clean_(process.env.SUPABASE_SECRET_KEY) || !clean_(process.env.BITRIX_TOKEN_ENCRYPTION_KEY)) return null;
  return createBitrixSupabaseRepository();
}

function createSheetRepository_() {
  const spreadsheetId = requiredEnv_("GOOGLE_SHEETS_SPREADSHEET_ID");
  const sheetName = requiredEnv_("GOOGLE_SHEETS_SHEET_NAME");
  const range = encodeURIComponent("'" + sheetName.replace(/'/g, "''") + "'!A:I");
  const url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(spreadsheetId) + "/values/" + range;
  return {
    listRecords: async () => (await shared.sheetsRequest(url, "GET")).values || [],
    appendRecords: async (records) => {
      const rows = Array.isArray(records) ? records : [];
      if (!rows.length) return;
      await shared.sheetsRequest(url + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", "POST", {
        values: rows.map((record) => [record.chatId, record.chatLink, record.responsibleName, record.closedAt, record.clientName, record.nota, record.justificativa, record.capturedTexts, "Bitrix24"])
      });
    }
  };
}

function clean_(value) { return String(value == null ? "" : value).trim(); }
function requiredEnv_(name) { const value = clean_(process.env[name]); if (!value) { const error = new Error("missing_env"); error.code = "missing_env"; error.statusCode = 500; throw error; } return value; }

module.exports = { createServices };
