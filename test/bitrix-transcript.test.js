"use strict";

const assert = require("assert/strict");
const { normalizeBitrixHistory, buildTranscript } = require("../lib/bitrix-transcript.js");

function fixture() {
  return {
    sessionId: 321, chatId: 1763,
    message: {
      "12": { id: "12", senderid: "103", date: "2026-08-28T14:04:00-03:00", text: "Documento enviado", params: { FILE_ID: ["9"] } },
      "10": { id: "10", senderid: "900", date: "2026-08-28T14:02:00-03:00", text: "Meu CPF 123.456.789-00 e a@b.com" },
      "11": { id: "11", senderid: "0", date: "2026-08-28T14:03:00-03:00", text: "Entrou na fila", params: { componentId: "imopenlines" } },
      "13": { id: "13", senderid: "104", date: "2026-08-28T14:05:00-03:00", text: "Vou acompanhar" }
    },
    users: {
      "900": { id: "900", name: "Cliente 11999998888", connector: true },
      "103": { id: "103", name: "Maria", connector: false },
      "104": { id: "104", name: "João", connector: false }
    },
    chat: { "1763": { id: "1763", owner: "103", managerList: [104], entityId: "livechat|19|abc|900" } },
    files: { "9": { extension: "pdf", type: "file" } }
  };
}

const normalized = normalizeBitrixHistory(fixture(), { sessionId: 321, chatId: 1763 });
assert.equal(normalized.lineId, 19);
assert.equal(normalized.connectorId, "livechat");
assert.equal(normalized.lines.length, 3);
assert.deepEqual(normalized.candidateEmployees.map((item) => item.id), ["103", "104"]);
assert.ok(normalized.lines[0].text.includes("[cpf removido]"));
assert.ok(normalized.lines[0].text.includes("[e-mail removido]"));
assert.ok(normalized.lines[1].text.includes("[documento anexado: PDF]"));
assert.ok(buildTranscript(normalized, normalized.candidateEmployees[0]).includes("OUTRO PARTICIPANTE: João"));

const liveChatWithoutConnectorUser = fixture();
delete liveChatWithoutConnectorUser.users["900"];
liveChatWithoutConnectorUser.message["10"].senderid = "0";
const normalizedFallback = normalizeBitrixHistory(liveChatWithoutConnectorUser, { sessionId: 321 });
assert.equal(normalizedFallback.lines[0].role, "CLIENTE");

assert.equal(
  require("../lib/bitrix-transcript.js").sanitizePii_("Código 12345678901234"),
  "Código 12345678901234",
  "não deve substituir um trecho interno de identificador numérico longo"
);

const automation = fixture();
automation.message["10"] = { id: "10", senderid: "0", date: "2026-08-28T14:00:00-03:00", text: "[USER=9 REPLACE]Atendimento[/USER] aceitou a conversa" };
automation.message["12"] = { id: "12", senderid: "103", date: "2026-08-28T14:04:00-03:00", text: "Sua opinião é muito importante para nós https://forms.gle/test Atenciosamente, Equipe Smart" };
automation.message["14"] = { id: "14", senderid: "0", date: "2026-08-28T14:06:00-03:00", text: "[USER=103 REPLACE]Maria[/USER] encerrou a conversa atual" };
const normalizedAutomation = normalizeBitrixHistory(automation, { sessionId: 321 });
assert.ok(!normalizedAutomation.lines.some((line) => /aceitou a conversa|forms\.gle|encerrou a conversa/.test(line.text)));

// Teste de isolamento de atendimento recente em sessao longa/reaberta
const multiSessionFixture = {
  sessionId: 777, chatId: 1763,
  message: {
    // Atendimento antigo (dias atrás)
    "1": { id: "1", senderid: "900", date: "2026-09-15T10:00:00-03:00", text: "Olá antigo" },
    "2": { id: "2", senderid: "99", date: "2026-09-15T10:01:00-03:00", text: "Atendimento antigo pelo operador 99" },
    "3": { id: "3", senderid: "0", date: "2026-09-15T10:05:00-03:00", text: "Conversa fechada." },
    // Atendimento recente (hoje)
    "10": { id: "10", senderid: "0", date: "2026-09-25T14:26:00-03:00", text: "[USER=22227 REPLACE]Davi Vieira[/USER] entrou no bate-papo" },
    "11": { id: "11", senderid: "900", date: "2026-09-25T14:27:00-03:00", text: "Boa tarde, preciso de ajuda com a escritura" },
    "12": { id: "12", senderid: "22227", date: "2026-09-25T14:28:00-03:00", text: "Boa tarde, vou verificar para você agora mesmo" },
    "13": { id: "13", senderid: "900", date: "2026-09-25T14:30:00-03:00", text: "Obrigado!" },
    "14": { id: "14", senderid: "22227", date: "2026-09-25T14:31:00-03:00", text: "Finalizando o atendimento, até logo!" },
    "15": { id: "15", senderid: "0", date: "2026-09-25T14:32:00-03:00", text: "[USER=22227 REPLACE]Davi Vieira[/USER] encerrou a conversa" }
  },
  users: {
    "900": { id: "900", name: "Gabriel Romano", connector: true },
    "99": { id: "99", name: "Operador Antigo", connector: false },
    "22227": { id: "22227", name: "Davi Vieira", connector: false }
  },
  chat: { "1763": { id: "1763", owner: "22227", managerList: [], entityId: "livechat|19|abc|900" } }
};

const isolatedRecent = normalizeBitrixHistory(multiSessionFixture, { sessionId: 777, chatId: 1763 });
assert.equal(isolatedRecent.candidateEmployees.length, 1);
assert.equal(isolatedRecent.candidateEmployees[0].id, "22227");
assert.equal(isolatedRecent.candidateEmployees[0].name, "Davi Vieira");
assert.equal(isolatedRecent.lines.length, 4); // 2 cliente, 2 operador
assert.ok(!isolatedRecent.lines.some((l) => l.authorId === "99" || l.text.includes("antigo")));
assert.equal(isolatedRecent.isolatedRecent, true);
assert.equal(isolatedRecent.totalMessages, 9);
assert.ok(isolatedRecent.selectedMessages < 9);

// Modo retrocompatível (desativando o isolamento)
const notIsolated = normalizeBitrixHistory(multiSessionFixture, { sessionId: 777, chatId: 1763, isolateRecentSession: false });
assert.equal(notIsolated.candidateEmployees.length, 2);
assert.ok(notIsolated.candidateEmployees.some((c) => c.id === "99"));
assert.ok(notIsolated.candidateEmployees.some((c) => c.id === "22227"));

console.log("ok bitrix-transcript");
