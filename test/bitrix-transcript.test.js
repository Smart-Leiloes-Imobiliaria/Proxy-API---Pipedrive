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
const normalizedAutomation = normalizeBitrixHistory(automation, { sessionId: 321 });
assert.ok(!normalizedAutomation.lines.some((line) => /aceitou a conversa|forms\.gle/.test(line.text)));
console.log("ok bitrix-transcript");
