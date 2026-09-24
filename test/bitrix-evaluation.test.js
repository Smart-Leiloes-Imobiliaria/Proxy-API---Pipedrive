"use strict";

const assert = require("assert/strict");
const evaluation = require("../lib/bitrix-evaluation.js");

process.env.BITRIX_INTERNAL_TOKEN = "bitrix-test-token";
process.env.BITRIX_ALLOWED_SESSION_IDS = "321";
process.env.BITRIX_MEMBER_ID = "portal-1";

const history = {
  sessionId: 321, chatId: 1763,
  message: {
    "1": { id: "1", senderid: "900", date: "2026-08-28T14:00:00-03:00", text: "Preciso de ajuda" },
    "2": { id: "2", senderid: "103", date: "2026-08-28T14:01:00-03:00", text: "Vou ajudar" }
  },
  users: { "900": { name: "Cliente", connector: true }, "103": { name: "Maria", connector: false } },
  chat: { "1763": { owner: "103", managerList: [], entityId: "livechat|19|abc|900" } }
};

function request(body, token) {
  return { method: "POST", headers: { authorization: "Bearer " + (token || "bitrix-test-token") }, body: JSON.stringify(Object.assign({ member_id: "portal-1", session_id: 321, source: "bitrix24" }, body || {})) };
}

async function main() {
  const state = { evaluated: 0, rows: [], saved: [] };
  const services = {
    getSessionHistory: async () => history,
    evaluate: async () => { state.evaluated += 1; return { avaliavel: true, nota: 5, justificativa: "Bom atendimento" }; },
    listRecords: async () => state.rows,
    appendRecords: async (records) => { state.saved.push(...records); }
  };

  let result = await evaluation.handleBitrixEvaluation(request({ dry_run: true }), services);
  assert.equal(result.payload.status, "dry_run");
  assert.equal(state.evaluated, 0); assert.equal(state.saved.length, 0);
  assert.ok(result.payload.transcript.includes("ASSESSOR: Maria"));

  result = await evaluation.handleBitrixEvaluation(request(), services);
  assert.equal(result.payload.status, "saved"); assert.equal(state.evaluated, 1); assert.equal(state.saved.length, 1);
  assert.equal(state.saved[0].sessionId, 321); assert.equal(state.saved[0].responsibleId, "103");
  assert.equal(state.saved[0].chatId, 1763);
  assert.equal(state.saved[0].chatLink, "https://smartcaixa.bitrix24.com.br/online/?IM_LINES=chat1763");

  state.rows = [[1763, "https://smartcaixa.bitrix24.com.br/online/?IM_LINES=chat1763", "Maria", "2026-08-28 14:01:00", "Cliente", 5, "Bom atendimento", "...", "Bitrix24"]];
  result = await evaluation.handleBitrixEvaluation(request(), services);
  assert.equal(result.payload.status, "already_processed");

  state.rows = []; state.saved = []; state.evaluated = 0;
  result = await evaluation.handleBitrixEvaluation(request({ session_id: undefined, chat_id: 1763 }), services);
  assert.equal(result.payload.status, "saved");
  assert.equal(result.payload.session_resolution, "latest_by_chat_id");
  assert.equal(result.payload.session_id, 321);

  result = await evaluation.handleBitrixEvaluation({
    method: "POST",
    headers: { authorization: "Bearer bitrix-test-token" },
    body: JSON.stringify({ chat_id: 1763, source: "bitrix24", dry_run: true })
  }, services);
  assert.equal(result.payload.member_id, "portal-1");

  result = await evaluation.handleBitrixEvaluation(request({}, "wrong"), services);
  assert.equal(result.status, 401);
  result = await evaluation.handleBitrixEvaluation(request({ session_id: 999 }), services);
  assert.equal(result.payload.error, "bitrix_session_not_allowed");
  console.log("ok bitrix-evaluation");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
