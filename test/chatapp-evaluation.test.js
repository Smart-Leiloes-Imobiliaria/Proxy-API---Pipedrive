"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const evaluation = require("../lib/chatapp-evaluation.js");
const clients = require("../lib/chatapp-evaluation-clients.js");

process.env.CHATAPP_INTERNAL_TOKEN = "test-token";
const CLOSED_AT = "2026-08-21T15:30:00.000Z";

function request(overrides) {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    body: JSON.stringify(Object.assign({ chat_id: "chat-1", license_id: "license-1", messenger_type: "whatsapp", closed_at: CLOSED_AT, source: "helper_close" }, overrides || {}))
  };
}
function message(overrides) {
  return Object.assign({ side: "out", text: "Olá, como posso ajudar?", createdAt: "2026-08-21T15:00:00.000Z", fromApp: { sender: { id: "agent-1", fullName: "Isaque Coelho" } } }, overrides || {});
}
function services(overrides) {
  const state = { records: [], evaluated: 0 };
  const base = {
    getChat: async () => ({ data: { id: "chat-1", name: "Cliente Teste", responsible: { id: "agent-1" }, status: "closed" } }),
    getEmployee: async () => ({ data: { fullName: "Isaque Coelho" } }),
    listMessages: async () => [message({ side: "in", text: "Preciso de ajuda", fromApp: undefined }), message()],
    evaluate: async () => { state.evaluated += 1; return { avaliavel: true, nota: 4 }; },
    hasRecord: async (chatId, closedAt) => state.records.some((record) => record.chatId === chatId && record.closedAt === closedAt),
    hasEvaluationRecord: async (chatId, closedAt, responsibleName) => state.records.some((record) => record.chatId === chatId && record.closedAt === closedAt && record.responsibleName === responsibleName),
    appendRecord: async (record) => { state.records.push(record); }
  };
  return { state, deps: Object.assign(base, overrides || {}) };
}

async function main() {
  // 1. Atendimento normal.
  let fixture = services();
  let result = await evaluation.handleEvaluation(request(), fixture.deps);
  assert.equal(result.status, 200); assert.equal(result.payload.status, "saved"); assert.equal(fixture.state.records.length, 1);

  // 2. Mais de 100 mensagens: o builder preserva todas as mensagens validas.
  const many = Array.from({ length: 101 }, (_, index) => message({ text: "Resposta " + index }));
  let transcript = evaluation.buildTranscript(many, { responsibleId: "agent-1", responsibleName: "Isaque Coelho", sessionClosedAt: CLOSED_AT });
  assert.equal(transcript.targetHumanMessages, 101);
  // O cliente oficial percorre a proxima pagina, em vez de supor maximo de 100.
  const originalFetch = global.fetch;
  Object.assign(process.env, {
    CHATAPP_API_BASE_URL: "https://chatapp.test", CHATAPP_API_TOKEN: "token", CHATAPP_COMPANY_ID: "company",
    GOOGLE_SHEETS_SPREADSHEET_ID: "sheet", GOOGLE_SHEETS_SHEET_NAME: "Avaliacoes",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "service@test", GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "key"
  });
  let pageCalls = 0;
  global.fetch = async (url) => {
    pageCalls += 1;
    const second = String(url).includes("page=2");
    return { ok: true, status: 200, json: async () => ({ data: { messages: [message({ text: second ? "pagina dois" : "pagina um" })], pagination: second ? {} : { next_page: 2 } } }) };
  };
  try {
    const paged = await clients.createServices().listMessages({ license_id: "l", messenger_type: "m", chat_id: "c" });
    assert.equal(paged.length, 2); assert.equal(pageCalls, 2);
  } finally { global.fetch = originalFetch; }

  // O cliente oficial renova token expirado, captura novo access/refresh token
  // e usa o access token novo na chamada de dados.
  delete require.cache[require.resolve("../lib/chatapp-evaluation-clients.js")];
  const clientsWithRefresh = require("../lib/chatapp-evaluation-clients.js");
  Object.assign(process.env, {
    CHATAPP_API_BASE_URL: "https://chatapp.test",
    CHATAPP_COMPANY_ID: "company",
    CHATAPP_ACCESS_TOKEN: "expired-access",
    CHATAPP_ACCESS_TOKEN_END_TIME: "1",
    CHATAPP_REFRESH_TOKEN: "old-refresh",
    CHATAPP_REFRESH_TOKEN_END_TIME: String(Math.floor(Date.now() / 1000) + 3600),
    CHATAPP_EMAIL: "chatapp@test",
    CHATAPP_PASSWORD: "secret",
    CHATAPP_APP_ID: "app"
  });
  delete process.env.CHATAPP_API_TOKEN;
  const refreshCalls = [];
  global.fetch = async (url, options) => {
    refreshCalls.push({ url: String(url), headers: options.headers });
    if (String(url).endsWith("/v1/tokens/refresh")) {
      assert.equal(options.headers.Refresh, "old-refresh");
      return { ok: true, status: 200, json: async () => ({ accessToken: "new-access", accessTokenEndTime: Math.floor(Date.now() / 1000) + 3600, refreshToken: "new-refresh", refreshTokenEndTime: Math.floor(Date.now() / 1000) + 7200 }) };
    }
    assert.equal(options.headers.authorization, "new-access");
    return { ok: true, status: 200, json: async () => ({ data: { id: "chat-1" } }) };
  };
  try {
    await clientsWithRefresh.createServices().getChat({ license_id: "l", messenger_type: "m", chat_id: "c" });
    assert.equal(refreshCalls.length, 2);
    assert.ok(refreshCalls[0].url.endsWith("/v1/tokens/refresh"));
  } finally { global.fetch = originalFetch; }

  // O prompt pode vir de arquivo, o que facilita local e Vercel sem env gigante.
  const promptFile = path.join(process.cwd(), "tmp-chatapp-evaluation-prompt.txt");
  fs.writeFileSync(promptFile, "Prompt de arquivo para teste\n", "utf8");
  delete require.cache[require.resolve("../lib/chatapp-evaluation-clients.js")];
  const clientsWithPromptFile = require("../lib/chatapp-evaluation-clients.js");
  Object.assign(process.env, {
    EVALUATION_PROMPT_FILE: "tmp-chatapp-evaluation-prompt.txt",
    OPENAI_API_KEY: "openai-key",
    OPENAI_MODEL: "gpt-test"
  });
  delete process.env.EVALUATION_PROMPT;
  global.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    const body = JSON.parse(options.body);
    assert.equal(body.instructions, "Prompt de arquivo para teste");
    assert.equal(body.max_output_tokens, 420);
    assert.equal(body.text.format.schema.properties.justificativa.maxLength, 900);
    const detailedReason = "O assessor foi objetivo, cordial e conduziu o cliente com orientação prática. Não houve critério de perda identificado no trecho analisado. A nota reflete atendimento claro, com boa experiência para o cliente e sem falhas relevantes.";
    return { ok: true, status: 200, json: async () => ({ output_text: JSON.stringify({ avaliavel: true, nota: 4, justificativa: detailedReason }) }) };
  };
  try {
    const resultFromFilePrompt = await clientsWithPromptFile.createServices().evaluate({ responsibleName: "Isaque", transcript: "Teste" });
    assert.equal(resultFromFilePrompt.nota, 4);
    assert.ok(resultFromFilePrompt.justificativa.includes("Não houve critério de perda"));
  } finally {
    global.fetch = originalFetch;
    fs.unlinkSync(promptFile);
  }

  // 3. Sem responsavel, mas com autoria humana no historico: avalia quem respondeu.
  fixture = services({ getChat: async () => ({ data: { id: "chat-1", name: "Cliente", responsible: null } }) });
  result = await evaluation.handleEvaluation(request(), fixture.deps); assert.equal(result.payload.status, "saved"); assert.equal(result.payload.responsible_name, "Isaque Coelho");

  // 4. Responsavel sem mensagens humanas.
  fixture = services({ listMessages: async () => [message({ fromApp: { sender: { id: "bot", name: "Router" } } })] });
  result = await evaluation.handleEvaluation(request(), fixture.deps); assert.equal(result.payload.reason, "no_human_messages");

  // 5/6. Bot e comandos internos sao removidos; apenas o assessor conta.
  transcript = evaluation.buildTranscript([message({ text: "/rotearfunil" }), message({ fromApp: { sender: { id: "bot", name: "ChatApp Bot" } } }), message({ text: "Resposta humana" })], { responsibleId: "agent-1", responsibleName: "Isaque Coelho", sessionClosedAt: CLOSED_AT });
  assert.equal(transcript.targetHumanMessages, 1); assert.ok(!transcript.text.includes("rotearfunil"));

  // 7/8/9. Falhas de modelo, modelo indisponivel e Sheets indisponivel nao sao sucesso.
  fixture = services({ evaluate: async () => ({ avaliavel: true, nota: 6 }) });
  result = await evaluation.handleEvaluation(request(), fixture.deps); assert.equal(result.status, 502); assert.equal(result.payload.error, "invalid_openai_response");
  fixture = services({ evaluate: async () => { const error = new Error(); error.code = "openai_timeout"; error.statusCode = 504; throw error; } });
  result = await evaluation.handleEvaluation(request(), fixture.deps); assert.equal(result.status, 504); assert.equal(result.payload.error, "openai_timeout");
  fixture = services({ appendRecord: async () => { const error = new Error(); error.code = "google_sheets_http_503"; error.statusCode = 502; throw error; } });
  result = await evaluation.handleEvaluation(request(), fixture.deps); assert.equal(result.status, 502); assert.equal(result.payload.error, "google_sheets_http_503");

  // 10/11. Chave de idempotencia e ChatID + horario de fechamento.
  fixture = services();
  await evaluation.handleEvaluation(request(), fixture.deps);
  result = await evaluation.handleEvaluation(request(), fixture.deps); assert.equal(result.payload.status, "already_processed");
  result = await evaluation.handleEvaluation(request({ closed_at: "2026-08-22T15:30:00.000Z" }), fixture.deps); assert.equal(result.payload.status, "saved");

  // 12. Outro funcionario fica apenas como contexto, nao conta para o alvo.
  transcript = evaluation.buildTranscript([message({ fromApp: { sender: { id: "agent-2", fullName: "Outra Pessoa" } } }), message()], { responsibleId: "agent-1", responsibleName: "Isaque Coelho", sessionClosedAt: CLOSED_AT });
  assert.equal(transcript.targetHumanMessages, 1); assert.ok(transcript.text.includes("OUTRO PARTICIPANTE"));

  // 12b. Se dois funcionarios responderam, grava avaliacao para os dois mais ativos.
  fixture = services({
    listMessages: async () => [
      message({ text: "Resposta principal 1" }),
      message({ text: "Resposta principal 2" }),
      message({ text: "Resposta secundaria", fromApp: { sender: { id: "agent-2", fullName: "Outra Pessoa" } } })
    ],
    evaluate: async (input) => {
      assert.ok(input.transcript.includes("TRANSCRIPT NORMALIZADO") === false);
      assert.ok(input.transcript.includes("ASSESSOR - " + input.responsibleName));
      assert.ok(!input.transcript.includes("\"createdAt\""));
      return { avaliavel: true, nota: input.responsibleName === "Isaque Coelho" ? 5 : 3 };
    }
  });
  result = await evaluation.handleEvaluation(request({ closed_at: "2026-08-23T15:30:00.000Z" }), fixture.deps);
  assert.equal(result.payload.status, "saved");
  assert.equal(fixture.state.records.length, 2);
  assert.deepEqual(result.payload.evaluated_employees.map((item) => item.responsible_name), ["Isaque Coelho", "Outra Pessoa"]);

  // 12c. O closed_at recebido do ChatApp e deslocado +3h por padrao antes de
  // virar chave/display da planilha.
  fixture = services();
  result = await evaluation.handleEvaluation(request({ closed_at: "2026-08-24T15:30:00.000Z" }), fixture.deps);
  assert.equal(fixture.state.records[0].closedAt, "2026-08-24 15:30:00");

  // 12d. Se a janela ajustada nao capturar mensagens humanas, o endpoint
  // tenta a janela bruta do payload antes de desistir.
  fixture = services({
    getChat: async () => ({ data: { id: "chat-1", name: "Cliente", responsible: null } }),
    listMessages: async () => [
      message({ side: "in", text: "Preciso de ajuda", createdAt: "2026-08-25T14:04:00.000Z", fromApp: undefined }),
      message({ text: "Mensagem humana fora do offset", createdAt: "2026-08-25T14:05:00.000Z", fromApp: { id: "webchat", sender: "employee" }, fromUser: { id: "emp-1", name: "Atendente Externo" } }),
      message({ text: "/fechar", subtype: "command", createdAt: "2026-08-25T17:06:00.000Z", fromApp: { id: "webchat", sender: "employee" } })
    ]
  });
  result = await evaluation.handleEvaluation(request({ started_at: "2026-08-25T14:01:00.000Z", closed_at: "2026-08-25T14:13:00.000Z" }), fixture.deps);
  assert.equal(result.payload.status, "saved");
  assert.equal(result.payload.responsible_name, "Atendente Externo");

  // 13. Erro e resposta estruturada; o Scenario deve seguir o caminho de fechamento.
  fixture = services({ getChat: async () => { const error = new Error(); error.code = "chatapp_timeout"; error.statusCode = 504; throw error; } });
  result = await evaluation.handleEvaluation(request(), fixture.deps); assert.equal(result.status, 504); assert.equal(result.payload.success, false);

  // 14. Nome do cliente ausente e aceito. 15. ChatApp HTTP propagado de forma coerente.
  fixture = services({ getChat: async () => ({ data: { id: "chat-1", responsible: { id: "agent-1" } } }) });
  result = await evaluation.handleEvaluation(request(), fixture.deps); assert.equal(result.payload.status, "saved"); assert.equal(result.payload.client_name, "");
  fixture = services({ getChat: async () => { const error = new Error(); error.code = "chatapp_http_401"; error.statusCode = 401; throw error; } });
  result = await evaluation.handleEvaluation(request(), fixture.deps); assert.equal(result.status, 401); assert.equal(result.payload.error, "chatapp_http_401");

  // Autenticacao, metodo e payload tambem permanecem protegidos.
  result = await evaluation.handleEvaluation(Object.assign(request(), { headers: {} }), services().deps); assert.equal(result.status, 401);
  result = await evaluation.handleEvaluation(Object.assign(request(), { method: "GET" }), services().deps); assert.equal(result.status, 405);
  result = await evaluation.handleEvaluation(request({ chat_id: "" }), services().deps); assert.equal(result.status, 400);
  console.log("chatapp-evaluation: ok");
}

main().catch((error) => { console.error(error); process.exit(1); });
