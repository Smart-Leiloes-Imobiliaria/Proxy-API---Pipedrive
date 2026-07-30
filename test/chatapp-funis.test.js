"use strict";

const assert = require("assert/strict");
const funis = require("../lib/chatapp-funis.js");

process.env.CHATAPP_INTERNAL_TOKEN = "test-token";
delete process.env.ALLOWED_STATUSES_ANALISE_CREDITO;
delete process.env.ALLOWED_STATUSES_POS_ARREMATACAO;
delete process.env.ALLOWED_STATUSES_CHATAPP_FUNIS;

const PHONE = "5591999999999";
const PHONE_WITHOUT_NINTH_DIGIT = "559199999999";
const FALLBACK_NOTE =
  "/Não foi identificado no Pipedrive um card para este cliente. " +
  "Atendimento direcionado ao funil de Atendimento.";

function baseDeal(overrides) {
  return Object.assign({
    id: 1001,
    title: "Imóvel Cliente Teste",
    numero_imovel: "12345678",
    status: "open",
    updated_at: "2026-07-08T12:00:00Z",
    pipeline: { id: "16" },
    etapa: "Análise em Andamento",
    forma_pagamento_id: "34",
    atribuido_triagem_documentos_ids: ["2760"],
    atribuido_triagem_documentos: "Daniela Silva | Isadora Campos",
    atribuido_analise_credito_id: "2659",
    atribuido_analise_credito: "Thales Gabriel",
    atribuido_financiamento_id: "2804",
    atribuido_financiamento: "Marloon Santos",
    fields: { "Telefone do Arrematante": PHONE }
  }, overrides || {});
}

async function request(deals, query) {
  return funis.handleVerificarTriagemFunis(
    {
      query: Object.assign({ id_chat: PHONE }, query || {}),
      headers: { authorization: "Bearer test-token" }
    },
    async () => deals
  );
}

function assertFallbackRoute(atribuicao) {
  assert.equal(atribuicao.responsavel_identificado, "nao");
  assert.equal(atribuicao.rotas.length, 1);
  assert.equal(atribuicao.rotas[0].routing_key, "ATENDIMENTO_FALLBACK");
  assert.equal(atribuicao.rotas[0].responsavel_destino_nome, "Funil de Atendimento");
  assert.equal(atribuicao.rotas[0].nota_funcionario, FALLBACK_NOTE);
}

async function main() {
  let response = await funis.handleVerificarTriagemFunis(
    { query: { id_chat: PHONE }, headers: { authorization: "Bearer invalido" } },
    async () => []
  );
  assert.equal(response.status, 401);
  assert.equal(response.payload.error, "unauthorized");

  response = await request([], { id_chat: "" });
  assert.equal(response.status, 400);
  assert.equal(response.payload.error, "missing_id_chat");

  response = await request([]);
  assert.equal(response.status, 200);
  assert.equal(response.payload.triagem.necessaria, "sim");
  assert.equal(response.payload.cliente.telefone_consultado, PHONE);
  assert.equal(response.payload.cliente.quantidade_imoveis, 0);
  assert.deepEqual(response.payload.imoveis, []);
  assert.equal(response.payload.chatapp.fallback_necessario, "sim");
  assert.equal(response.payload.chatapp.routing_key_fallback, "ATENDIMENTO_FALLBACK");
  assert.equal(response.payload.chatapp.nota_funcionario, FALLBACK_NOTE);
  assert.equal(response.payload.resultado.motivo, "card_nao_encontrado");

  const dealMaisNovo = baseDeal({
    id: 2002,
    title: "Imóvel Mais Novo",
    numero_imovel: "87654321",
    updated_at: "2026-07-10T12:00:00Z",
    atribuido_triagem_documentos_ids: ["2672", "2806"],
    atribuido_triagem_documentos: "Daniela Silva | Yasmin Rodrigues, Yasmin Rodrigues | Guilherme Oliveira",
    atribuido_analise_credito_id: "2805",
    atribuido_analise_credito: "Daniela Silva",
    atribuido_financiamento_id: "2793",
    atribuido_financiamento: "Dimitri Garcia"
  });
  const dealMaisAntigo = baseDeal({
    id: 2001,
    title: "Imóvel Mais Antigo",
    updated_at: "2026-07-09T12:00:00Z"
  });

  // O único parâmetro funcional é id_chat; todos os imóveis são retornados.
  response = await request([dealMaisAntigo, dealMaisNovo], {
    id_chat: PHONE_WITHOUT_NINTH_DIGIT
  });
  assert.equal(response.status, 200);
  assert.equal(response.payload.triagem.necessaria, "nao");
  assert.equal(response.payload.cliente.telefone_consultado, PHONE_WITHOUT_NINTH_DIGIT);
  assert.equal(response.payload.cliente.quantidade_imoveis, 2);
  assert.equal(response.payload.imoveis.length, 2);
  assert.equal(response.payload.imoveis[0].item_id, "2002");
  assert.equal(response.payload.imoveis[1].item_id, "2001");
  assert.equal(response.payload.chatapp.fallback_necessario, "nao");
  assert.equal(response.payload.chatapp.routing_key_fallback, "");

  const imovel = response.payload.imoveis[0];
  assert.equal(imovel.numero_imovel, "87654321");
  assert.equal(imovel.atribuicoes.triagem_documentos.valor, dealMaisNovo.atribuido_triagem_documentos);
  assert.deepEqual(imovel.atribuicoes.triagem_documentos.option_ids, ["2672", "2806"]);
  assert.deepEqual(
    imovel.atribuicoes.triagem_documentos.rotas.map((rota) => rota.routing_key),
    [
      "TRIAGEM_DOCUMENTOS_DANIELA_YASMIN",
      "TRIAGEM_DOCUMENTOS_YASMIN_GUILHERME"
    ]
  );
  assert.equal(
    imovel.atribuicoes.analise_credito.rotas[0].routing_key,
    "ANALISE_CREDITO_DANIELA"
  );
  assert.equal(
    imovel.atribuicoes.analise_credito.rotas[0].responsavel_destino_id,
    "92346"
  );
  assert.equal(
    imovel.atribuicoes.financiamento.rotas[0].routing_key,
    "FINANCIAMENTO_DIMITRI"
  );
  assert.equal(
    imovel.atribuicoes.financiamento.rotas[0].responsavel_destino_id,
    "78043"
  );

  // Todo imóvel sempre traz os três campos. Campo vazio recebe fallback próprio.
  response = await request([baseDeal({
    atribuido_triagem_documentos_ids: [],
    atribuido_triagem_documentos: "",
    atribuido_analise_credito_id: "",
    atribuido_analise_credito: "",
    atribuido_financiamento_id: "2810",
    atribuido_financiamento: "n/a"
  })]);
  const atribuicoes = response.payload.imoveis[0].atribuicoes;
  assertFallbackRoute(atribuicoes.triagem_documentos);
  assertFallbackRoute(atribuicoes.analise_credito);
  assertFallbackRoute(atribuicoes.financiamento);
  assert.deepEqual(atribuicoes.financiamento.option_ids_nao_mapeados, ["2810"]);

  // A regra de Triagem continua independente da existência de imóveis.
  response = await request([baseDeal({
    pipeline: { id: "5" }
  })]);
  assert.equal(response.payload.cliente.quantidade_imoveis, 1);
  assert.equal(response.payload.triagem.necessaria, "sim");

  // Objetos/arrays brutos do Pipedrive também são aceitos.
  response = await request([baseDeal({
    atribuido_triagem_documentos_ids: [],
    atribuido_triagem_documentos: "",
    atribuido_triagem_documentos_raw: [
      { id: 2760, label: "Daniela Silva | Isadora Campos" }
    ]
  })]);
  assert.deepEqual(
    response.payload.imoveis[0].atribuicoes.triagem_documentos.option_ids,
    ["2760"]
  );
  assert.equal(
    response.payload.imoveis[0].atribuicoes.triagem_documentos.valor,
    "Daniela Silva | Isadora Campos"
  );

  response = await funis.handleVerificarTriagemFunis(
    {
      query: { id_chat: PHONE },
      headers: { authorization: "Bearer test-token" }
    },
    async () => {
      throw new Error("pipedrive indisponivel");
    }
  );
  assert.equal(response.status, 200);
  assert.equal(response.payload.triagem.necessaria, "sim");
  assert.equal(response.payload.cliente.quantidade_imoveis, 0);
  assert.equal(response.payload.chatapp.routing_key_fallback, "ATENDIMENTO_FALLBACK");
  assert.equal(response.payload.resultado.motivo, "erro_consulta_pipedrive");

  console.log("chatapp-funis: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
