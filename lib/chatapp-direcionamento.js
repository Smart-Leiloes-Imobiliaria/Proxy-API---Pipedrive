"use strict";

// Nova logica da rota de teste /api/chatapp/verificar-triagem-direcionamento.
// Mantem o contrato antigo da Triagem e acrescenta campos de roteamento para o
// ChatApp decidir entre Assignments/Distribution e delegacao fixa.

const triagemBase = require("./chatapp-triagem.js");

const normalizarTelefone = triagemBase.normalizarTelefone;
const gerarVariantesTelefone = triagemBase.gerarVariantesTelefone;
const classificarRegistroPipedrive = triagemBase.classificarRegistroPipedrive;

const TELEFONE_ARREMATANTE_FIELD_LABEL = "Telefone do Arrematante";
const MOTIVO_NAO_ENCONTRADO = "cliente_nao_encontrado_em_esteira";
const MOTIVO_CLIENTE_EM_ESTEIRA = "cliente_em_esteira";

const CHATAPP_USERS = {
  isaque: { id: "81040", nome: "Isaque Coelho" },
  isadora: { id: "90720", nome: "Isadora Campos" },
  thales: { id: "78057", nome: "Thales" },
  daniela: { id: "92346", nome: "Daniela" },
  marloon: { id: "98226", nome: "Marloon" },
  dimitri: { id: "78043", nome: "Dimitri" }
};

const RODIZIO_TRIAGEM_NOME = "Rodízio Triagem: Isaque Coelho / Isadora Campos";

const CUSTOM_OPTION_IDS = {
  atribuido_financiamento: {
    marloon: new Set(["2804"]),
    dimitri: new Set(["2793"])
  },
  atribuido_documentacao_pendente: {
    isaque: new Set(["2780"]),
    isadora: new Set(["2823"])
  }
};

const STAGE_IDS = {
  triagem: new Set(["137", "145", "144"]),
  documentacao_pendente: new Set(["139"]),
  analise_credito: new Set(["140", "141", "142", "143"])
};

const STAGE_NAMES = {
  triagem: new Set([
    "iniciar triagem",
    "triagem em andamento",
    "triagem incompleta"
  ]),
  documentacao_pendente: new Set([
    "documentacao pendente"
  ]),
  analise_credito: new Set([
    "iniciar analise de credito",
    "analise de credito em andamento",
    "analise em andamento",
    "pendencia na analise",
    "analise finalizada"
  ])
};

async function handleVerificarTriagem(input, searchDeals) {
  const query = (input && input.query) || {};
  const headers = (input && input.headers) || {};

  if (!tokenValido_(query, headers)) {
    return { status: 401, payload: { error: "unauthorized" } };
  }

  const requestedPhone = normalizarTelefone(query.id_chat);

  try {
    const variantes = gerarVariantesTelefone(requestedPhone);
    const resultado = await buscarItensPorTelefone(variantes, searchDeals);
    resultado.requestedPhone = requestedPhone;
    return { status: 200, payload: montarRespostaChatApp(resultado) };
  } catch (error) {
    const payload = montarRespostaChatApp({
      match: null,
      avaliacao: null,
      matchesCount: 0,
      matchedPhone: "",
      requestedPhone: requestedPhone,
      reason: MOTIVO_NAO_ENCONTRADO
    });
    payload.debug.error = String((error && error.message) || error || "erro_desconhecido");
    return { status: 200, payload: payload };
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

async function buscarItensPorTelefone(variantes, searchDeals) {
  if (typeof searchDeals !== "function") {
    throw new Error("searchDeals nao foi informado.");
  }

  const termos = Array.from(new Set(
    (variantes || []).map((v) => String(v || "").replace(/\D+/g, "")).filter(Boolean)
  ));
  const deals = (await searchDeals(termos)) || [];
  const idsVistos = new Set();

  let matchesCount = 0;
  let melhor = null; // { deal, avaliacao }

  for (const deal of deals) {
    const id = deal && deal.id != null ? String(deal.id) : "";
    if (id && idsVistos.has(id)) continue;
    if (!dealTelefoneBate_(deal, variantes)) continue;

    const avaliacao = avaliarDealParaDirecionamento(deal);
    if (!avaliacao.elegivel) continue;
    if (!statusPermitido_(deal, avaliacao)) continue;

    if (id) idsVistos.add(id);
    matchesCount++;

    if (!melhor || compararAvaliacoes_(avaliacao, melhor.avaliacao) < 0) {
      melhor = { deal: deal, avaliacao: avaliacao };
    }
  }

  return {
    match: melhor ? melhor.deal : null,
    avaliacao: melhor ? melhor.avaliacao : null,
    matchesCount: melhor ? matchesCount : 0,
    matchedPhone: melhor ? telefoneDoDeal_(melhor.deal) : "",
    reason: melhor ? MOTIVO_CLIENTE_EM_ESTEIRA : MOTIVO_NAO_ENCONTRADO
  };
}

function avaliarDealParaDirecionamento(deal) {
  const delegacao = decidirDelegacao(deal);
  const grupoEtapa = classificarGrupoEtapa_(deal);
  const esteiraExistente = classificarRegistroPipedrive(deal);
  const temRota = delegacao && delegacao.routing_key && delegacao.routing_key !== "SEM_ROTA";

  if (!temRota && !grupoEtapa && !esteiraExistente) {
    return { elegivel: false, delegacao: semDelegacao_("sem_regra_de_direcionamento_para_etapa") };
  }

  const processo = grupoEtapa
    ? "Análise de Crédito"
    : (esteiraExistente && esteiraExistente.processo) || (temRota ? "Financiamento" : "");

  return {
    elegivel: true,
    prioridade: prioridadeAvaliacao_(delegacao, grupoEtapa, esteiraExistente),
    grupoEtapa: grupoEtapa,
    esteira: esteiraExistente,
    processo: processo,
    motivo: MOTIVO_CLIENTE_EM_ESTEIRA,
    delegacao: delegacao
  };
}

function prioridadeAvaliacao_(delegacao, grupoEtapa, esteiraExistente) {
  if (delegacao && delegacao.routing_key === "FINANCIAMENTO_MARLOON") return 0;
  if (grupoEtapa && grupoEtapa.key === "documentacao_pendente") return 1;
  if (grupoEtapa && grupoEtapa.key === "analise_credito") return 2;
  if (grupoEtapa && grupoEtapa.key === "triagem") return 3;
  if (esteiraExistente && esteiraExistente.prioridade != null) return 10 + Number(esteiraExistente.prioridade);
  return 99;
}

function compararAvaliacoes_(a, b) {
  const pa = Number(a && a.prioridade);
  const pb = Number(b && b.prioridade);
  if (pa !== pb) return pa - pb;
  return 0;
}

function statusPermitido_(deal, avaliacao) {
  const envNames = [];
  if (avaliacao && avaliacao.grupoEtapa) envNames.push("ALLOWED_STATUSES_ANALISE_CREDITO");
  if (avaliacao && avaliacao.esteira && avaliacao.esteira.statusEnv) envNames.push(avaliacao.esteira.statusEnv);
  envNames.push("ALLOWED_STATUSES_CHATAPP_DIRECIONAMENTO");

  const configurados = new Set();
  for (const name of envNames) {
    for (const item of lerListaEnv_(name)) configurados.add(String(item || "").toLowerCase());
  }

  const permitidos = configurados.size ? configurados : new Set(["open"]);
  return permitidos.has(String((deal && deal.status) || "").toLowerCase());
}

function lerListaEnv_(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function decidirDelegacao(deal) {
  const financiamento = campoPessoa_(deal, "atribuido_financiamento");
  if (
    campoBate_(financiamento, CUSTOM_OPTION_IDS.atribuido_financiamento.marloon, ["marloon"]) ||
    campoBate_(financiamento, CUSTOM_OPTION_IDS.atribuido_financiamento.dimitri, ["dimitri"])
  ) {
    return fixedDelegacao_(
      "FINANCIAMENTO_MARLOON",
      CHATAPP_USERS.marloon,
      "atribuido_financiamento_marloon_ou_dimitri"
    );
  }

  const grupoEtapa = classificarGrupoEtapa_(deal);
  if (grupoEtapa && grupoEtapa.key === "triagem") {
    return assignmentDelegacao_("TRIAGEM_RODIZIO", "etapa_triagem_rodizio");
  }

  if (grupoEtapa && grupoEtapa.key === "documentacao_pendente") {
    const documentacao = campoPessoa_(deal, "atribuido_documentacao_pendente");
    if (campoBate_(documentacao, CUSTOM_OPTION_IDS.atribuido_documentacao_pendente.isaque, ["isaque"])) {
      return fixedDelegacao_(
        "DOCUMENTACAO_PENDENTE_ISAQUE",
        CHATAPP_USERS.isaque,
        "atribuido_documentacao_pendente_isaque"
      );
    }
    if (campoBate_(documentacao, CUSTOM_OPTION_IDS.atribuido_documentacao_pendente.isadora, ["isadora"])) {
      return fixedDelegacao_(
        "DOCUMENTACAO_PENDENTE_ISADORA",
        CHATAPP_USERS.isadora,
        "atribuido_documentacao_pendente_isadora"
      );
    }
    return assignmentDelegacao_(
      "DOCUMENTACAO_PENDENTE_SEM_ATRIBUIDO",
      "documentacao_pendente_sem_atribuido_valido"
    );
  }

  if (grupoEtapa && grupoEtapa.key === "analise_credito") {
    if (ownerBate_(deal, "daniela")) {
      return fixedDelegacao_(
        "ANALISE_CREDITO_DANIELA",
        CHATAPP_USERS.daniela,
        "owner_pipedrive_daniela"
      );
    }
    if (ownerBate_(deal, "thales")) {
      return fixedDelegacao_(
        "ANALISE_CREDITO_THALES",
        CHATAPP_USERS.thales,
        "owner_pipedrive_thales"
      );
    }
    return semDelegacao_("analise_credito_owner_nao_reconhecido");
  }

  return semDelegacao_("sem_regra_de_direcionamento_para_etapa");
}

function fixedDelegacao_(routingKey, user, motivo) {
  return {
    delegacao_modo: "fixed",
    routing_key: routingKey,
    responsavel_destino_id: user.id,
    responsavel_destino_nome: user.nome,
    motivo_delegacao: motivo
  };
}

function assignmentDelegacao_(routingKey, motivo) {
  return {
    delegacao_modo: "assignment",
    routing_key: routingKey,
    responsavel_destino_id: "",
    responsavel_destino_nome: RODIZIO_TRIAGEM_NOME,
    motivo_delegacao: motivo
  };
}

function semDelegacao_(motivo) {
  return {
    delegacao_modo: "none",
    routing_key: "SEM_ROTA",
    responsavel_destino_id: "",
    responsavel_destino_nome: "",
    motivo_delegacao: motivo || ""
  };
}

function ownerBate_(deal, pessoa) {
  const ownerId = String((deal && deal.owner_id) || "").trim();
  const ownerName = String((deal && deal.owner_name) || "").trim();
  const idsEnv = new Set(lerListaEnv_("PIPEDRIVE_OWNER_IDS_" + String(pessoa || "").toUpperCase()));
  if (ownerId && idsEnv.has(ownerId)) return true;
  return normalizarTexto_(ownerName).indexOf(String(pessoa || "").toLowerCase()) !== -1;
}

function classificarGrupoEtapa_(deal) {
  const etapa = normalizarTexto_((deal && deal.etapa) || (deal && deal.stage && deal.stage.name) || "");
  const stageId = String(
    (deal && deal.stage && deal.stage.id != null ? deal.stage.id : "") ||
    (deal && deal.stage_id != null ? deal.stage_id : "")
  );

  for (const key of ["triagem", "documentacao_pendente", "analise_credito"]) {
    if (stageId && STAGE_IDS[key].has(stageId)) return { key: key };
    if (etapa && STAGE_NAMES[key].has(etapa)) return { key: key };
  }

  return null;
}

function montarRespostaChatApp(resultado) {
  const match = resultado && resultado.match;
  const avaliacao = resultado && resultado.avaliacao;
  const matchesCount = (resultado && resultado.matchesCount) || 0;
  const matchedPhone = (resultado && resultado.matchedPhone) || "";
  const requestedPhone = (resultado && resultado.requestedPhone) || "";
  const reason = (resultado && resultado.reason) || (match ? MOTIVO_CLIENTE_EM_ESTEIRA : MOTIVO_NAO_ENCONTRADO);

  if (match && avaliacao) {
    const tipoItem = "deal";
    const itemId = match.id != null ? String(match.id) : "";
    const titulo = String(match.title || "");
    const link = linkPipedrive_(itemId);
    const etapa = String(match.etapa || "");
    const status = montarStatus_(match);
    const delegacao = avaliacao.delegacao || semDelegacao_("sem_regra_de_direcionamento_para_etapa");
    const processo = avaliacao.processo || "";
    const financiamento = campoPessoa_(match, "atribuido_financiamento");
    const documentacao = campoPessoa_(match, "atribuido_documentacao_pendente");

    const nota =
      "/Cliente já está em " + processo + " no Pipedrive. " +
      "Não iniciar Triagem. Assumir atendimento pela esteira atual.\n\n" +
      "Telefone identificado: " + matchedPhone + "\n" +
      "Tipo: " + tipoItem + "\n" +
      "ID Pipedrive: " + itemId + "\n" +
      "Título: " + titulo + "\n" +
      "Etapa: " + etapa + "\n" +
      "Status: " + status + "\n" +
      "Owner: " + String(match.owner_name || "") + "\n" +
      "Roteamento: " + delegacao.routing_key + " (" + delegacao.delegacao_modo + ")\n" +
      "Destino: " + String(delegacao.responsavel_destino_nome || "") + "\n" +
      "Link: " + link;

    return {
      triagem: { necessaria: "nao", motivo: MOTIVO_CLIENTE_EM_ESTEIRA },
      cliente: {
        telefone: matchedPhone,
        processo: processo,
        etapa: etapa,
        status: status,
        tipo_item: tipoItem,
        item_id: itemId,
        titulo: titulo,
        link: link,
        owner_id: match.owner_id == null ? "" : String(match.owner_id),
        owner_name: String(match.owner_name || ""),
        atribuido_financiamento: financiamento.label,
        atribuido_documentacao_pendente: documentacao.label
      },
      chatapp: Object.assign({ nota_funcionario: nota }, delegacao),
      debug: {
        requested_phone: requestedPhone,
        matched_phone: matchedPhone,
        matches_count: matchesCount,
        reason: reason
      }
    };
  }

  return {
    triagem: { necessaria: "sim", motivo: MOTIVO_NAO_ENCONTRADO },
    cliente: {
      telefone: "",
      processo: "",
      etapa: "",
      status: "",
      tipo_item: "",
      item_id: "",
      titulo: "",
      link: "",
      owner_id: "",
      owner_name: "",
      atribuido_financiamento: "",
      atribuido_documentacao_pendente: ""
    },
    chatapp: Object.assign({ nota_funcionario: "" }, semDelegacao_(MOTIVO_NAO_ENCONTRADO)),
    debug: {
      requested_phone: requestedPhone,
      matched_phone: "",
      matches_count: 0,
      reason: MOTIVO_NAO_ENCONTRADO
    }
  };
}

function montarStatus_(deal) {
  const pipelineId = deal && deal.pipeline && deal.pipeline.id != null ? String(deal.pipeline.id) : "";
  if (pipelineId !== "6") return "n/a";

  if (String(deal.forma_pagamento_id || "") === "34") {
    return Number(deal.valor_fgts || 0) > 0
      ? String(deal.status_fgts_financiado || "")
      : String(deal.status_financiamento || "");
  }
  return "";
}

function campoPessoa_(deal, baseName) {
  const raw = deal && deal[baseName + "_raw"] !== undefined ? deal[baseName + "_raw"] : undefined;
  const id =
    scalarText_(deal && deal[baseName + "_id"]) ||
    extractOptionId_(raw) ||
    extractOptionId_(deal && deal[baseName]);
  const label =
    scalarText_(deal && deal[baseName]) ||
    extractOptionLabel_(raw) ||
    extractOptionLabel_(deal && deal[baseName]);

  return {
    id: id,
    label: label,
    normalized: normalizarTexto_([id, label].filter(Boolean).join(" "))
  };
}

function campoBate_(campo, ids, tokens) {
  const idSet = ids || new Set();
  if (campo && campo.id && idSet.has(String(campo.id))) return true;
  const text = String(campo && campo.normalized || "");
  return (tokens || []).some((token) => text.indexOf(normalizarTexto_(token)) !== -1);
}

function dealTelefoneBate_(deal, variantes) {
  const valorDigits = telefoneDoDeal_(deal);
  if (!valorDigits) return false;

  return (variantes || []).some((v) => {
    const d = String(v || "").replace(/\D+/g, "");
    return d && (valorDigits === d || valorDigits.endsWith(d) || d.endsWith(valorDigits));
  });
}

function telefoneDoDeal_(deal) {
  const fields = (deal && deal.fields) || {};
  const valor = fields[TELEFONE_ARREMATANTE_FIELD_LABEL] !== undefined
    ? fields[TELEFONE_ARREMATANTE_FIELD_LABEL]
    : (deal && deal.telefone);
  return normalizarTelefone(typeof valor === "object" ? JSON.stringify(valor) : valor);
}

function linkPipedrive_(itemId) {
  if (!itemId) return "";
  const dominio = String(process.env.PIPEDRIVE_COMPANY_DOMAIN || "smartleiloes").trim() || "smartleiloes";
  return "https://" + dominio + ".pipedrive.com/deal/" + itemId;
}

function normalizarTexto_(value) {
  let text = String(value == null ? "" : value).toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (e) {}
  return text.trim();
}

function scalarText_(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "object") return "";
  return String(value).trim();
}

function extractOptionId_(value) {
  if (value === null || value === undefined || value === "") return "";
  const item = Array.isArray(value) ? (value.length ? value[0] : null) : value;
  if (item && typeof item === "object") {
    const id = item.id != null ? item.id : (item.value != null ? item.value : null);
    return id == null ? "" : String(id);
  }
  return String(item).trim();
}

function extractOptionLabel_(value) {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.map(extractOptionLabel_).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    if (value.label != null) return String(value.label).trim();
    if (value.name != null) return String(value.name).trim();
    if (value.display_value != null) return String(value.display_value).trim();
    return "";
  }
  return String(value).trim();
}

module.exports = {
  handleVerificarTriagem,
  buscarItensPorTelefone,
  avaliarDealParaDirecionamento,
  decidirDelegacao,
  montarRespostaChatApp,
  normalizarTexto_
};
