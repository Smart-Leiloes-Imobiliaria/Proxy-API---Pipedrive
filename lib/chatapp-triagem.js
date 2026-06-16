"use strict";

// Logica isolada da rota /api/chatapp/verificar-triagem.
//
// Decide se o ChatApp deve iniciar o bot de Triagem. Se o cliente ja esta numa
// esteira de Analise de Credito ou Pos arrematacao, a Triagem NAO deve iniciar.
//
// Este modulo NAO acessa o Pipedrive diretamente: recebe uma funcao `searchDeals`
// que executa a busca (injetada pelo proxy ou pelo handler da function). Assim a
// logica fica testavel e desacoplada do transporte. Nunca retorna payload bruto
// do Pipedrive (somente os campos do contrato).
//
// TODO(leads): hoje so consultamos DEALS. O proxy nao expoe rota de leads. Quando
//   passar a expor, estender a busca para leads e preencher cliente.tipo_item="lead".

const TELEFONE_ARREMATANTE_FIELD_LABEL = "Telefone do Arrematante";
const MOTIVO_NAO_ENCONTRADO = "cliente_nao_encontrado_em_esteira";

// Esteiras. `prioridade` menor vence quando ha multiplos matches:
// Pos arrematacao (1) > Analise de Credito (2).
const ESTEIRAS = [
  {
    key: "pos_arrematacao",
    processo: "Pós arrematação",
    motivo: "cliente_em_pos_arrematacao",
    pipelinesEnv: "PIPELINES_POS_ARREMATACAO",
    stagesEnv: "STAGES_POS_ARREMATACAO",
    statusEnv: "ALLOWED_STATUSES_POS_ARREMATACAO",
    prioridade: 1
  },
  {
    key: "analise_credito",
    processo: "Análise de Crédito",
    motivo: "cliente_em_analise_credito",
    pipelinesEnv: "PIPELINES_ANALISE_CREDITO",
    stagesEnv: "STAGES_ANALISE_CREDITO",
    statusEnv: "ALLOWED_STATUSES_ANALISE_CREDITO",
    prioridade: 2
  }
];

// Entrypoint. Recebe { query, headers } e `searchDeals(term) -> Promise<deal[]>`.
// Retorna { status, payload }.
async function handleVerificarTriagem(input, searchDeals) {
  const query = (input && input.query) || {};
  const headers = (input && input.headers) || {};

  if (!tokenValido_(query, headers)) {
    return { status: 401, payload: { error: "unauthorized" } };
  }

  const telefone = normalizarTelefone(query.id_chat);

  try {
    const variantes = gerarVariantesTelefone(telefone);
    const resultado = await buscarItensPorTelefone(variantes, searchDeals);
    return { status: 200, payload: montarRespostaChatApp(resultado) };
  } catch (error) {
    // Requisito: em erro de consulta nao bloqueamos o atendimento; Triagem segue.
    const payload = montarRespostaChatApp({ match: null, esteira: null, matchesCount: 0, matchedPhone: "" });
    payload.debug.error = String((error && error.message) || error || "erro_desconhecido");
    return { status: 200, payload: payload };
  }
}

// ---------------------------------------------------------------------------
// Autenticacao interna (token do ChatApp)
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
// Telefone
// ---------------------------------------------------------------------------

function normalizarTelefone(value) {
  return String(value == null ? "" : value).replace(/\D+/g, "");
}

// Gera variacoes do telefone tratando o nono digito brasileiro.
// Retorna strings apenas-numeros e tambem as versoes com "+".
function gerarVariantesTelefone(telefone) {
  const digits = normalizarTelefone(telefone);
  if (!digits) return [];

  const numericas = new Set([digits]);
  const comCodigo = []; // formas com DDI 55
  const semCodigo = []; // formas sem DDI

  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    comCodigo.push(digits);
    semCodigo.push(digits.slice(2));
  } else if (digits.length === 10 || digits.length === 11) {
    semCodigo.push(digits);
    comCodigo.push("55" + digits);
  }

  for (const sem of semCodigo.slice()) {
    for (const alt of alternarNonoDigito_(sem)) {
      semCodigo.push(alt);
      comCodigo.push("55" + alt);
    }
  }
  for (const com of comCodigo.slice()) {
    for (const alt of alternarNonoDigito_(com.slice(2))) {
      comCodigo.push("55" + alt);
    }
  }

  for (const v of comCodigo) numericas.add(v);
  for (const v of semCodigo) numericas.add(v);

  const todas = new Set();
  for (const v of numericas) {
    todas.add(v);
    todas.add("+" + v);
  }
  return Array.from(todas);
}

// Recebe DDD + numero (sem DDI). Devolve a variacao oposta quanto ao 9o digito.
function alternarNonoDigito_(dddNumero) {
  const out = [];
  const ddd = dddNumero.slice(0, 2);
  const num = dddNumero.slice(2);
  if (dddNumero.length === 11) {
    if (num.startsWith("9")) out.push(ddd + num.slice(1)); // remove o 9
  } else if (dddNumero.length === 10) {
    out.push(ddd + "9" + num); // adiciona o 9
  }
  return out;
}

// ---------------------------------------------------------------------------
// Busca / matching
// ---------------------------------------------------------------------------

async function buscarItensPorTelefone(variantes, searchDeals) {
  let matchesCount = 0;
  let melhor = null; // { deal, esteira, termo }
  const idsVistos = new Set();

  // Dedupe das variacoes numericas para reduzir chamadas (busca ignora o "+").
  const termos = Array.from(new Set(variantes.map((v) => v.replace(/\D+/g, "")).filter(Boolean)));

  // Buscas em PARALELO (uma por termo). Cada chamada e cacheada no proxy.
  const resultados = await Promise.all(
    termos.map((termo) =>
      Promise.resolve()
        .then(() => searchDeals(termo))
        .then((deals) => ({ termo: termo, deals: deals || [] }))
    )
  );

  for (const { termo, deals } of resultados) {
    for (const deal of deals) {
      const id = deal && deal.id != null ? String(deal.id) : "";
      if (id && idsVistos.has(id)) continue;

      // Confirma que o telefone do arrematante realmente bate (evita falso positivo
      // da busca fuzzy do Pipedrive).
      if (!dealTelefoneBate_(deal, variantes)) continue;

      const esteira = classificarRegistroPipedrive(deal);
      if (!esteira) continue;

      // Status permitido configuravel por esteira (default: "open").
      if (!statusPermitido_(deal, esteira)) continue;

      if (id) idsVistos.add(id);
      matchesCount++;

      // Mantem o de maior prioridade (menor numero). Em empate, o primeiro encontrado.
      if (!melhor || esteira.prioridade < melhor.esteira.prioridade) {
        melhor = { deal: deal, esteira: esteira, termo: termo };
      }
    }
  }

  return {
    match: melhor ? melhor.deal : null,
    esteira: melhor ? melhor.esteira : null,
    matchesCount: melhor ? matchesCount : 0,
    matchedPhone: melhor ? melhor.termo : ""
  };
}

function statusPermitido_(deal, esteira) {
  const configurados = Array.from(lerListaEnv_(esteira.statusEnv)).map((s) => s.toLowerCase());
  const lista = configurados.length ? new Set(configurados) : new Set(["open"]);
  return lista.has(String((deal && deal.status) || "").toLowerCase());
}

// Verifica se o campo "Telefone do Arrematante" do deal contem alguma variacao.
function dealTelefoneBate_(deal, variantes) {
  const fields = (deal && deal.fields) || {};
  const valor = fields[TELEFONE_ARREMATANTE_FIELD_LABEL];
  const valorDigits = normalizarTelefone(typeof valor === "object" ? JSON.stringify(valor) : valor);
  if (!valorDigits) return false;

  return variantes.some((v) => {
    const d = v.replace(/\D+/g, "");
    return d && (valorDigits === d || valorDigits.endsWith(d) || d.endsWith(valorDigits));
  });
}

// ---------------------------------------------------------------------------
// Classificacao
// ---------------------------------------------------------------------------

function lerListaEnv_(name) {
  return new Set(
    String(process.env[name] || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

// Retorna a esteira em que o deal se enquadra, ou null.
function classificarRegistroPipedrive(deal) {
  if (!deal) return null;

  const pipelineId = deal.pipeline && deal.pipeline.id != null ? String(deal.pipeline.id) : "";
  const stageId = deal.stage && deal.stage.id != null ? String(deal.stage.id) : "";

  for (const esteira of ESTEIRAS) {
    const pipelines = lerListaEnv_(esteira.pipelinesEnv);
    const stages = lerListaEnv_(esteira.stagesEnv);
    if ((pipelineId && pipelines.has(pipelineId)) || (stageId && stages.has(stageId))) {
      return esteira;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Montagem da resposta (todos os campos sempre presentes)
// ---------------------------------------------------------------------------

function montarRespostaChatApp(resultado) {
  const match = resultado && resultado.match;
  const esteira = resultado && resultado.esteira;
  const matchesCount = (resultado && resultado.matchesCount) || 0;
  const matchedPhone = (resultado && resultado.matchedPhone) || "";

  if (match && esteira) {
    const tipoItem = "deal"; // TODO(leads): suportar "lead" quando o proxy permitir.
    const itemId = match.id != null ? String(match.id) : "";
    const titulo = String(match.title || "");
    const link = linkPipedrive_(tipoItem, itemId);

    const nota =
      "/Cliente já está em " + esteira.processo + " no Pipedrive. " +
      "Não iniciar Triagem. Assumir atendimento pela esteira atual.\n\n" +
      "Telefone identificado: " + matchedPhone + "\n" +
      "Tipo: " + tipoItem + "\n" +
      "ID Pipedrive: " + itemId + "\n" +
      "Título: " + titulo + "\n" +
      "Link: " + link;

    return {
      triagem: { necessaria: "nao", motivo: esteira.motivo },
      cliente: {
        telefone: matchedPhone,
        processo: esteira.processo,
        tipo_item: tipoItem,
        item_id: itemId,
        titulo: titulo,
        link: link
      },
      chatapp: { nota_funcionario: nota },
      debug: { matched_phone: matchedPhone, matches_count: matchesCount }
    };
  }

  return {
    triagem: { necessaria: "sim", motivo: MOTIVO_NAO_ENCONTRADO },
    cliente: { telefone: "", processo: "", tipo_item: "", item_id: "", titulo: "", link: "" },
    chatapp: { nota_funcionario: "" },
    debug: { matched_phone: "", matches_count: 0 }
  };
}

// Monta o link do registro no Pipedrive. Dominio configuravel via PIPEDRIVE_COMPANY_DOMAIN.
function linkPipedrive_(tipoItem, itemId) {
  if (!itemId) return "";
  const dominio = String(process.env.PIPEDRIVE_COMPANY_DOMAIN || "smartleiloes").trim() || "smartleiloes";
  const base = "https://" + dominio + ".pipedrive.com";
  // TODO(leads): quando suportar lead, usar o caminho de lead do Pipedrive.
  return base + "/deal/" + itemId;
}

module.exports = {
  handleVerificarTriagem,
  // exportados para teste/uso isolado:
  normalizarTelefone,
  gerarVariantesTelefone,
  classificarRegistroPipedrive,
  montarRespostaChatApp,
  buscarItensPorTelefone
};
