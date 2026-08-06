"use strict";

// Logica isolada da rota NOVA /api/chatapp/rotear-funil.
//
// Diferente de lib/chatapp-triagem.js, lib/chatapp-direcionamento.js e
// lib/chatapp-funis.js (que decidem SE a Triagem inicial deve rodar), esta
// rota resolve o ROTEAMENTO PERSISTENTE por funil de processo. O ChatApp so
// chama esta rota quando um assessor move manualmente o dialogo para um funil
// de processo (Triagem de Documentos, Analise de Credito ou Financiamento) ou
// quando um chat ja nesse funil e reaberto/revalidado. A triagem inicial do
// chatbot NUNCA chama esta rota (ela sempre move para Atendimento + rodizio).
//
// Contrato de resposta: payload SEMPRE plano (nunca array de negocios).
// `routing_key` e convertido pelo bot em responsibleId do ChatApp -- este
// proxy so identifica o negocio elegivel e o option_id/label bruto do campo
// de atribuicao do Pipedrive. Detalhes adicionais (option ids brutos,
// telefone mascarado) ficam apenas no log estruturado, nunca na resposta.
//
// Erros TECNICOS (auth com o Pipedrive, timeout, erro de upstream) NAO sao
// capturados aqui: propagam para o dispatcher do proxy
// (lib/pipedrive-live-proxy.js -> handleProxyRequest), que ja converte
// falhas de upstream em 5xx/502/504 pelo MESMO mecanismo usado por todas as
// outras rotas (ProxyHttpError). Apenas resultados de NEGOCIO (0 negocios
// elegiveis, ambiguidade, campo de responsavel invalido/desconhecido)
// retornam HTTP 200 com o payload plano de fallback.

const triagemBase = require("./chatapp-triagem.js");

const normalizarTelefone = triagemBase.normalizarTelefone;
const gerarVariantesTelefone = triagemBase.gerarVariantesTelefone;

const TELEFONE_ARREMATANTE_FIELD_LABEL = "Telefone do Arrematante";

// IDs confirmados na tarefa / XLS de campos 06/08/2026. Fixos como constantes
// nomeadas: nao resolvidos por nome nem via chamada a /dealFields, porque o
// ID ja foi confirmado ("nao resolva por nome quando o ID ja foi
// confirmado").
const PIPELINE_ANALISE_CREDITO_ID = "16";
const PIPELINE_POS_ARREMATACAO_ID = "6";
const PAYMENT_OPTION_FINANCED = "34";

const TIPOS_SUPORTADOS = new Set(["triagem_documentos", "analise_credito", "financiamento"]);

const ROUTING_KEY_CARD_NAO_ENCONTRADO = "SEM_ROTA_CARD_NAO_ENCONTRADO";
const ROUTING_KEY_MULTIPLOS_ANALISE_OPEN = "SEM_ROTA_MULTIPLOS_ANALISE_OPEN";

// ---------------------------------------------------------------------------
// Tabelas de roteamento: option_id do Pipedrive -> routing_key/nome.
// Fonte: XLS de opcoes de campo 06/08/2026 (ver tarefa). Contem SOMENTE as
// chaves ATIVAS. Chaves legadas (DOCUMENTACAO_PENDENTE_*, FINANCIAMENTO_
// MARLOON antigo etc.) nao sao emitidas por esta rota nova -- o bot ainda as
// aceita por compatibilidade temporaria, mas a preferencia e das chaves
// ativas deste modulo.
// ---------------------------------------------------------------------------

const ROTAS_ANALISE_CREDITO = {
  "2659": { routingKey: "ANALISE_CREDITO_THALES", nome: "Thales Gabriel" },
  "2805": { routingKey: "ANALISE_CREDITO_DANIELA", nome: "Daniela Silva" }
  // Yara (ChatApp employee 99955) fica DE FORA ate o option ID exato deste
  // campo ser confirmado no Pipedrive. Nao inferir por nome/owner. O bot ja
  // aceita ANALISE_CREDITO_YARA para quando essa entrada puder ser somada.
};

const ROTAS_FINANCIAMENTO = {
  "2699": { routingKey: "FINANCIAMENTO_JESSICA_FRANCKLIN", nome: "Jessica Francklin" },
  "2700": { routingKey: "FINANCIAMENTO_ANA_SOUZA", nome: "Ana Souza" },
  "2707": { routingKey: "FINANCIAMENTO_DANIELA", nome: "Daniela Silva" },
  "2709": { routingKey: "FINANCIAMENTO_ISADORA", nome: "Isadora Campos" },
  "2793": { routingKey: "FINANCIAMENTO_DIMITRI", nome: "Dimitri Garcia" },
  "2804": { routingKey: "FINANCIAMENTO_MARLOON", nome: "Marloon Santos" },
  "2810": { routingKey: "SEM_ROTA_RESPONSAVEL_NA", nome: "n/a" },
  "2833": { routingKey: "FINANCIAMENTO_JOAO_MARINHO", nome: "João Marinho" }
};

const OPCAO_TRIAGEM_DOCUMENTOS_DESCONTINUADA = "2760";

const ROTAS_TRIAGEM_DOCUMENTOS = {
  "2672": { routingKey: "TRIAGEM_DOCUMENTOS_DANIELA_YASMIN", nome: "Daniela Silva | Yasmin Rodrigues" },
  "2806": { routingKey: "TRIAGEM_DOCUMENTOS_YASMIN_GUILHERME", nome: "Yasmin Rodrigues | Guilherme Oliveira" },
  "2876": { routingKey: "TRIAGEM_DOCUMENTOS_YASMIN", nome: "Yasmin Rodrigues" },
  "2877": { routingKey: "TRIAGEM_DOCUMENTOS_ISAQUE", nome: "Isaque Coelho" }
};

const NOTAS_POR_ROTA = {
  SEM_ROTA_CARD_NAO_ENCONTRADO:
    "/Não foi possível identificar um negócio elegível no Pipedrive. O chat será direcionado para Atendimento.",
  SEM_ROTA_MULTIPLOS_ANALISE_OPEN:
    "/Mais de um negócio aberto em Análise de Crédito para este telefone. Verificação manual necessária.",
  SEM_ROTA_RESPONSAVEL_ANALISE_INVALIDO:
    "/Campo Atribuído: Análise de Crédito vazio ou com opção não reconhecida. Verificação manual necessária.",
  SEM_ROTA_RESPONSAVEL_FINANCIAMENTO_INVALIDO:
    "/Campo Atribuído: Financiamento vazio ou com opção não reconhecida. Verificação manual necessária.",
  SEM_ROTA_RESPONSAVEL_NA:
    "/Responsável pelo Financiamento marcado como n/a. Verificação manual necessária.",
  SEM_ROTA_TRIAGEM_PIPELINE_AMBIGUO:
    "/Cliente com negócios elegíveis em mais de um funil de processo (Análise de Crédito e Pós arrematação). Verificação manual necessária.",
  SEM_ROTA_TRIAGEM_MULTIPLOS_VALORES:
    "/Campo Atribuído: Triagem de Documentos com mais de um valor selecionado. Verificação manual necessária.",
  SEM_ROTA_OPCAO_DESCONTINUADA_DANIELA_ISADORA:
    "/Opção de atribuição descontinuada (Daniela Silva | Isadora Campos). Verificação manual necessária.",
  SEM_ROTA_RESPONSAVEL_TRIAGEM_INVALIDO:
    "/Campo Atribuído: Triagem de Documentos vazio ou com opção não reconhecida. Verificação manual necessária."
};

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function handleRotearFunil(input, searchDeals) {
  const query = (input && input.query) || {};
  const headers = (input && input.headers) || {};

  if (!tokenValido_(query, headers)) {
    return { status: 401, payload: { error: "unauthorized" } };
  }

  const telefoneChat = normalizarTelefone(query.id_chat);
  if (!telefoneChat) {
    return { status: 400, payload: { error: "missing_id_chat" } };
  }

  const tipo = String(query.tipo || "").trim();
  if (!TIPOS_SUPORTADOS.has(tipo)) {
    return { status: 400, payload: { error: "invalid_tipo" } };
  }

  if (typeof searchDeals !== "function") {
    throw new Error("searchDeals nao foi informado.");
  }

  const variantes = gerarVariantesTelefone(telefoneChat);
  const termos = Array.from(new Set(
    variantes.map((v) => String(v || "").replace(/\D+/g, "")).filter(Boolean)
  ));

  // NAO capturamos erro aqui: falha tecnica (timeout/upstream) deve propagar
  // para o dispatcher do proxy, que converte em 5xx/502/504 (ProxyHttpError).
  const todosDeals = (await searchDeals(termos)) || [];
  const deals = dedupePorId_(todosDeals.filter((deal) => telefoneBateExato_(deal, variantes)));

  const resultado = resolverRoteamento_(tipo, deals);
  logRoteamento_(tipo, telefoneChat, resultado);

  return { status: 200, payload: montarResposta_(resultado) };
}

// ---------------------------------------------------------------------------
// Autenticacao interna (token do ChatApp) -- mesmo mecanismo dos modulos
// irmaos (chatapp-triagem.js / chatapp-direcionamento.js / chatapp-funis.js).
// ---------------------------------------------------------------------------

function tokenValido_(query, headers) {
  const esperado = String(process.env.CHATAPP_INTERNAL_TOKEN || "").trim();
  if (!esperado) return false;

  const recebido =
    String((query && query.token) || "").trim() ||
    parseBearer_(headers && headers.authorization) ||
    String((headers && headers["x-internal-token"]) || "").trim();

  return !!recebido && recebido === esperado;
}

function parseBearer_(value) {
  const match = String(value || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

// ---------------------------------------------------------------------------
// Telefone: igualdade EXATA apos normalizacao (nunca contains/endsWith), para
// nao misturar clientes com numeros parecidos.
// ---------------------------------------------------------------------------

function telefoneBateExato_(deal, variantes) {
  const dealDigits = telefoneDoDeal_(deal);
  if (!dealDigits) return false;
  return (variantes || []).some((v) => String(v || "").replace(/\D+/g, "") === dealDigits);
}

function telefoneDoDeal_(deal) {
  const fields = (deal && deal.fields) || {};
  const valor = fields[TELEFONE_ARREMATANTE_FIELD_LABEL] !== undefined
    ? fields[TELEFONE_ARREMATANTE_FIELD_LABEL]
    : (deal && deal.telefone);
  return normalizarTelefone(typeof valor === "object" ? JSON.stringify(valor) : valor);
}

function dedupePorId_(deals) {
  const vistos = new Set();
  const out = [];
  for (const deal of deals || []) {
    const id = deal && deal.id != null ? String(deal.id) : "";
    if (id) {
      if (vistos.has(id)) continue;
      vistos.add(id);
    }
    out.push(deal);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filtros de elegibilidade por pipeline
// ---------------------------------------------------------------------------

function isOpen_(deal) {
  return String((deal && deal.status) || "").toLowerCase() === "open";
}

function pipelineId_(deal) {
  if (deal && deal.pipeline && deal.pipeline.id != null) return String(deal.pipeline.id);
  if (deal && deal.pipeline_id != null) return String(deal.pipeline_id);
  return "";
}

function isPipelineAnaliseCreditoOpen_(deal) {
  return pipelineId_(deal) === PIPELINE_ANALISE_CREDITO_ID && isOpen_(deal);
}

function isPipelinePosArrematacaoFinanciadoOpen_(deal) {
  return (
    pipelineId_(deal) === PIPELINE_POS_ARREMATACAO_ID &&
    isOpen_(deal) &&
    String((deal && deal.forma_pagamento_id) || "") === PAYMENT_OPTION_FINANCED
  );
}

// ---------------------------------------------------------------------------
// Regras de selecao por pipeline
// ---------------------------------------------------------------------------

// Pipeline 16 (Analise de Credito): 0 -> nenhum; 1 -> seleciona; >1 -> nao
// escolhe (ambiguo).
function regraSelecaoPipeline16_(elegiveis) {
  const n = elegiveis.length;
  if (n === 0) return { status: "none", matchesCount: 0 };
  if (n === 1) {
    return { status: "selected", deal: elegiveis[0], matchesCount: 1, selectionReason: "single_open_deal" };
  }
  return { status: "ambiguous", matchesCount: n, routingKey: ROUTING_KEY_MULTIPLOS_ANALISE_OPEN };
}

// Pipeline 6 (Pos arrematacao, financiado): 0 -> nenhum; 1 -> seleciona; >1 ->
// ordena por id numerico crescente e seleciona o menor (nunca ambiguo).
function regraSelecaoPipeline6_(elegiveis) {
  const n = elegiveis.length;
  if (n === 0) return { status: "none", matchesCount: 0 };
  if (n === 1) {
    return { status: "selected", deal: elegiveis[0], matchesCount: 1, selectionReason: "single_open_deal" };
  }
  const ordenados = elegiveis.slice().sort((a, b) => numericId_(a) - numericId_(b));
  return {
    status: "selected",
    deal: ordenados[0],
    matchesCount: n,
    selectionReason: "lowest_deal_id_among_financed_open_deals"
  };
}

function numericId_(deal) {
  const n = Number(deal && deal.id);
  return Number.isFinite(n) ? n : Infinity;
}

// Converte o resultado de uma regra de selecao + resolucao de responsavel no
// resultado final (deal + rota, ou fallback).
function finalizarSelecaoComResponsavel_(selecao, resolverResponsavel) {
  if (selecao.status === "none") {
    return {
      routingKey: ROUTING_KEY_CARD_NAO_ENCONTRADO,
      responsibleOptionId: null,
      responsibleName: null,
      deal: null,
      matchesCount: 0,
      selectionReason: "no_eligible_deal"
    };
  }

  if (selecao.status === "ambiguous") {
    return {
      routingKey: selecao.routingKey,
      responsibleOptionId: null,
      responsibleName: null,
      deal: null,
      matchesCount: selecao.matchesCount,
      selectionReason: "multiple_open_deals"
    };
  }

  const responsavel = resolverResponsavel(selecao.deal);
  return {
    routingKey: responsavel.routingKey,
    responsibleOptionId: responsavel.responsibleOptionId,
    responsibleName: responsavel.responsibleName,
    rawOptionId: responsavel.rawOptionId,
    deal: selecao.deal,
    matchesCount: selecao.matchesCount,
    selectionReason: selecao.selectionReason
  };
}

// ---------------------------------------------------------------------------
// Resolucao por tipo
// ---------------------------------------------------------------------------

function resolverRoteamento_(tipo, deals) {
  if (tipo === "analise_credito") return resolverAnaliseCredito_(deals);
  if (tipo === "financiamento") return resolverFinanciamento_(deals);
  return resolverTriagemDocumentos_(deals);
}

function resolverAnaliseCredito_(deals) {
  const elegiveis = deals.filter(isPipelineAnaliseCreditoOpen_);
  const selecao = regraSelecaoPipeline16_(elegiveis);
  return finalizarSelecaoComResponsavel_(selecao, resolverResponsavelAnaliseCredito_);
}

function resolverFinanciamento_(deals) {
  const elegiveis = deals.filter(isPipelinePosArrematacaoFinanciadoOpen_);
  const selecao = regraSelecaoPipeline6_(elegiveis);
  return finalizarSelecaoComResponsavel_(selecao, resolverResponsavelFinanciamento_);
}

function resolverTriagemDocumentos_(deals) {
  const elegiveisAnalise = deals.filter(isPipelineAnaliseCreditoOpen_);
  const elegiveisPos = deals.filter(isPipelinePosArrematacaoFinanciadoOpen_);

  const temAnalise = elegiveisAnalise.length > 0;
  const temPos = elegiveisPos.length > 0;

  if (temAnalise && temPos) {
    return {
      routingKey: "SEM_ROTA_TRIAGEM_PIPELINE_AMBIGUO",
      responsibleOptionId: null,
      responsibleName: null,
      deal: null,
      matchesCount: elegiveisAnalise.length + elegiveisPos.length,
      selectionReason: "ambiguous_pipeline"
    };
  }

  if (!temAnalise && !temPos) {
    return {
      routingKey: ROUTING_KEY_CARD_NAO_ENCONTRADO,
      responsibleOptionId: null,
      responsibleName: null,
      deal: null,
      matchesCount: 0,
      selectionReason: "no_eligible_deal"
    };
  }

  const selecao = temAnalise
    ? regraSelecaoPipeline16_(elegiveisAnalise)
    : regraSelecaoPipeline6_(elegiveisPos);

  return finalizarSelecaoComResponsavel_(selecao, resolverResponsavelTriagemDocumentos_);
}

// ---------------------------------------------------------------------------
// Resolucao do campo de responsavel (por tipo)
// ---------------------------------------------------------------------------

function resolverResponsavelAnaliseCredito_(deal) {
  const optionId = String((deal && deal.atribuido_analise_credito_id) || "").trim();
  const rota = optionId && ROTAS_ANALISE_CREDITO[optionId];

  if (!rota) {
    return {
      routingKey: "SEM_ROTA_RESPONSAVEL_ANALISE_INVALIDO",
      responsibleOptionId: null,
      responsibleName: null,
      rawOptionId: optionId
    };
  }

  return {
    routingKey: rota.routingKey,
    responsibleOptionId: toNumberOrNull_(optionId),
    responsibleName: rota.nome,
    rawOptionId: optionId
  };
}

function resolverResponsavelFinanciamento_(deal) {
  const optionId = String((deal && deal.atribuido_financiamento_id) || "").trim();
  const rota = optionId && ROTAS_FINANCIAMENTO[optionId];

  if (!rota) {
    return {
      routingKey: "SEM_ROTA_RESPONSAVEL_FINANCIAMENTO_INVALIDO",
      responsibleOptionId: null,
      responsibleName: null,
      rawOptionId: optionId
    };
  }

  return {
    routingKey: rota.routingKey,
    responsibleOptionId: toNumberOrNull_(optionId),
    responsibleName: rota.nome,
    rawOptionId: optionId
  };
}

function resolverResponsavelTriagemDocumentos_(deal) {
  const ids = uniqueStrings_((deal && deal.atribuido_triagem_documentos_ids) || []);

  if (ids.length > 1) {
    return {
      routingKey: "SEM_ROTA_TRIAGEM_MULTIPLOS_VALORES",
      responsibleOptionId: null,
      responsibleName: null,
      rawOptionId: ids.join(",")
    };
  }

  const optionId = ids.length === 1 ? ids[0] : "";

  if (optionId === OPCAO_TRIAGEM_DOCUMENTOS_DESCONTINUADA) {
    return {
      routingKey: "SEM_ROTA_OPCAO_DESCONTINUADA_DANIELA_ISADORA",
      responsibleOptionId: null,
      responsibleName: null,
      rawOptionId: optionId
    };
  }

  const rota = optionId && ROTAS_TRIAGEM_DOCUMENTOS[optionId];
  if (!rota) {
    return {
      routingKey: "SEM_ROTA_RESPONSAVEL_TRIAGEM_INVALIDO",
      responsibleOptionId: null,
      responsibleName: null,
      rawOptionId: optionId
    };
  }

  return {
    routingKey: rota.routingKey,
    responsibleOptionId: toNumberOrNull_(optionId),
    responsibleName: rota.nome,
    rawOptionId: optionId
  };
}

function uniqueStrings_(values) {
  return Array.from(new Set((values || []).map((v) => String(v || "").trim()).filter(Boolean)));
}

function toNumberOrNull_(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Montagem da resposta (payload plano, contrato fixo)
// ---------------------------------------------------------------------------

function montarResposta_(resultado) {
  const routingKey = String(resultado.routingKey || "");
  const success = routingKey.length > 0 && !routingKey.startsWith("SEM_ROTA");
  const deal = resultado.deal;

  return {
    success: success,
    routing_key: routingKey,
    responsible_option_id: resultado.responsibleOptionId == null ? null : resultado.responsibleOptionId,
    responsible_name: resultado.responsibleName == null ? null : resultado.responsibleName,
    deal_id: deal ? toNumberOrNull_(deal.id) : null,
    deal_title: deal ? String(deal.title || "") : null,
    matches_count: resultado.matchesCount || 0,
    selection_reason: resultado.selectionReason || "",
    note: notaPara_(routingKey, success)
  };
}

function notaPara_(routingKey, success) {
  if (success) return "";
  return (
    NOTAS_POR_ROTA[routingKey] ||
    "/Não foi possível confirmar um roteamento válido no Pipedrive. Verificação manual necessária."
  );
}

// ---------------------------------------------------------------------------
// Log estruturado (telefone SEMPRE mascarado; nunca loga o token nem o
// telefone completo).
// ---------------------------------------------------------------------------

function logRoteamento_(tipo, telefoneChat, resultado) {
  try {
    console.log(JSON.stringify({
      event: "chatapp_rotear_funil",
      tipo: tipo,
      telefone_mascarado: mascararTelefone_(telefoneChat),
      routing_key: resultado.routingKey,
      matches_count: resultado.matchesCount,
      selection_reason: resultado.selectionReason,
      deal_id: resultado.deal && resultado.deal.id != null ? String(resultado.deal.id) : null,
      option_id_bruto: resultado.rawOptionId != null && resultado.rawOptionId !== "" ? String(resultado.rawOptionId) : null
    }));
  } catch (e) {
    // Log nunca pode quebrar a resposta ao ChatApp.
  }
}

function mascararTelefone_(telefone) {
  const digits = String(telefone || "");
  if (digits.length <= 4) return "*".repeat(digits.length);
  return "*".repeat(digits.length - 4) + digits.slice(-4);
}

module.exports = {
  handleRotearFunil,
  // exportados para teste/uso isolado:
  resolverRoteamento_,
  montarResposta_,
  telefoneBateExato_,
  mascararTelefone_,
  PIPELINE_ANALISE_CREDITO_ID,
  PIPELINE_POS_ARREMATACAO_ID,
  PAYMENT_OPTION_FINANCED
};
