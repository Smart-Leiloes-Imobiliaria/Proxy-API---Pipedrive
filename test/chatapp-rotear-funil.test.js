"use strict";

const assert = require("assert/strict");
const rotearFunil = require("../lib/chatapp-rotear-funil.js");

process.env.CHATAPP_INTERNAL_TOKEN = "test-token";

const PHONE = "5591999999999";

function baseDeal(overrides) {
  return Object.assign({
    id: 1001,
    title: "Cliente Teste",
    status: "open",
    pipeline: { id: "16" },
    forma_pagamento_id: "34",
    atribuido_analise_credito_id: "",
    atribuido_financiamento_id: "",
    atribuido_triagem_documentos_ids: [],
    fields: { "Telefone do Arrematante": PHONE }
  }, overrides || {});
}

async function request(deals, tipo, query) {
  return rotearFunil.handleRotearFunil(
    {
      query: Object.assign({ id_chat: PHONE, tipo: tipo, token: "test-token" }, query || {}),
      headers: {}
    },
    async () => deals
  );
}

function assertFlatPayload(payload) {
  for (const key of Object.keys(payload)) {
    assert.ok(!Array.isArray(payload[key]), "campo '" + key + "' nao deveria ser array: resposta nunca retorna arrays de negocios");
    assert.ok(typeof payload[key] !== "object" || payload[key] === null, "campo '" + key + "' deveria ser escalar (payload plano)");
  }
}

async function main() {
  // --- Auth / validacao basica -------------------------------------------

  let res = await rotearFunil.handleRotearFunil(
    { query: { id_chat: PHONE, tipo: "analise_credito" }, headers: {} },
    async () => []
  );
  assert.equal(res.status, 401);
  assert.equal(res.payload.error, "unauthorized");

  res = await request([], "analise_credito", { id_chat: "" });
  assert.equal(res.status, 400);
  assert.equal(res.payload.error, "missing_id_chat");

  res = await request([], "tipo_invalido");
  assert.equal(res.status, 400);
  assert.equal(res.payload.error, "invalid_tipo");

  // Erro tecnico (timeout/upstream) NAO deve ser convertido em payload 200:
  // deve propagar para o dispatcher do proxy tratar como 5xx.
  await assert.rejects(
    rotearFunil.handleRotearFunil(
      { query: { id_chat: PHONE, tipo: "analise_credito", token: "test-token" }, headers: {} },
      async () => {
        const err = new Error("upstream indisponivel");
        err.statusCode = 502;
        throw err;
      }
    ),
    /upstream indisponivel/
  );

  // --- 1. Analise: pipeline 16, um open e um won -> escolhe so o open ----

  res = await request([
    baseDeal({ id: 2001, status: "won", atribuido_analise_credito_id: "2805" }),
    baseDeal({ id: 2002, status: "open", atribuido_analise_credito_id: "2805" })
  ], "analise_credito");
  assert.equal(res.status, 200);
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.routing_key, "ANALISE_CREDITO_DANIELA");
  assert.equal(res.payload.deal_id, 2002);
  assert.equal(res.payload.matches_count, 1);
  assert.equal(res.payload.selection_reason, "single_open_deal");
  assertFlatPayload(res.payload);

  // --- 2. Analise: dois open -> SEM_ROTA_MULTIPLOS_ANALISE_OPEN -----------

  res = await request([
    baseDeal({ id: 3001, atribuido_analise_credito_id: "2659" }),
    baseDeal({ id: 3002, atribuido_analise_credito_id: "2805" })
  ], "analise_credito");
  assert.equal(res.payload.success, false);
  assert.equal(res.payload.routing_key, "SEM_ROTA_MULTIPLOS_ANALISE_OPEN");
  assert.equal(res.payload.matches_count, 2);
  assert.equal(res.payload.deal_id, null);

  // --- 3. Analise: option 2659 -> Thales ----------------------------------

  res = await request([baseDeal({ atribuido_analise_credito_id: "2659" })], "analise_credito");
  assert.equal(res.payload.routing_key, "ANALISE_CREDITO_THALES");
  assert.equal(res.payload.responsible_option_id, 2659);
  assert.equal(res.payload.success, true);

  // --- 4. Analise: option 2805 -> Daniela ---------------------------------

  res = await request([baseDeal({ atribuido_analise_credito_id: "2805" })], "analise_credito");
  assert.equal(res.payload.routing_key, "ANALISE_CREDITO_DANIELA");
  assert.equal(res.payload.responsible_option_id, 2805);
  assert.equal(res.payload.responsible_name, "Daniela Silva");

  // --- 5. Analise: option desconhecida / Yara sem ID -> fallback ----------

  res = await request([baseDeal({ atribuido_analise_credito_id: "9999" })], "analise_credito");
  assert.equal(res.payload.success, false);
  assert.equal(res.payload.routing_key, "SEM_ROTA_RESPONSAVEL_ANALISE_INVALIDO");
  assert.equal(res.payload.responsible_option_id, null);
  assert.equal(res.payload.responsible_name, null);
  // Yara nao deve ser inferida por nome/owner: nenhum option id mapeia para ela.
  assert.notEqual(res.payload.routing_key, "ANALISE_CREDITO_YARA");

  res = await request([baseDeal({ atribuido_analise_credito_id: "" })], "analise_credito");
  assert.equal(res.payload.routing_key, "SEM_ROTA_RESPONSAVEL_ANALISE_INVALIDO");

  // --- 6. Pos: pipeline 6 com status won -> excluir -----------------------

  res = await request([
    baseDeal({ id: 4001, pipeline: { id: "6" }, status: "won", forma_pagamento_id: "34" })
  ], "financiamento");
  assert.equal(res.payload.success, false);
  assert.equal(res.payload.routing_key, "SEM_ROTA_CARD_NAO_ENCONTRADO");
  assert.equal(res.payload.matches_count, 0);

  // --- 7. Pos: pagamento 33 -> excluir -------------------------------------

  res = await request([
    baseDeal({ id: 4002, pipeline: { id: "6" }, status: "open", forma_pagamento_id: "33" })
  ], "financiamento");
  assert.equal(res.payload.routing_key, "SEM_ROTA_CARD_NAO_ENCONTRADO");
  assert.equal(res.payload.matches_count, 0);

  // --- 8. Pos: pagamento 34 -> incluir -------------------------------------

  res = await request([
    baseDeal({ id: 4003, pipeline: { id: "6" }, status: "open", forma_pagamento_id: "34", atribuido_financiamento_id: "2804" })
  ], "financiamento");
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.deal_id, 4003);
  assert.equal(res.payload.matches_count, 1);

  // --- 9. Pos: tres deals open financiados -> menor ID, matches_count=3 --

  res = await request([
    baseDeal({ id: 5003, pipeline: { id: "6" }, forma_pagamento_id: "34", atribuido_financiamento_id: "2804" }),
    baseDeal({ id: 5001, pipeline: { id: "6" }, forma_pagamento_id: "34", atribuido_financiamento_id: "2804" }),
    baseDeal({ id: 5002, pipeline: { id: "6" }, forma_pagamento_id: "34", atribuido_financiamento_id: "2804" })
  ], "financiamento");
  assert.equal(res.payload.deal_id, 5001);
  assert.equal(res.payload.matches_count, 3);
  assert.equal(res.payload.selection_reason, "lowest_deal_id_among_financed_open_deals");
  assert.equal(res.payload.success, true);

  // --- 10. Pos: option 2804 -> Marloon -------------------------------------

  res = await request([
    baseDeal({ pipeline: { id: "6" }, forma_pagamento_id: "34", atribuido_financiamento_id: "2804" })
  ], "financiamento");
  assert.equal(res.payload.routing_key, "FINANCIAMENTO_MARLOON");
  assert.equal(res.payload.responsible_option_id, 2804);
  assert.equal(res.payload.responsible_name, "Marloon Santos");

  // --- 11. Pos: option 2833 -> Joao Marinho --------------------------------

  res = await request([
    baseDeal({ pipeline: { id: "6" }, forma_pagamento_id: "34", atribuido_financiamento_id: "2833" })
  ], "financiamento");
  assert.equal(res.payload.routing_key, "FINANCIAMENTO_JOAO_MARINHO");
  assert.equal(res.payload.responsible_option_id, 2833);
  assert.equal(res.payload.success, true);

  // --- 12. Pos: option 2810 -> fallback (n/a) ------------------------------

  res = await request([
    baseDeal({ pipeline: { id: "6" }, forma_pagamento_id: "34", atribuido_financiamento_id: "2810" })
  ], "financiamento");
  assert.equal(res.payload.routing_key, "SEM_ROTA_RESPONSAVEL_NA");
  assert.equal(res.payload.success, false);

  res = await request([
    baseDeal({ pipeline: { id: "6" }, forma_pagamento_id: "34", atribuido_financiamento_id: "8888" })
  ], "financiamento");
  assert.equal(res.payload.routing_key, "SEM_ROTA_RESPONSAVEL_FINANCIAMENTO_INVALIDO");
  assert.equal(res.payload.success, false);

  // --- 13. Triagem: option 2760 -> descontinuada ---------------------------

  res = await request([
    baseDeal({ atribuido_triagem_documentos_ids: ["2760"] })
  ], "triagem_documentos");
  assert.equal(res.payload.routing_key, "SEM_ROTA_OPCAO_DESCONTINUADA_DANIELA_ISADORA");
  assert.equal(res.payload.success, false);

  // --- 14. Triagem: option 2876 -> Yasmin ----------------------------------

  res = await request([
    baseDeal({ atribuido_triagem_documentos_ids: ["2876"] })
  ], "triagem_documentos");
  assert.equal(res.payload.routing_key, "TRIAGEM_DOCUMENTOS_YASMIN");
  assert.equal(res.payload.responsible_option_id, 2876);
  assert.equal(res.payload.success, true);

  res = await request([
    baseDeal({ atribuido_triagem_documentos_ids: ["2877"] })
  ], "triagem_documentos");
  assert.equal(res.payload.routing_key, "TRIAGEM_DOCUMENTOS_ISAQUE");
  assert.equal(res.payload.responsible_option_id, 2877);

  // --- 15. Triagem: opcao composta 2672/2806 -> preserva key composta -----

  res = await request([
    baseDeal({ atribuido_triagem_documentos_ids: ["2672"] })
  ], "triagem_documentos");
  assert.equal(res.payload.routing_key, "TRIAGEM_DOCUMENTOS_DANIELA_YASMIN");
  assert.equal(res.payload.responsible_name, "Daniela Silva | Yasmin Rodrigues");
  // Composta continua "success" do ponto de vista do proxy: o bot e quem
  // decide fazer fallback por nao ter um unico responsavel.
  assert.equal(res.payload.success, true);

  res = await request([
    baseDeal({ atribuido_triagem_documentos_ids: ["2806"] })
  ], "triagem_documentos");
  assert.equal(res.payload.routing_key, "TRIAGEM_DOCUMENTOS_YASMIN_GUILHERME");
  assert.equal(res.payload.success, true);

  // Multiplos valores selecionados no MESMO campo multi-selecao.
  res = await request([
    baseDeal({ atribuido_triagem_documentos_ids: ["2876", "2877"] })
  ], "triagem_documentos");
  assert.equal(res.payload.routing_key, "SEM_ROTA_TRIAGEM_MULTIPLOS_VALORES");
  assert.equal(res.payload.success, false);

  // --- 16. Triagem: candidatos nos pipelines 16 e 6 -> ambiguidade --------

  res = await request([
    baseDeal({ id: 6001, pipeline: { id: "16" }, atribuido_triagem_documentos_ids: ["2876"] }),
    baseDeal({ id: 6002, pipeline: { id: "6" }, forma_pagamento_id: "34", atribuido_triagem_documentos_ids: ["2876"] })
  ], "triagem_documentos");
  assert.equal(res.payload.routing_key, "SEM_ROTA_TRIAGEM_PIPELINE_AMBIGUO");
  assert.equal(res.payload.success, false);
  assert.equal(res.payload.matches_count, 2);
  assert.equal(res.payload.deal_id, null);

  // Somente pipeline 6 elegivel (candidato no 16 esta 'won') -> usa a regra
  // do pipeline 6 (nunca ambiguo, seleciona o menor id).
  res = await request([
    baseDeal({ id: 7001, pipeline: { id: "16" }, status: "won", atribuido_triagem_documentos_ids: ["2876"] }),
    baseDeal({ id: 7002, pipeline: { id: "6" }, forma_pagamento_id: "34", atribuido_triagem_documentos_ids: ["2877"] })
  ], "triagem_documentos");
  assert.equal(res.payload.routing_key, "TRIAGEM_DOCUMENTOS_ISAQUE");
  assert.equal(res.payload.deal_id, 7002);
  assert.equal(res.payload.success, true);

  // --- 17. Telefone com +55, espacos, hifen e parenteses ------------------

  res = await request(
    [baseDeal({ atribuido_analise_credito_id: "2805", fields: { "Telefone do Arrematante": "55 (91) 99999-9999" } })],
    "analise_credito",
    { id_chat: "+55 (91) 9 9999-9999" }
  );
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.routing_key, "ANALISE_CREDITO_DANIELA");

  // Igualdade deve ser EXATA (nunca contains/endsWith): um numero que apenas
  // TERMINA com o mesmo sufixo nao pode "vazar" para outro cliente.
  res = await request(
    [baseDeal({ atribuido_analise_credito_id: "2805", fields: { "Telefone do Arrematante": "1" + PHONE } })],
    "analise_credito",
    { id_chat: PHONE }
  );
  assert.equal(res.payload.success, false);
  assert.equal(res.payload.routing_key, "SEM_ROTA_CARD_NAO_ENCONTRADO");

  // --- 18. Nenhum deal -> payload plano ------------------------------------

  res = await request([], "financiamento");
  assert.equal(res.status, 200);
  assert.deepEqual(res.payload, {
    success: false,
    routing_key: "SEM_ROTA_CARD_NAO_ENCONTRADO",
    responsible_option_id: null,
    responsible_name: null,
    deal_id: null,
    deal_title: null,
    matches_count: 0,
    selection_reason: "no_eligible_deal",
    note: "/Não foi possível identificar um negócio elegível no Pipedrive. O chat será direcionado para Atendimento."
  });

  // --- 19. Resposta nunca contem array de deals ----------------------------

  res = await request([
    baseDeal({ id: 8001, atribuido_analise_credito_id: "2659" }),
    baseDeal({ id: 8002, atribuido_analise_credito_id: "2805" })
  ], "analise_credito");
  assertFlatPayload(res.payload);
  assert.ok(!JSON.stringify(res.payload).includes("["));

  // --- 20. Nenhum segredo ou telefone completo aparece em logs/resposta ---

  const originalLog = console.log;
  const linhasLog = [];
  console.log = (...args) => linhasLog.push(args.join(" "));
  try {
    res = await request([baseDeal({ atribuido_analise_credito_id: "2805" })], "analise_credito");
  } finally {
    console.log = originalLog;
  }
  const textoLog = linhasLog.join("\n");
  assert.ok(!textoLog.includes(PHONE), "log nao deve conter o telefone completo");
  assert.ok(!textoLog.includes("test-token"), "log nao deve conter o token");
  assert.ok(!JSON.stringify(res.payload).includes(PHONE), "resposta nao deve conter o telefone completo");
  assert.ok(!JSON.stringify(res.payload).includes("test-token"), "resposta nao deve conter o token");

  console.log("chatapp-rotear-funil: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
