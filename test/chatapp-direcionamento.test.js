"use strict";

const assert = require("assert/strict");
const direcionamento = require("../lib/chatapp-direcionamento.js");

process.env.CHATAPP_INTERNAL_TOKEN = "test-token";
delete process.env.ALLOWED_STATUSES_ANALISE_CREDITO;
delete process.env.ALLOWED_STATUSES_POS_ARREMATACAO;
delete process.env.ALLOWED_STATUSES_CHATAPP_DIRECIONAMENTO;

const PHONE = "5591999999999";

function baseDeal(overrides) {
  return Object.assign({
    id: 1001,
    title: "Cliente Teste",
    status: "open",
    pipeline: { id: "16" },
    stage: { id: "137" },
    etapa: "Iniciar Triagem",
    forma_pagamento_id: "34",
    valor_fgts: 0,
    status_financiamento: "",
    status_fgts_financiado: "",
    owner_id: "1",
    owner_name: "",
    atribuido_financiamento_id: "",
    atribuido_financiamento: "",
    atribuido_documentacao_pendente_id: "",
    atribuido_documentacao_pendente: "",
    atribuido_analise_credito_id: "",
    atribuido_analise_credito: "",
    fields: { "Telefone do Arrematante": PHONE }
  }, overrides || {});
}

async function payloadFor(deals) {
  const res = await direcionamento.handleVerificarTriagem(
    { query: { id_chat: PHONE, token: "test-token" }, headers: {} },
    async () => deals
  );
  assert.equal(res.status, 200);
  return res.payload;
}

async function main() {
  let payload = await payloadFor([]);
  assert.equal(payload.triagem.necessaria, "sim");
  assert.equal(payload.chatapp.routing_key, "SEM_ROTA");
  assert.equal(payload.chatapp.delegacao_modo, "none");

  for (const [stageId, etapa] of [
    ["137", "Iniciar Triagem"],
    ["145", "Triagem em Andamento"],
    ["144", "Triagem Incompleta"]
  ]) {
    payload = await payloadFor([baseDeal({ stage: { id: stageId }, etapa: etapa })]);
    assert.equal(payload.chatapp.routing_key, "TRIAGEM_RODIZIO");
    assert.equal(payload.chatapp.delegacao_modo, "assignment");
  }

  payload = await payloadFor([baseDeal({
    stage: { id: "139" },
    etapa: "Documentação Pendente",
    atribuido_documentacao_pendente_id: "2780",
    atribuido_documentacao_pendente: "Isaque Coelho"
  })]);
  assert.equal(payload.chatapp.routing_key, "DOCUMENTACAO_PENDENTE_ISAQUE");
  assert.equal(payload.chatapp.responsavel_destino_id, "81040");

  payload = await payloadFor([baseDeal({
    stage: { id: "139" },
    etapa: "Documentação Pendente",
    atribuido_documentacao_pendente_id: "2823",
    atribuido_documentacao_pendente: "Isadora Campos"
  })]);
  assert.equal(payload.chatapp.routing_key, "DOCUMENTACAO_PENDENTE_ISADORA");
  assert.equal(payload.chatapp.responsavel_destino_id, "90720");

  payload = await payloadFor([baseDeal({
    stage: { id: "140" },
    etapa: "Iniciar Análise de Crédito",
    owner_name: "Daniela Silva"
  })]);
  assert.equal(payload.chatapp.routing_key, "ANALISE_CREDITO_DANIELA");
  assert.equal(payload.chatapp.responsavel_destino_id, "92346");

  payload = await payloadFor([baseDeal({
    stage: { id: "141" },
    etapa: "Análise em Andamento",
    owner_name: "Thales Gabriel"
  })]);
  assert.equal(payload.chatapp.routing_key, "ANALISE_CREDITO_THALES");
  assert.equal(payload.chatapp.responsavel_destino_id, "78057");

  payload = await payloadFor([baseDeal({
    forma_pagamento_id: "33",
    stage: { id: "141" },
    etapa: "Análise em Andamento",
    owner_name: "Thales Gabriel"
  })]);
  assert.equal(payload.triagem.necessaria, "nao");
  assert.equal(payload.chatapp.routing_key, "ANALISE_CREDITO_THALES");
  assert.equal(payload.chatapp.responsavel_destino_id, "78057");

  payload = await payloadFor([baseDeal({
    stage: { id: "140" },
    etapa: "Iniciar Análise de Crédito",
    owner_name: "Daniela Silva",
    atribuido_financiamento_id: "2804",
    atribuido_financiamento: "Marloon Santos"
  })]);
  assert.equal(payload.chatapp.routing_key, "ANALISE_CREDITO_DANIELA");
  assert.equal(payload.chatapp.responsavel_destino_id, "92346");

  payload = await payloadFor([baseDeal({
    stage: { id: "139" },
    etapa: "Documentação Pendente",
    atribuido_documentacao_pendente_id: "2780",
    atribuido_documentacao_pendente: "Isaque Coelho",
    atribuido_financiamento_id: "2793",
    atribuido_financiamento: "Dimitri Garcia"
  })]);
  assert.equal(payload.chatapp.routing_key, "DOCUMENTACAO_PENDENTE_ISAQUE");
  assert.equal(payload.chatapp.responsavel_destino_id, "81040");

  payload = await payloadFor([baseDeal({
    pipeline: { id: "6" },
    stage: { id: "56" },
    etapa: "1. Contrato | ITBI",
    forma_pagamento_id: "34",
    atribuido_financiamento_id: "2804",
    atribuido_financiamento: "Marloon Santos"
  })]);
  assert.equal(payload.triagem.necessaria, "nao");
  assert.equal(payload.cliente.processo, "Pós arrematação");
  assert.equal(payload.chatapp.routing_key, "FINANCIAMENTO_MARLOON");
  assert.equal(payload.chatapp.responsavel_destino_id, "98226");

  payload = await payloadFor([baseDeal({
    pipeline: { id: "6" },
    stage: { id: "56" },
    etapa: "1. Contrato | ITBI",
    forma_pagamento_id: "33",
    atribuido_financiamento_id: "2804",
    atribuido_financiamento: "Marloon Santos"
  })]);
  assert.equal(payload.triagem.necessaria, "sim");
  assert.equal(payload.chatapp.routing_key, "SEM_ROTA");

  payload = await payloadFor([baseDeal({
    pipeline: { id: "5" },
    stage: { id: "139" },
    etapa: "Documentação Pendente",
    forma_pagamento_id: "34",
    atribuido_documentacao_pendente_id: "2780",
    atribuido_documentacao_pendente: "Isaque Coelho"
  })]);
  assert.equal(payload.triagem.necessaria, "sim");
  assert.equal(payload.chatapp.routing_key, "SEM_ROTA");

  const erro = await direcionamento.handleVerificarTriagem(
    { query: { id_chat: PHONE, token: "test-token" }, headers: {} },
    async () => {
      throw new Error("pipedrive indisponivel");
    }
  );
  assert.equal(erro.status, 200);
  assert.equal(erro.payload.triagem.necessaria, "sim");
  assert.equal(erro.payload.chatapp.routing_key, "SEM_ROTA");

  console.log("chatapp-direcionamento: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
