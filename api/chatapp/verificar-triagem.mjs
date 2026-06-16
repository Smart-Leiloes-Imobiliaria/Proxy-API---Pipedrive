// Rota isolada para o ChatApp decidir se inicia o bot de Triagem.
//
// Consulta o proxy Pipedrive (in-process, somente leitura) pelo campo customizado
// "Telefone do Arrematante" e responde se o cliente ja esta numa esteira de
// Analise de Credito ou Pos arrematacao. Nesses casos a Triagem NAO deve iniciar.
//
// Nao altera nenhum endpoint existente: apenas reusa proxy.handleProxyRequest.
// Nunca retorna o payload bruto do Pipedrive (somente os campos do contrato abaixo).
//
// TODO(leads): hoje so consultamos DEALS. O proxy atual nao expoe rota de leads.
//   Quando/se o proxy ganhar suporte a leads, estender buscarItensPorTelefone para
//   tambem buscar em leads e preencher cliente.tipo_item = "lead".
//
// Exemplo:
//   /api/chatapp/verificar-triagem?id_chat=553195611124&token=MINHA_CHAVE

import proxy from "../../lib/pipedrive-live-proxy.js";

// Campo customizado "Telefone do Arrematante" no Pipedrive (deal/lead).
const TELEFONE_ARREMATANTE_FIELD_KEY = "534ddc592e7b7db4b6d6faff0d07f2071684039e";
const TELEFONE_ARREMATANTE_FIELD_LABEL = "Telefone do Arrematante";

const MOTIVO_NAO_ENCONTRADO = "cliente_nao_encontrado_em_esteira";

// Definicao das esteiras. `prioridade` menor vence quando ha multiplos matches:
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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers.entries());
    return new Response(JSON.stringify(await handle(url, headers)), {
      status: tokenValido(url, headers) ? 200 : 401,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
};

async function handle(url, headers) {
  if (!tokenValido(url, headers)) {
    return { error: "unauthorized" };
  }

  const idChat = String(url.searchParams.get("id_chat") || "").trim();
  const telefone = normalizarTelefone(idChat);

  try {
    const variantes = gerarVariantesTelefone(telefone);
    const { match, matchesCount, matchedPhone } = await buscarItensPorTelefone(variantes);
    return montarRespostaChatApp({ match, matchesCount, matchedPhone });
  } catch (error) {
    // Requisito 11: em erro de consulta nao bloqueamos o atendimento; Triagem segue.
    const resposta = montarRespostaChatApp({ match: null, matchesCount: 0, matchedPhone: "" });
    resposta.debug.error = String((error && error.message) || error || "erro_desconhecido");
    return resposta;
  }
}

// ---------------------------------------------------------------------------
// Autenticacao interna (token do ChatApp)
// ---------------------------------------------------------------------------

function tokenValido(url, headers) {
  const esperado = String(process.env.CHATAPP_INTERNAL_TOKEN || "").trim();
  if (!esperado) return false;

  const recebido =
    String(url.searchParams.get("token") || "").trim() ||
    parseBearer(headers && headers.authorization) ||
    String((headers && headers["x-internal-token"]) || "").trim();

  return !!recebido && recebido === esperado;
}

function parseBearer(value) {
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
  const numericas = new Set();
  if (!digits) return [];

  numericas.add(digits);

  const comCodigo = []; // formas com DDI 55
  const semCodigo = []; // formas sem DDI

  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    comCodigo.push(digits);
    semCodigo.push(digits.slice(2));
  } else if (digits.length === 10 || digits.length === 11) {
    semCodigo.push(digits);
    comCodigo.push("55" + digits);
  }

  // Para cada forma sem codigo (DDD + numero), gera com/sem nono digito.
  for (const sem of semCodigo.slice()) {
    for (const alt of alternarNonoDigito(sem)) {
      semCodigo.push(alt);
      comCodigo.push("55" + alt);
    }
  }

  // Para cada forma com codigo (55 + DDD + numero), gera com/sem nono digito.
  for (const com of comCodigo.slice()) {
    const sem = com.slice(2);
    for (const alt of alternarNonoDigito(sem)) {
      comCodigo.push("55" + alt);
    }
  }

  for (const v of comCodigo) numericas.add(v);
  for (const v of semCodigo) numericas.add(v);

  // Versoes com "+".
  const todas = new Set();
  for (const v of numericas) {
    todas.add(v);
    todas.add("+" + v);
  }
  return Array.from(todas);
}

// Recebe DDD + numero (sem DDI). Devolve a variacao oposta quanto ao 9o digito.
function alternarNonoDigito(dddNumero) {
  const out = [];
  if (dddNumero.length === 11) {
    // DDD(2) + 9 digitos -> remove o 9 inicial do numero, se houver.
    const ddd = dddNumero.slice(0, 2);
    const num = dddNumero.slice(2);
    if (num.startsWith("9")) out.push(ddd + num.slice(1));
  } else if (dddNumero.length === 10) {
    // DDD(2) + 8 digitos -> adiciona o 9.
    const ddd = dddNumero.slice(0, 2);
    const num = dddNumero.slice(2);
    out.push(ddd + "9" + num);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Consulta ao Pipedrive via proxy interno
// ---------------------------------------------------------------------------

async function buscarItensPorTelefone(variantes) {
  let matchesCount = 0;
  // Melhor match por prioridade de esteira (Pos arrematacao > Analise de Credito).
  let melhor = null; // { deal, esteira, termo }
  const idsVistos = new Set();

  // Dedupe das variacoes numericas para reduzir chamadas (proxy ignora o "+").
  const termos = Array.from(new Set(variantes.map((v) => v.replace(/\D+/g, "")).filter(Boolean)));

  for (const termo of termos) {
    const deals = await buscarDealsPorTermo(termo);
    for (const deal of deals) {
      const id = deal && deal.id != null ? String(deal.id) : "";
      if (id && idsVistos.has(id)) continue;

      // Confirma que o telefone do arrematante realmente bate (evita falso positivo
      // da busca fuzzy do Pipedrive).
      if (!dealTelefoneBate(deal, variantes)) continue;

      // So interessa se cair numa esteira-alvo.
      const esteira = classificarRegistroPipedrive(deal);
      if (!esteira) continue;

      // Status permitido configuravel por esteira (default: "open").
      if (!statusPermitido(deal, esteira)) continue;

      if (id) idsVistos.add(id);
      matchesCount++;

      // Mantem o de maior prioridade (menor numero). Em empate, o primeiro encontrado.
      if (!melhor || esteira.prioridade < melhor.esteira.prioridade) {
        melhor = { deal, esteira, termo };
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

// Status do deal permitido para a esteira. Configuravel via env (lista por virgula);
// default "open" quando a env nao estiver definida.
function statusPermitido(deal, esteira) {
  const configurados = Array.from(lerListaEnv(esteira.statusEnv)).map((s) => s.toLowerCase());
  const lista = configurados.length ? new Set(configurados) : new Set(["open"]);
  return lista.has(String(deal.status || "").toLowerCase());
}

// Chama o proxy in-process (somente leitura) em /api/v2/deals/search.
async function buscarDealsPorTermo(termo) {
  const token = tokenProxyInterno();
  if (!token) throw new Error("PIPEDRIVE_PROXY_API_TOKEN nao configurado para consulta interna.");

  const params = new URLSearchParams({
    path: "/api/v2/deals/search",
    term: termo,
    exact_match: "true",
    fields: "custom_fields,title",
    api_token: token
  });

  const res = await proxy.handleProxyRequest({
    method: "GET",
    url: "http://internal/api/proxy?" + params.toString(),
    headers: {}
  });

  if (!res || Number(res.status) >= 400) {
    throw new Error("Falha na consulta ao proxy (status " + (res && res.status) + ").");
  }

  let json;
  try {
    json = JSON.parse(res.body);
  } catch (_) {
    throw new Error("Resposta invalida do proxy.");
  }

  const items = json && json.data && Array.isArray(json.data.items) ? json.data.items : [];
  return items.map((it) => (it && it.deal ? it.deal : null)).filter(Boolean);
}

// Verifica se o campo "Telefone do Arrematante" do deal contem alguma variacao.
function dealTelefoneBate(deal, variantes) {
  const fields = deal && deal.fields ? deal.fields : {};
  const valor = fields[TELEFONE_ARREMATANTE_FIELD_LABEL];
  const valorDigits = normalizarTelefone(typeof valor === "object" ? JSON.stringify(valor) : valor);
  if (!valorDigits) return false;

  return variantes.some((v) => {
    const d = v.replace(/\D+/g, "");
    return d && (valorDigits === d || valorDigits.endsWith(d) || d.endsWith(valorDigits));
  });
}

function tokenProxyInterno() {
  const raw = String(process.env.PIPEDRIVE_PROXY_API_TOKEN || "");
  const first = raw.split(",").map((t) => t.trim()).filter(Boolean)[0];
  return first || "";
}

// ---------------------------------------------------------------------------
// Classificacao
// ---------------------------------------------------------------------------

function lerListaEnv(name) {
  return new Set(
    String(process.env[name] || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

// Retorna a esteira (objeto de ESTEIRAS) em que o deal se enquadra, ou null.
// Pos arrematacao tem prioridade sobre Analise de Credito.
function classificarRegistroPipedrive(deal) {
  if (!deal) return null;

  const pipelineId = deal.pipeline && deal.pipeline.id != null ? String(deal.pipeline.id) : "";
  const stageId = deal.stage && deal.stage.id != null ? String(deal.stage.id) : "";

  // ESTEIRAS ja esta ordenado por prioridade (Pos arrematacao primeiro).
  for (const esteira of ESTEIRAS) {
    const pipelines = lerListaEnv(esteira.pipelinesEnv);
    const stages = lerListaEnv(esteira.stagesEnv);
    if ((pipelineId && pipelines.has(pipelineId)) || (stageId && stages.has(stageId))) {
      return esteira;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Montagem da resposta
// ---------------------------------------------------------------------------
// Todos os campos do contrato existem em TODAS as respostas de negocio (200),
// inclusive no fail-safe de erro. Strings vazias quando nao ha valor.

function montarRespostaChatApp({ match, esteira, matchesCount, matchedPhone }) {
  if (match && esteira) {
    const tipoItem = "deal"; // TODO(leads): suportar "lead" quando o proxy permitir.
    const itemId = match.id != null ? String(match.id) : "";
    const titulo = String(match.title || "");
    const telefone = matchedPhone || "";

    const nota =
      "/Cliente já está em " + esteira.processo + " no Pipedrive. " +
      "Não iniciar Triagem. Assumir atendimento pela esteira atual.\n\n" +
      "Telefone identificado: " + telefone + "\n" +
      "Tipo: " + tipoItem + "\n" +
      "ID Pipedrive: " + itemId + "\n" +
      "Título: " + titulo;

    return {
      triagem: { necessaria: "nao", motivo: esteira.motivo },
      cliente: {
        telefone: telefone,
        processo: esteira.processo,
        tipo_item: tipoItem,
        item_id: itemId,
        titulo: titulo
      },
      chatapp: { nota_funcionario: nota },
      debug: { matched_phone: telefone, matches_count: matchesCount || 0 }
    };
  }

  // Nao encontrado em esteira (ou erro) -> Triagem deve iniciar.
  return {
    triagem: { necessaria: "sim", motivo: MOTIVO_NAO_ENCONTRADO },
    cliente: { telefone: "", processo: "", tipo_item: "", item_id: "", titulo: "" },
    chatapp: { nota_funcionario: "" },
    debug: { matched_phone: "", matches_count: 0 }
  };
}
