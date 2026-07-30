"use strict";

// Logica isolada da rota /api/chatapp/verificar-triagem-funis.
//
// A rota recebe apenas o telefone do chat, localiza todos os deals vinculados e
// devolve, em cada imovel, os tres campos de atribuicao usados pelo ChatApp.

const triagemBase = require("./chatapp-triagem.js");

const normalizarTelefone = triagemBase.normalizarTelefone;
const gerarVariantesTelefone = triagemBase.gerarVariantesTelefone;

const TELEFONE_ARREMATANTE_FIELD_LABEL = "Telefone do Arrematante";
const MOTIVO_CLIENTE_EM_ESTEIRA = "cliente_em_esteira";
const MOTIVO_NAO_ENCONTRADO = "cliente_nao_encontrado_em_esteira";
const NOTA_FALLBACK =
  "/Não foi identificado no Pipedrive um card para este cliente. " +
  "Atendimento direcionado ao funil de Atendimento.";

const CHATAPP_USERS = {
  thales: { id: "78057", nome: "Thales" },
  daniela: { id: "92346", nome: "Daniela" },
  isadora: { id: "90720", nome: "Isadora Campos" },
  dimitri: { id: "78043", nome: "Dimitri" },
  marloon: { id: "98226", nome: "Marloon" }
};

// Fonte: data_fields_options_2026-07-08.xls.
const CAMPOS_ATRIBUICAO = {
  triagem_documentos: {
    baseName: "atribuido_triagem_documentos",
    campo: "Atribuído: Triagem de Documentos",
    rotas: {
      "2672": assignmentRoute_(
        "TRIAGEM_DOCUMENTOS_DANIELA_YASMIN",
        "Daniela Silva | Yasmin Rodrigues"
      ),
      "2760": assignmentRoute_(
        "TRIAGEM_DOCUMENTOS_DANIELA_ISADORA",
        "Daniela Silva | Isadora Campos"
      ),
      "2806": assignmentRoute_(
        "TRIAGEM_DOCUMENTOS_YASMIN_GUILHERME",
        "Yasmin Rodrigues | Guilherme Oliveira"
      )
    }
  },
  analise_credito: {
    baseName: "atribuido_analise_credito",
    campo: "Atribuído: Análise de Crédito",
    rotas: {
      "2659": fixedRoute_("ANALISE_CREDITO_THALES", CHATAPP_USERS.thales),
      "2805": fixedRoute_("ANALISE_CREDITO_DANIELA", CHATAPP_USERS.daniela)
    }
  },
  financiamento: {
    baseName: "atribuido_financiamento",
    campo: "Atribuído: Financiamento",
    rotas: {
      "2699": assignmentRoute_("FINANCIAMENTO_JESSICA", "Jessica Francklin"),
      "2700": assignmentRoute_("FINANCIAMENTO_ANA", "Ana Souza"),
      "2707": fixedRoute_("FINANCIAMENTO_DANIELA", CHATAPP_USERS.daniela),
      "2709": fixedRoute_("FINANCIAMENTO_ISADORA", CHATAPP_USERS.isadora),
      "2793": fixedRoute_("FINANCIAMENTO_DIMITRI", CHATAPP_USERS.dimitri),
      "2804": fixedRoute_("FINANCIAMENTO_MARLOON", CHATAPP_USERS.marloon)
      // Opcao 2810 ("n/a") intencionalmente usa o fallback.
    }
  }
};

async function handleVerificarTriagemFunis(input, searchDeals) {
  const query = (input && input.query) || {};
  const headers = (input && input.headers) || {};

  if (!tokenValido_(query, headers)) {
    return { status: 401, payload: { error: "unauthorized" } };
  }

  const telefone = normalizarTelefone(query.id_chat);
  if (!telefone) {
    return { status: 400, payload: { error: "missing_id_chat" } };
  }

  try {
    const variantes = gerarVariantesTelefone(telefone);
    const resultado = await buscarImoveisPorTelefone(variantes, searchDeals);
    return {
      status: 200,
      payload: montarRespostaChatApp(resultado, telefone, "consulta_concluida")
    };
  } catch (error) {
    return {
      status: 200,
      payload: montarRespostaChatApp({
        imoveis: [],
        triagemMatch: null
      }, telefone, "erro_consulta_pipedrive")
    };
  }
}

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

async function buscarImoveisPorTelefone(variantes, searchDeals) {
  if (typeof searchDeals !== "function") {
    throw new Error("searchDeals nao foi informado.");
  }

  const termos = Array.from(new Set(
    (variantes || []).map((value) => String(value || "").replace(/\D+/g, "")).filter(Boolean)
  ));
  const deals = (await searchDeals(termos)) || [];
  const idsVistos = new Set();
  const imoveis = [];

  for (const deal of deals) {
    const id = deal && deal.id != null ? String(deal.id) : "";
    if (id && idsVistos.has(id)) continue;
    if (!dealTelefoneBate_(deal, variantes)) continue;
    if (id) idsVistos.add(id);
    imoveis.push(deal);
  }

  imoveis.sort(compararCards_);

  const triagemMatches = imoveis
    .map((deal) => ({ deal: deal, processo: classificarProcessoTriagem_(deal) }))
    .filter((item) => item.processo && statusPermitidoTriagem_(item.deal, item.processo))
    .sort(compararTriagem_);

  return {
    imoveis: imoveis,
    triagemMatch: triagemMatches.length ? triagemMatches[0] : null
  };
}

function montarRespostaChatApp(resultado, telefoneConsultado, motivoConsulta) {
  const deals = (resultado && resultado.imoveis) || [];
  const triagemMatch = resultado && resultado.triagemMatch;
  const imoveis = deals.map(montarImovel_);
  const encontrou = imoveis.length > 0;
  const erro = motivoConsulta === "erro_consulta_pipedrive";
  const motivoResultado = erro
    ? "erro_consulta_pipedrive"
    : (encontrou ? "imoveis_encontrados" : "card_nao_encontrado");

  return {
    triagem: {
      necessaria: triagemMatch ? "nao" : "sim",
      motivo: triagemMatch ? MOTIVO_CLIENTE_EM_ESTEIRA : MOTIVO_NAO_ENCONTRADO
    },
    cliente: {
      telefone_consultado: telefoneConsultado,
      quantidade_imoveis: imoveis.length
    },
    imoveis: imoveis,
    chatapp: {
      fallback_necessario: encontrou ? "nao" : "sim",
      routing_key_fallback: encontrou ? "" : "ATENDIMENTO_FALLBACK",
      nota_funcionario: encontrou ? "" : NOTA_FALLBACK,
      preservar_atribuido_ao_encerrar: "sim",
      reconsultar_ao_reabrir: "sim"
    },
    resultado: {
      motivo: motivoResultado
    }
  };
}

function montarImovel_(deal) {
  return {
    item_id: deal && deal.id != null ? String(deal.id) : "",
    titulo: String((deal && deal.title) || ""),
    numero_imovel: String((deal && deal.numero_imovel) || ""),
    telefone: telefoneDoDeal_(deal),
    status: String((deal && deal.status) || ""),
    pipeline_id: pipelineId_(deal),
    etapa: String((deal && deal.etapa) || ""),
    link: linkPipedrive_(deal && deal.id),
    atribuicoes: {
      triagem_documentos: montarAtribuicao_(deal, CAMPOS_ATRIBUICAO.triagem_documentos),
      analise_credito: montarAtribuicao_(deal, CAMPOS_ATRIBUICAO.analise_credito),
      financiamento: montarAtribuicao_(deal, CAMPOS_ATRIBUICAO.financiamento)
    }
  };
}

function montarAtribuicao_(deal, config) {
  const valor = campoAtribuicao_(deal, config.baseName);
  const rotas = [];
  const optionIdsNaoMapeados = [];

  for (const optionId of valor.optionIds) {
    const rota = config.rotas[optionId];
    if (rota) {
      rotas.push(Object.assign({}, rota, {
        motivo_delegacao: config.baseName + "_" + optionId
      }));
    } else {
      optionIdsNaoMapeados.push(optionId);
    }
  }

  if (!rotas.length) rotas.push(fallbackRoute_("responsavel_nao_identificado"));

  return {
    campo: config.campo,
    valor: valor.label,
    option_ids: valor.optionIds,
    option_ids_nao_mapeados: optionIdsNaoMapeados,
    responsavel_identificado: rotas[0].routing_key === "ATENDIMENTO_FALLBACK" ? "nao" : "sim",
    rotas: rotas
  };
}

function fixedRoute_(routingKey, user) {
  return {
    delegacao_modo: "fixed",
    routing_key: routingKey,
    responsavel_destino_id: user.id,
    responsavel_destino_nome: user.nome,
    nota_funcionario: ""
  };
}

function assignmentRoute_(routingKey, nome) {
  return {
    delegacao_modo: "assignment",
    routing_key: routingKey,
    responsavel_destino_id: "",
    responsavel_destino_nome: nome,
    nota_funcionario: ""
  };
}

function fallbackRoute_(motivo) {
  return {
    delegacao_modo: "assignment",
    routing_key: "ATENDIMENTO_FALLBACK",
    responsavel_destino_id: "",
    responsavel_destino_nome: "Funil de Atendimento",
    motivo_delegacao: motivo,
    nota_funcionario: NOTA_FALLBACK
  };
}

function classificarProcessoTriagem_(deal) {
  const pipelineId = pipelineId_(deal);
  const formaPagamentoId = String((deal && deal.forma_pagamento_id) || "");

  if (pipelineId === "6" && formaPagamentoId === "34") {
    return {
      statusEnv: "ALLOWED_STATUSES_POS_ARREMATACAO",
      prioridade: 1
    };
  }
  if (pipelineId === "16") {
    return {
      statusEnv: "ALLOWED_STATUSES_ANALISE_CREDITO",
      prioridade: 2
    };
  }
  return null;
}

function statusPermitidoTriagem_(deal, processo) {
  const configurados = new Set();
  for (const name of [processo && processo.statusEnv, "ALLOWED_STATUSES_CHATAPP_FUNIS"]) {
    for (const item of lerListaEnv_(name)) configurados.add(item.toLowerCase());
  }

  const permitidos = configurados.size ? configurados : new Set(["open"]);
  return permitidos.has(String((deal && deal.status) || "").toLowerCase());
}

function lerListaEnv_(name) {
  if (!name) return [];
  return String(process.env[name] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function compararTriagem_(a, b) {
  return Number(a && a.processo && a.processo.prioridade || 99) -
    Number(b && b.processo && b.processo.prioridade || 99);
}

function compararCards_(dealA, dealB) {
  const openA = String((dealA && dealA.status) || "").toLowerCase() === "open" ? 0 : 1;
  const openB = String((dealB && dealB.status) || "").toLowerCase() === "open" ? 0 : 1;
  if (openA !== openB) return openA - openB;

  const updatedA = Date.parse(String((dealA && dealA.updated_at) || "")) || 0;
  const updatedB = Date.parse(String((dealB && dealB.updated_at) || "")) || 0;
  return updatedB - updatedA;
}

function campoAtribuicao_(deal, baseName) {
  if (!deal) return { optionIds: [], label: "" };

  const raw = deal[baseName + "_raw"];
  const optionIds = uniqueStrings_([]
    .concat(deal[baseName + "_ids"] || [])
    .concat(deal[baseName + "_id"] || [])
    .concat(extractOptionIds_(raw))
    .filter(Boolean));
  const label =
    scalarText_(deal[baseName]) ||
    extractOptionLabels_(raw).join(", ");

  return { optionIds: optionIds, label: label };
}

function extractOptionIds_(value) {
  if (value === null || value === undefined || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  return uniqueStrings_(values.map((item) => {
    if (item && typeof item === "object") {
      return item.id != null ? item.id : item.value;
    }
    return item;
  }).filter((item) => item != null && item !== ""));
}

function extractOptionLabels_(value) {
  if (value === null || value === undefined || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => {
    if (!item || typeof item !== "object") return "";
    return item.label != null
      ? item.label
      : (item.name != null ? item.name : item.display_value);
  }).filter(Boolean).map(String);
}

function scalarText_(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "object") return "";
  return String(value).trim();
}

function uniqueStrings_(values) {
  return Array.from(new Set((values || []).map((value) => String(value)).filter(Boolean)));
}

function dealTelefoneBate_(deal, variantes) {
  const valorDigits = telefoneDoDeal_(deal);
  if (!valorDigits) return false;

  return (variantes || []).some((value) => {
    const digits = String(value || "").replace(/\D+/g, "");
    return digits && (
      valorDigits === digits ||
      valorDigits.endsWith(digits) ||
      digits.endsWith(valorDigits)
    );
  });
}

function telefoneDoDeal_(deal) {
  const fields = (deal && deal.fields) || {};
  const value = fields[TELEFONE_ARREMATANTE_FIELD_LABEL] !== undefined
    ? fields[TELEFONE_ARREMATANTE_FIELD_LABEL]
    : (deal && deal.telefone);
  return normalizarTelefone(typeof value === "object" ? JSON.stringify(value) : value);
}

function pipelineId_(deal) {
  if (deal && deal.pipeline && deal.pipeline.id != null) return String(deal.pipeline.id);
  if (deal && deal.pipeline_id != null) return String(deal.pipeline_id);
  return "";
}

function linkPipedrive_(itemId) {
  if (itemId == null || itemId === "") return "";
  const domain = String(process.env.PIPEDRIVE_COMPANY_DOMAIN || "smartleiloes").trim() || "smartleiloes";
  return "https://" + domain + ".pipedrive.com/deal/" + String(itemId);
}

module.exports = {
  handleVerificarTriagemFunis,
  buscarImoveisPorTelefone,
  montarRespostaChatApp,
  montarAtribuicao_
};
