"use strict";

const DEFAULT_CONFIG = {
  domain: process.env.PIPEDRIVE_COMPANY_DOMAIN || "smartleiloes",
  tokenKey: "PIPEDRIVE_API_TOKEN",
  proxyTokenKey: "PIPEDRIVE_PROXY_API_TOKEN",
  apiDefaultLimit: readPositiveInt("PIPEDRIVE_PROXY_DEFAULT_LIMIT", 100),
  apiMaxLimit: readPositiveInt("PIPEDRIVE_PROXY_MAX_LIMIT", 500),
  upstreamMaxLimit: readPositiveInt("PIPEDRIVE_PROXY_UPSTREAM_LIMIT", 100),
  readonlyCacheTtlSeconds: readPositiveInt("PIPEDRIVE_PROXY_UPSTREAM_CACHE_TTL_SECONDS", 60),
  detailCacheTtlSeconds: readPositiveInt("PIPEDRIVE_PROXY_DETAIL_CACHE_TTL_SECONDS", 60),
  metadataCacheTtlSeconds: readPositiveInt("PIPEDRIVE_PROXY_METADATA_CACHE_TTL_SECONDS", 21600),
  cdnCacheTtlSeconds: readNonNegativeInt("PIPEDRIVE_PROXY_CDN_CACHE_TTL_SECONDS", 30),
  concurrency: readPositiveInt("PIPEDRIVE_PROXY_CONCURRENCY", 8),
  fetchTimeoutMs: readPositiveInt("PIPEDRIVE_PROXY_FETCH_TIMEOUT_MS", 25000),
  fetchRetries: readPositiveInt("PIPEDRIVE_PROXY_FETCH_RETRIES", 3),
  propertyCodeScanMaxPages: readPositiveInt("PIPEDRIVE_PROXY_PROPERTY_CODE_SCAN_MAX_PAGES", 100),
  maxCacheEntries: readPositiveInt("PIPEDRIVE_PROXY_MAX_CACHE_ENTRIES", 1000)
};

const PROPERTY_CODE_FIELD_FALLBACK_KEYS = [
  "5c3aac951d1281021e01c13aa7a11a449efeabd1"
];

const FILTER_21468_FIELD_KEYS = {
  estado: "3ef5cf03684be08f489d78569853f842ff64c978",
  cidade: "e8f876fd548041008611749b4c821a7d67af9917",
  numero_imovel: "5c3aac951d1281021e01c13aa7a11a449efeabd1",
  link_google_drive: "650926168d68c7133f9d9fc0c0af0185e39a60f3",
  desconto_smart_x_pago: "082db11dbf79f77e3f681632962be4a99c94e7e6",
  valor_total_proposta: "297f612d150bbf3892cf0cc2f1e902a4aad987be",
  valor_medio_estimado_venda: "6ca04ef8a72efcbae099b0f3c2bbcddaf69f70be",
  valor_avaliacao_caixa: "87fecbda0a607e8d7dc2b8fda02f419c7a3a60fb",
  email_arrematante: "720d2207af311eff3c9f6fc143aeb25ce7a19b35",
  telefone_arrematante: "534ddc592e7b7db4b6d6faff0d07f2071684039e",
  atribuido_analise_basica: "73d5e4a4acdddf6759fc7d6a2f310116d9c838f3",
  status_analise_basica: "500817fc0d51dd925505281d99b0e21b1ae4beb6",
  atribuido_analise_juridica: "ab4066f405319986f4179c21733a41887c68ad52",
  status_analise_juridica: "77670428dd5e8eac1bfb889a833810e86dae18e7",
  atribuido_analise_mercado: "01776e9fd027b30f1302a306367edaa4b1472eac",
  status_analise_mercado: "4e48e3f6c03f9a6c65e008eaf88d5bdba50186f6",
  atribuido_diligencia_pre_arrematacao: "e1325020945e6e3cfa48ec3a8eabe213b721db74",
  status_diligencia_pre_arrematacao: "ec7310083cda13f3acdd6c050d9ebceaeea0628b"
};

const ROUTES = [
  "/health",
  "/api/v2/deals",
  "/api/v2/deals/{id}",
  "/api/v2/deals/products",
  "/api/v2/deals/search",
  "/api/v2/deals/filter/21468",
  "/api/v2/persons",
  "/api/v2/persons/{id}",
  "/api/v2/organizations",
  "/api/v2/organizations/{id}",
  "/api/v2/pipelines",
  "/api/v2/stages",
  "/v1/users",
  "/v1/dealFields",
  "/v1/personFields",
  "/api/chatapp/verificar-triagem",
  "/api/chatapp/verificar-triagem-direcionamento"
];

const FILTERS = [
  "status",
  "ids",
  "owner_id",
  "person_id",
  "org_id",
  "pipeline_id",
  "stage_id",
  "updated_since",
  "updated_until",
  "filter_id",
  "limit",
  "cursor",
  "sort_by",
  "sort_direction",
  "term",
  "fields",
  "exact_match",
  "search_by"
];

const PERSON_STANDARD_FIELD_LABELS = {
  activities_count: "Total de atividades",
  add_time: "Pessoa criada",
  closed_deals_count: "Negocios fechados",
  done_activities_count: "Atividades concluidas",
  email: "E-mail",
  email_messages_count: "Numero de mensagens de e-mail",
  first_name: "Primeiro nome",
  id: "ID",
  label: "Etiqueta",
  label_ids: "Etiquetas",
  last_activity_date: "Data da ultima atividade",
  last_incoming_mail_time: "Ultimo e-mail recebido",
  last_name: "Sobrenome",
  last_outgoing_mail_time: "Ultimo e-mail enviado",
  lost_deals_count: "Negocios perdidos",
  name: "Nome",
  next_activity_date: "Proxima atividade em",
  open_deals_count: "Negocios em aberto",
  org_id: "Organizacao",
  owner_id: "Proprietario",
  phone: "Telefone",
  picture_id: "Foto de perfil",
  undone_activities_count: "Atividades para fazer",
  update_time: "Atualizado em",
  visible_to: "Visivel para",
  won_deals_count: "Negocios ganhos"
};

const PERSON_CUSTOM_FIELD_FALLBACK_LABELS = {
  "0bd63756e59b9f0dbad8d706f245938534f8f2a7": "Cidade",
  "1771cc0156412e369047e4ff8179b99ada50a51e": "Link da pessoa no google drive",
  "1833b0f20cc717dd8c858253074a68aa7e87d914": "Arrematacoes do casal (acumuladas)",
  "1d02a603016c1b96c4f37830f79d7818833e0af6": "bitrix_id",
  "2e8ec4f73b1fa33bf9403bbd5f3ee970aa6401cd": "E aluno?",
  "4a76d78455bf2b46211c43ef742a2ff801552581": "Estado Civil",
  "4e946bc71b745ffadfc43ed8fed0e00a2af214a9": "Arrematacoes proprias (acumuladas)",
  "52fbfbd6dfbbd3183702a1b9b39102da19c5d71c": "Conjuge",
  "686a845ab8fc9bba84b2a4fffde71f08e67cec5b": "Quantidade de Analise de Credito",
  "6d83d9c6eb6110f3d3b73d7faf1d53bfd0752636": "Endereco",
  "6dc02e816a01f49e5886dd794e8400febc1306fe": "Subsidio Bloqueado?",
  "71b730c40feff1529fd0f7e0b16dbed0ddc792af": "ID no Google Contacts",
  "72e63094e36da34458a99fbc183dad42f8e47323": "CPF/CNPJ",
  "7bd963a83c3032b37fd249a6a518ed73f121dade": "Data da Revisao do Subsidio",
  "a2fa922feceda3dfd7564e9976454da29b1aa387": "Arrematante",
  "a35dce5bda8df68467ad05dd6ab88a607d4d8653": "DZA | Aluno desde",
  "b5e100d169fedc79d407486cd123d8bce1bdf081": "Convive em uniao estavel?",
  "cc99df3d84a939b5c6f052bbcc181c81711af521": "Guara | Aluno desde?",
  "cd93eb310e50db2ad45f1cbecd3a7484021f2310": "UF",
  "d57e36ee4f91cc890f01eb6dc6b42fdd4ef3138e": "Pix Cliente",
  "e3a055b6ce7a2aa022b05f645f2bbf0671e4d7fb": "Profissao",
  "e78412c93213d4c98387632c957c3b7c6b146556": "Possui E-notariado/ICP?",
  "f2258a3722122fda7c8e044f856065f01ab0eadc": "E aluno (multiplo)",
  "fde2823f5602c83403d1954db9ce73eeffac5452": "Ultima sincronizacao: Portal do cliente"
};

const state = getSharedState_();

class ProxyHttpError extends Error {
  constructor(message, info, statusCode) {
    super(message);
    this.name = "ProxyHttpError";
    this.info = info || "proxy_error";
    this.statusCode = statusCode || 500;
  }
}

async function handleWebRequest(request) {
  const response = await handleProxyRequest({
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries())
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers
  });
}

async function handleNodeRequest(req, res) {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host || "127.0.0.1";
  const url = new URL(req.url || "/", protocol + "://" + host);
  const response = await handleProxyRequest({
    method: req.method,
    url: url.toString(),
    headers: req.headers
  });

  res.writeHead(response.status, response.headers);
  res.end(response.body);
}

async function handleProxyRequest(input) {
  const startedAt = Date.now();
  const method = String(input && input.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return {
      status: 204,
      body: "",
      headers: buildResponseHeaders_(startedAt, { cacheSeconds: 0 })
    };
  }

  try {
    const result = await dispatchProxyRequest_(input || {});
    return {
      status: result.status || 200,
      body: JSON.stringify(result.payload),
      headers: buildResponseHeaders_(startedAt, {
        cacheSeconds: result.cacheSeconds || 0,
        cacheTag: result.cacheTag || ""
      })
    };
  } catch (error) {
    const status = Number(error && error.statusCode) || 500;
    const info = String(error && error.info || "proxy_error");
    const message = String(error && error.message || error || "Proxy error.");
    const payload = {
      success: false,
      error: message,
      error_info: info,
      data: null,
      additional_data: null
    };

    return {
      status: status,
      body: JSON.stringify(payload),
      headers: buildResponseHeaders_(startedAt, { cacheSeconds: 0 })
    };
  }
}

async function dispatchProxyRequest_(input) {
  const req = normalizeProxyRequest_(input);

  if (!req.path || req.path === "/") {
    return {
      cacheSeconds: DEFAULT_CONFIG.cdnCacheTtlSeconds,
      payload: {
        success: true,
        data: {
          name: "Pipedrive Live Proxy API",
          mode: "readonly_live_upstream",
          data_source: "pipedrive_live",
          runtime: "vercel_node_fetch",
          routes: ROUTES,
          filters: FILTERS,
          auth: "Use ?api_token=SEU_TOKEN_DA_PROXY or Authorization: Bearer SEU_TOKEN_DA_PROXY"
        },
        additional_data: null
      }
    };
  }

  if (req.path === "/health") {
    return {
      cacheSeconds: 0,
      payload: {
        success: true,
        data: {
          status: "ok",
          runtime: "vercel_node_fetch",
          now: new Date().toISOString()
        },
        additional_data: null
      }
    };
  }

  // Rota nova do ChatApp (Triagem + direcionamento). Possui autenticacao propria
  // (CHATAPP_INTERNAL_TOKEN), por isso e tratada ANTES do assertAuthorized_ do proxy.
  if (req.path === "/api/chatapp/verificar-triagem-direcionamento") {
    const direcionamento = require("./chatapp-direcionamento.js");
    const result = await direcionamento.handleVerificarTriagem(
      { query: req.query, headers: req.headers },
      internalSearchDealsDirecionamento_
    );
    return { status: result.status || 200, cacheSeconds: 0, payload: result.payload };
  }

  // Rota do ChatApp (Triagem). Possui autenticacao propria (CHATAPP_INTERNAL_TOKEN),
  // por isso e tratada ANTES do assertAuthorized_ do proxy. Nao altera os demais
  // endpoints: apenas adiciona este path.
  if (req.path === "/api/chatapp/verificar-triagem") {
    const triagem = require("./chatapp-triagem.js");
    const result = await triagem.handleVerificarTriagem(
      { query: req.query, headers: req.headers },
      internalSearchDeals_
    );
    return { status: result.status || 200, cacheSeconds: 0, payload: result.payload };
  }

  assertAuthorized_(req);

  if (req.method !== "GET") {
    throw new ProxyHttpError("This proxy is readonly and accepts GET only.", "readonly_only", 405);
  }

  if (req.path === "/api/v2/deals/search") {
    return {
      cacheSeconds: DEFAULT_CONFIG.cdnCacheTtlSeconds,
      cacheTag: "pipedrive-deals-search",
      payload: await handleDealsSearch_(req)
    };
  }

  const filterDealsMatch = String(req.path || "").match(/^\/api\/v2\/deals\/filter\/(\d+)$/);
  if (filterDealsMatch) {
    return {
      cacheSeconds: DEFAULT_CONFIG.cdnCacheTtlSeconds,
      cacheTag: "pipedrive-deals-filter-" + filterDealsMatch[1],
      payload: await handleFilterDeals_(req, Number(filterDealsMatch[1]))
    };
  }

  const dealMatch = String(req.path || "").match(/^\/api\/v2\/deals\/(\d+)$/);
  if (dealMatch) {
    return {
      cacheSeconds: DEFAULT_CONFIG.cdnCacheTtlSeconds,
      cacheTag: "pipedrive-deal-detail",
      payload: await handleDealDetails_(req, Number(dealMatch[1]))
    };
  }

  if (!isAllowedReadonlyPath_(req.path)) {
    throw new ProxyHttpError("Unsupported GET route for the readonly proxy.", "unsupported_route", 404);
  }

  return {
    cacheSeconds: DEFAULT_CONFIG.cdnCacheTtlSeconds,
    cacheTag: "pipedrive-readonly-upstream",
    payload: await proxyReadonlyUpstreamGet_(req)
  };
}

function normalizeProxyRequest_(input) {
  const url = new URL(input.url || "/", "http://localhost");
  const query = {};

  for (const [key, value] of url.searchParams.entries()) {
    if (query[key] === undefined) query[key] = value;
  }

  const overrideMethod = String(query._method || query.method || input.method || "GET").trim().toUpperCase();
  let rawPath = String(query.path || query.endpoint || "").replace(/^https?:\/\/[^/]+/i, "");

  if (!rawPath) {
    rawPath = url.pathname || "/";
  }

  rawPath = rawPath.replace(/^\/exec(?=\/|$)/, "");
  if (rawPath === "/api/proxy") rawPath = "/";

  return {
    method: overrideMethod,
    path: normalizeApiPath_(rawPath),
    query: query,
    headers: normalizeHeaders_(input.headers || {})
  };
}

function normalizeApiPath_(rawPath) {
  const clean = String(rawPath || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\?.*$/, "");
  return clean ? "/" + clean : "/";
}

function normalizeHeaders_(headers) {
  const out = {};
  for (const key of Object.keys(headers || {})) {
    out[String(key).toLowerCase()] = String(headers[key] || "");
  }
  return out;
}

function assertAuthorized_(req) {
  const validTokens = readRequiredEnv_(DEFAULT_CONFIG.proxyTokenKey)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const incoming =
    String(req.query.api_token || "").trim() ||
    parseBearerToken_(req.headers.authorization) ||
    String(req.headers["x-api-token"] || "").trim();

  if (!incoming || !validTokens.includes(incoming)) {
    throw new ProxyHttpError("Unauthorized. Use the proxy api_token.", "unauthorized", 401);
  }
}

function parseBearerToken_(value) {
  const match = String(value || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function isAllowedReadonlyPath_(path) {
  const p = String(path || "");
  return (
    p === "/api/v2/deals" ||
    p === "/api/v2/deals/products" ||
    p === "/api/v2/persons" ||
    /^\/api\/v2\/persons\/\d+$/.test(p) ||
    p === "/api/v2/organizations" ||
    /^\/api\/v2\/organizations\/\d+$/.test(p) ||
    p === "/api/v2/pipelines" ||
    p === "/api/v2/stages" ||
    p === "/v1/users" ||
    p === "/v1/dealFields" ||
    p === "/v1/personFields"
  );
}

async function handleDealDetails_(req, dealId) {
  const deal = await getLiveDealById_(dealId);
  if (!deal) throw new ProxyHttpError("Deal not found.", "not_found", 404);

  const lookups = await buildLookups_();
  const shaped = shapeDealForApi_(deal, req.query || {});

  return {
    success: true,
    data: buildLeanDealPayload_(shaped, null, lookups),
    additional_data: null
  };
}

async function handleFilterDeals_(req, filterId) {
  const rawDeals = await fetchAllV2_("/deals", { filter_id: filterId, limit: DEFAULT_CONFIG.upstreamMaxLimit });
  const [lookups] = await Promise.all([buildLookups_()]);

  const enrichedDeals = await mapLimit_(rawDeals, DEFAULT_CONFIG.concurrency, async (rawDeal) => {
    const dealId = Number(rawDeal && rawDeal.id);
    if (!Number.isFinite(dealId)) return null;
    return getLiveDealById_(dealId);
  });

  const items = enrichedDeals
    .filter(Boolean)
    .map((deal) => buildFilterDealPayload_(deal, lookups));

  return {
    success: true,
    data: {
      filter_id: filterId,
      total: items.length,
      items: items
    },
    additional_data: null
  };
}

function buildFilterDealPayload_(deal, lookups) {
  const meta = (deal && deal.custom_fields_meta) ? deal.custom_fields_meta : {};

  function pickField(key) {
    const entry = meta[key];
    if (!entry) return null;
    // Use display_value (already has enum labels resolved) to avoid simplifyReadableValue_
    // stripping decimals from numeric fields (e.g. 0.4 → "4" via /^\d+\.\s*/ regex)
    const val = entry.display_value !== undefined ? entry.display_value : entry.raw_value;
    const lean = normalizeLeanValue_(val);
    return isBlankLeanValue_(lean) ? null : lean;
  }

  function pickWithDefault(key, defaultValue) {
    const v = pickField(key);
    return v == null ? defaultValue : v;
  }

  const stageName = (deal.stage_name || lookupName_(lookups && lookups.stages, deal.stage_id)) || null;

  return compactObject_({
    id: deal.id == null ? null : deal.id,
    titulo: deal.title || null,
    status: deal.status || null,
    motivo_da_perda: deal.lost_reason || null,
    criado_em: formatPipedriveDate_(deal.add_time),
    etapa: stageName,
    campos: compactObject_({
      // Campos existentes: mostrar "Não preenchido" quando ausentes
      "Estado": pickWithDefault(FILTER_21468_FIELD_KEYS.estado, "Não preenchido"),
      "Cidade": pickWithDefault(FILTER_21468_FIELD_KEYS.cidade, "Não preenchido"),
      "Número do Imóvel": pickWithDefault(FILTER_21468_FIELD_KEYS.numero_imovel, "Não preenchido"),
      "Link Google Drive": pickWithDefault(FILTER_21468_FIELD_KEYS.link_google_drive, "Não preenchido"),
      "Desconto % (Avaliação Smart x Pago)": pickWithDefault(FILTER_21468_FIELD_KEYS.desconto_smart_x_pago, "Não preenchido"),
      "Valor: Total da Proposta": (function() {
        const v = formatMonetary_(pickField(FILTER_21468_FIELD_KEYS.valor_total_proposta));
        return v == null ? "Não preenchido" : v;
      })(),
      "Valor médio estimado de venda": (function() {
        const v = formatMonetary_(pickField(FILTER_21468_FIELD_KEYS.valor_medio_estimado_venda));
        return v == null ? "Não preenchido" : v;
      })(),
      "Valor avaliação Caixa": (function() {
        const v = formatMonetary_(pickField(FILTER_21468_FIELD_KEYS.valor_avaliacao_caixa));
        return v == null ? "Não preenchido" : v;
      })(),

      // Campos novos (do anexo) — sempre presentes, com default "Não preenchido"
      "E-mail do Arrematante": pickWithDefault(FILTER_21468_FIELD_KEYS.email_arrematante, "Não preenchido"),
      "Telefone do Arrematante": pickWithDefault(FILTER_21468_FIELD_KEYS.telefone_arrematante, "Não preenchido"),
      "Atribuído: Análise Básica": pickWithDefault(FILTER_21468_FIELD_KEYS.atribuido_analise_basica, "Não preenchido"),
      "Status: Análise Básica": pickWithDefault(FILTER_21468_FIELD_KEYS.status_analise_basica, "Não preenchido"),
      "Atribuído: Análise Jurídica": pickWithDefault(FILTER_21468_FIELD_KEYS.atribuido_analise_juridica, "Não preenchido"),
      "Status: Analise Jurídica": pickWithDefault(FILTER_21468_FIELD_KEYS.status_analise_juridica, "Não preenchido"),
      "Atribuído: Análise de Mercado": pickWithDefault(FILTER_21468_FIELD_KEYS.atribuido_analise_mercado, "Não preenchido"),
      "Status: Analise de mercado": pickWithDefault(FILTER_21468_FIELD_KEYS.status_analise_mercado, "Não preenchido"),
      "Atribuído: Diligência - Pré Arrematação": pickWithDefault(FILTER_21468_FIELD_KEYS.atribuido_diligencia_pre_arrematacao, "Não preenchido"),
      "Status: Diligência - Pré Arrematação": pickWithDefault(FILTER_21468_FIELD_KEYS.status_diligencia_pre_arrematacao, "Não preenchido")
    })
  });
}

function formatPipedriveDate_(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!match) return String(value);
  const [, year, month, day, hour, min] = match;
  return day + "/" + month + "/" + year + " " + hour + ":" + min;
}

function formatMonetary_(value) {
  let amount = null;
  let currency = "BRL";

  if (value && typeof value === "object" && value.value !== undefined) {
    amount = Number(value.value);
    currency = String(value.currency || "BRL").toUpperCase();
  } else if (typeof value === "number") {
    amount = value;
  } else if (typeof value === "string" && value !== "") {
    amount = Number(value);
  }

  if (!Number.isFinite(amount)) return null;

  const cents = Math.round(Math.abs(amount) * 100);
  const isNegative = amount < 0;
  const intPart = Math.floor(cents / 100);
  const fracPart = cents % 100;

  let intStr = String(intPart);
  const groups = [];
  while (intStr.length > 3) {
    groups.unshift(intStr.slice(-3));
    intStr = intStr.slice(0, -3);
  }
  groups.unshift(intStr);
  const formatted = groups.join(".");
  const result = fracPart > 0 ? formatted + "," + String(fracPart).padStart(2, "0") : formatted;
  const sign = isNegative ? "-" : "";

  if (currency === "BRL") return sign + "R$ " + result;
  if (currency === "USD") return sign + "US$ " + result;
  if (currency === "EUR") return sign + "€ " + result;
  return sign + result + " " + currency;
}

// Busca interna ENXUTA e FRESCA usada pela rota do ChatApp. Diferente de
// handleDealsSearch_, NAO aciona a varredura de property_code nem o enriquecimento de
// pessoa. Recebe TODOS os termos (variantes de telefone), busca em paralelo, junta os
// IDs candidatos unicos e busca cada deal UMA UNICA vez.
//
// As leituras de dados do deal/busca sao FRESCAS (sem cache de TTL): a decisao de
// Triagem precisa refletir o Pipedrive em tempo real. Apenas os METADADOS (mapa de
// stages e opcoes de campos) seguem cacheados por 6h, pois quase nunca mudam.
async function internalSearchDeals_(termos) {
  const lista = Array.isArray(termos) ? termos : [termos];
  const idLists = await Promise.all(lista.map(searchDealIdsByTerm_));
  const ids = uniqueNumbers_(idLists.flat());
  const deals = await mapLimit_(ids, DEFAULT_CONFIG.concurrency, getLeanDealForTriagem_);
  return deals.filter(Boolean);
}

async function internalSearchDealsDirecionamento_(termos) {
  const deals = await internalSearchDeals_(termos);
  if (!deals.length) return deals;

  const lookups = await buildLookups_();
  for (const deal of deals) {
    if (!deal || deal.owner_name || deal.owner_id == null) continue;
    deal.owner_name = lookupName_(lookups && lookups.users, deal.owner_id);
  }
  return deals;
}

// Busca (fresca) os IDs de deals candidatos para um termo de telefone.
async function searchDealIdsByTerm_(term) {
  const json = await pipedriveGetV2_("/deals/search", {
    term: term,
    fields: "custom_fields",
    exact_match: false,
    limit: 50
  });
  const items = json && json.data && Array.isArray(json.data.items) ? json.data.items : [];
  const ids = [];
  for (const result of items) {
    const id = Number(result && result.item && result.item.id);
    if (Number.isFinite(id)) ids.push(id);
  }
  return ids;
}

// Campos usados para montar o "status" da Triagem (Pos arrematacao). Os enums tem como
// valor bruto o id da opcao; o label e resolvido pelos MAPs hardcoded TRIAGEM_STATUS_*.
const TRIAGEM_FIELD_KEYS = {
  forma_pagamento: "ead65a1f666494607bbbf807aaff5b1123b893df",       // enum (option 34 = Financiado / FGTS Financiado)
  valor_fgts: "86bec432c1957a057a3bd2b67f5ed33405b1ef0d",            // monetary { value, currency }
  status_financiamento: "888498f1de2185bbf6259cee93c859bf3088ff00",  // enum "Status: Financiamento"
  status_fgts_financiado: "bfeb03a756ac605d07182215e98c6ae0afc9fd33" // enum "Status: FGTS Financiado"
};

// Campos usados pela nova rota do ChatApp com direcionamento.
// Fonte: /home/davivieira/Downloads/data_fields_2026-07-01.xls.
const CHATAPP_DIRECIONAMENTO_FIELD_KEYS = {
  telefone_arrematante: "534ddc592e7b7db4b6d6faff0d07f2071684039e",
  atribuido_financiamento: "8b0781e1587ea24eb1a127c00648e2926412da25",
  atribuido_documentacao_pendente: "5f851f60e8a3db3085d13395154f8ff552a83c09",
  atribuido_analise_credito: "69fa3118e5a8ae5032e8f50b9f9f4fb99fc305b9"
};

// Mapa hardcoded stage_id -> nome da etapa, por funil. Usado no fluxo da Triagem para
// resolver o nome da etapa SEM bater na API do Pipedrive (/stages). Se surgir uma etapa
// nova no Pipedrive, incluir aqui. Fonte: /api/v2/stages (smartleiloes), jul/2026.
const TRIAGEM_STAGE_NAMES = {
  // Funil 5 - PRÉ ARREMATAÇÃO
  "49": "Chegada do Imóvel",
  "135": "Enviar Msg Boas Vindas",
  "133": "Msg Boas Vindas (Enviada)",
  "105": "E-mail de boas vindas (Enviado)",
  "51": "Iniciar Análise Básica",
  "104": "Análise Básica Concluída",
  "77": "Decisão de Compra",
  "99": "Boleto Pago",
  // Funil 6 - PÓS ARREMATAÇÃO
  "136": "Triagem",
  "56": "1. Contrato | ITBI",
  "57": "2. Protocolar Registro",
  "58": "3. Registro em Andamento",
  "74": "4. Registrado. Titularidade em andamento",
  "75": "5. Registrado. Pendente Debitos.",
  "123": "6. Cliente não retorna",
  "132": "7. Cancelamento de Proposta",
  // Funil 16 - ANÁLISE DE CRÉDITO
  "137": "Iniciar Triagem",
  "145": "Triagem em Andamento",
  "139": "Documentação Pendente",
  "144": "Triagem Incompleta",
  "140": "Iniciar Análise de Crédito",
  "141": "Análise em Andamento",
  "142": "Pendência na Análise",
  "143": "Análise Finalizada"
};

// Resolve o nome da etapa a partir do stage_id usando o MAP hardcoded (sem API).
function nomeEtapaTriagem_(stageId) {
  if (stageId == null) return "";
  return TRIAGEM_STAGE_NAMES[String(stageId)] || "";
}

// Extrai o id da opcao de um valor de campo enum (numero, string, array ou objeto).
function extractOptionId_(rawValue) {
  if (rawValue == null || rawValue === "") return "";
  let id = Array.isArray(rawValue) ? (rawValue.length ? rawValue[0] : null) : rawValue;
  if (id && typeof id === "object") id = id.id != null ? id.id : (id.value != null ? id.value : null);
  return id == null ? "" : String(id);
}

function extractEntityId_(rawValue) {
  if (rawValue == null || rawValue === "") return null;
  if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
    const id = rawValue.id != null ? rawValue.id : rawValue.value;
    return id == null || id === "" ? null : id;
  }
  return rawValue;
}

function extractEntityName_(rawValue) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return "";
  if (rawValue.name != null) return String(rawValue.name || "");
  if (rawValue.label != null) return String(rawValue.label || "");
  return "";
}

function labelCustomOption_(rawValue, optionLabels) {
  if (rawValue == null || rawValue === "") return "";
  if (Array.isArray(rawValue)) return rawValue.map((item) => labelCustomOption_(item, optionLabels)).filter(Boolean).join(", ");
  if (rawValue && typeof rawValue === "object") {
    if (rawValue.label != null) return String(rawValue.label || "");
    if (rawValue.name != null) return String(rawValue.name || "");
  }

  const id = extractOptionId_(rawValue);
  if (id && optionLabels && optionLabels[String(id)] !== undefined) return String(optionLabels[String(id)] || "");
  return rawValue == null ? "" : String(rawValue);
}

// Mapas hardcoded option_id -> label das opcoes dos campos enum "Status: Financiamento" e
// "Status: FGTS Financiado", usados no fluxo da Triagem para resolver o Status SEM bater na
// API (/dealFields). Se surgir/renomear uma opcao no Pipedrive, atualizar aqui.
// Fonte: exportacao data_fields_options (smartleiloes), jul/2026.
const TRIAGEM_STATUS_FINANCIAMENTO_LABELS = {
  "2797": "01. Iniciar",
  "2704": "02. Solicitar Boleto/Comprovante ou Tela DCS",
  "2675": "03. Conferir Documentos + Emitir Matrícula",
  "2705": "04. Aprovar Crédito",
  "2676": "05. Adequar Aprovação + Abrir CC",
  "2677": "06. Preencher Formulários",
  "2678": "07. Assinar Formulários",
  "2679": "08. Vincular o imóvel + laudo",
  "2680": "09. Preencher SIOPI + Agendar Entrevista",
  "2681": "10. Preencher SICTD",
  "2682": "11. Aguardando Conformidade",
  "2683": "12. Sanando a Incoformidade",
  "2684": "13. Solicitar / Conferir Minuta",
  "2685": "14. Assinar Contrato",
  "2746": "15. Nota Devolutiva",
  "2798": "16. Cancelamento de Proposta",
  "2807": "17.  Solicitar Baixa de Garantia",
  "2686": "18. Finalizado",
  "2799": "19. n/a"
};

const TRIAGEM_STATUS_FGTS_FINANCIADO_LABELS = {
  "2800": "01. Iniciar",
  "2702": "02. Solicitar Boleto/Comprovante ou Tela DCS",
  "2687": "03. Conferir Documentos + Emitir Matrícula",
  "2703": "04. Aprovar Crédito",
  "2688": "05. Adequar Aprovação + Abrir CC",
  "2689": "06. Autorizar FGTS + Vincular o Imóvel",
  "2690": "07. Resgatar do FGTS + Preencher Formulários",
  "2691": "08. Assinar Formulários",
  "2692": "09. Preencher SIOPI + Agendar Entrevista",
  "2693": "10. Preencher SICTD",
  "2694": "11. Aguardando Conformidade",
  "2695": "12. Sanando a Incoformidade",
  "2696": "13. Solicitar / Conferir Minuta",
  "2697": "14. Assinar Contrato",
  "2745": "15. Nota Devolutiva",
  "2801": "16. Cancelamento de Proposta",
  "2808": "17.  Solicitar Baixa de Garantia",
  "2698": "18. Finalizado",
  "2802": "19. n/a"
};

const CHATAPP_DIRECIONAMENTO_OPTION_LABELS = {
  atribuido_financiamento: {
    "2699": "Jessica Francklin",
    "2700": "Ana Souza",
    "2707": "Daniela Silva",
    "2709": "Isadora Campos",
    "2793": "Dimitri Garcia",
    "2804": "Marloon Santos",
    "2810": "n/a"
  },
  atribuido_documentacao_pendente: {
    "2780": "Isaque Coelho",
    "2823": "Isadora Campos"
  },
  atribuido_analise_credito: {
    "2659": "Thales Gabriel",
    "2805": "Daniela Silva"
  }
};

// Resolve o label de um campo enum pelo option_id usando um MAP hardcoded (sem API).
function labelStatusTriagem_(rawValue, mapa) {
  const id = extractOptionId_(rawValue);
  if (!id) return "";
  return mapa[String(id)] || "";
}

// Valor numerico de um campo monetary do Pipedrive ({ value, currency } | number | string).
function extractMonetaryNumber_(rawValue) {
  if (rawValue == null || rawValue === "") return 0;
  if (typeof rawValue === "object") {
    const n = Number(rawValue.value);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(rawValue);
  return Number.isFinite(n) ? n : 0;
}

// Detalhe minimo e FRESCO do deal para a Triagem. Sem cache de TTL nos dados (o detalhe
// e lido direto do upstream a cada chamada) e sem buscar pessoa vinculada. NENHUMA chamada
// a metadados: a etapa e resolvida pelo MAP TRIAGEM_STAGE_NAMES e os Status de Financiamento
// / FGTS Financiado pelos MAPs hardcoded (sem /stages nem /dealFields). Le telefone pelo hash.
async function getLeanDealForTriagem_(dealId) {
  const json = await pipedriveGetV2_("/deals/" + Number(dealId), {}); // fresco, sem cache de TTL

  const d = json && json.data ? json.data : null;
  if (!d) return null;

  const cf = d.custom_fields && typeof d.custom_fields === "object" && !Array.isArray(d.custom_fields)
    ? d.custom_fields
    : {};
  const pipelineId = d.pipeline_id != null ? d.pipeline_id : (d.pipeline && d.pipeline.id);
  const stageId = d.stage_id != null ? d.stage_id : (d.stage && d.stage.id);
  const ownerSource = d.owner_id !== undefined ? d.owner_id : d.owner;
  const financiamentoRaw = cf[CHATAPP_DIRECIONAMENTO_FIELD_KEYS.atribuido_financiamento];
  const documentacaoPendenteRaw = cf[CHATAPP_DIRECIONAMENTO_FIELD_KEYS.atribuido_documentacao_pendente];
  const analiseCreditoRaw = cf[CHATAPP_DIRECIONAMENTO_FIELD_KEYS.atribuido_analise_credito];

  return {
    id: d.id,
    title: d.title || "",
    status: d.status || "", // status do ciclo de vida (open/won/lost)
    owner_id: extractEntityId_(ownerSource),
    owner_name: d.owner_name || extractEntityName_(ownerSource),
    pipeline: { id: pipelineId == null ? null : pipelineId },
    stage: { id: stageId == null ? null : stageId },
    etapa: nomeEtapaTriagem_(stageId), // nome resolvido pelo MAP hardcoded (sem API)
    // Dados para montar o "status" da Triagem (decisao fica no modulo chatapp-triagem).
    // Labels resolvidos pelos MAPs hardcoded (sem API):
    forma_pagamento_id: extractOptionId_(cf[TRIAGEM_FIELD_KEYS.forma_pagamento]),
    valor_fgts: extractMonetaryNumber_(cf[TRIAGEM_FIELD_KEYS.valor_fgts]),
    status_financiamento: labelStatusTriagem_(cf[TRIAGEM_FIELD_KEYS.status_financiamento], TRIAGEM_STATUS_FINANCIAMENTO_LABELS),
    status_fgts_financiado: labelStatusTriagem_(cf[TRIAGEM_FIELD_KEYS.status_fgts_financiado], TRIAGEM_STATUS_FGTS_FINANCIADO_LABELS),
    atribuido_financiamento_id: extractOptionId_(financiamentoRaw),
    atribuido_financiamento: labelCustomOption_(financiamentoRaw, CHATAPP_DIRECIONAMENTO_OPTION_LABELS.atribuido_financiamento),
    atribuido_financiamento_raw: financiamentoRaw,
    atribuido_documentacao_pendente_id: extractOptionId_(documentacaoPendenteRaw),
    atribuido_documentacao_pendente: labelCustomOption_(documentacaoPendenteRaw, CHATAPP_DIRECIONAMENTO_OPTION_LABELS.atribuido_documentacao_pendente),
    atribuido_documentacao_pendente_raw: documentacaoPendenteRaw,
    atribuido_analise_credito_id: extractOptionId_(analiseCreditoRaw),
    atribuido_analise_credito: labelCustomOption_(analiseCreditoRaw, CHATAPP_DIRECIONAMENTO_OPTION_LABELS.atribuido_analise_credito),
    atribuido_analise_credito_raw: analiseCreditoRaw,
    fields: { "Telefone do Arrematante": cf[CHATAPP_DIRECIONAMENTO_FIELD_KEYS.telefone_arrematante] }
  };
}

async function handleDealsSearch_(req) {
  const query = (req && req.query) || {};
  const compositeCriteria = extractCompositeSearchCriteria_(query);
  if (compositeCriteria.length >= 2) {
    return handleCompositeDealSearch_(req, compositeCriteria);
  }

  if (shouldRejectInvalidIdentitySearch_(query)) {
    return buildEmptyDealsSearchResponse_(query);
  }

  if (shouldUseIdentityDealSearch_(query)) {
    return handleIdentityDealSearch_(req);
  }
  if (shouldUsePropertyCodeDealSearch_(query)) {
    return handlePropertyCodeDealSearch_(req);
  }
  return handleUpstreamDealsSearchWithEnrichment_(req);
}

function shouldRejectInvalidIdentitySearch_(query) {
  if (!isTruthyQueryBoolean_(query && query.exact_match)) return false;
  const term = String(query && query.term || "").trim();
  if (!term) return false;

  const requested = normalizeRequestedSearchBy_(query && query.search_by);
  return isIdentityRequestedSearchBy_(requested) && !normalizeIdentitySearchTerm_(requested, term);
}

function buildEmptyDealsSearchResponse_(query) {
  return {
    success: true,
    data: {
      items: [],
      search_trace: buildSearchTrace_(query || {}, false)
    },
    additional_data: {
      next_cursor: null
    }
  };
}

function shouldUseIdentityDealSearch_(query) {
  if (!isTruthyQueryBoolean_(query && query.exact_match)) return false;
  const term = String(query && query.term || "").trim();
  if (!term) return false;

  const requested = normalizeRequestedSearchBy_(query && query.search_by);
  if (isIdentityRequestedSearchBy_(requested)) {
    return !!normalizeIdentitySearchTerm_(requested, term);
  }

  if (requested === "property_code") return false;

  return !!(
    normalizeIdentitySearchTerm_("email", term) ||
    normalizeIdentitySearchTerm_("cpf", term) ||
    normalizeIdentitySearchTerm_("cnpj", term)
  );
}

function shouldUsePropertyCodeDealSearch_(query) {
  if (!isTruthyQueryBoolean_(query && query.exact_match)) return false;
  const term = String(query && query.term || "").trim();
  if (!term) return false;

  const requested = normalizeRequestedSearchBy_(query && query.search_by);
  if (requested && requested !== "property_code") return false;
  return !!normalizeSearchTermForTrace_("property_code", term);
}

async function handlePropertyCodeDealSearch_(req) {
  const query = (req && req.query) || {};
  const propertyCode = normalizeSearchTermForTrace_("property_code", query.term);
  const directPromise = fetchDirectDealSearchCandidates_(query);
  const exactPromise = fetchPropertyCodeDealCandidates_(propertyCode, query);
  const [directResults, exactResults] = await Promise.all([directPromise, exactPromise]);
  const merged = mergeDealSearchCandidates_(directResults, exactResults);
  const page = paginateCollection_(merged, query);
  const lookups = await buildLookups_();

  const items = page.items.map((candidate) => {
    const shaped = shapeDealForApi_(candidate.deal, query);
    const searchItem = candidate.searchItem || buildSearchItemFromDeal_(shaped);
    const searchTrace = buildSearchTrace_(query, true);

    return compactObject_({
      result_score: candidate.resultScore,
      deal: buildLeanDealPayload_(shaped, searchItem, lookups),
      matched_by: searchTrace.matched_by,
      search_term_normalized: searchTrace.search_term_normalized,
      correlation_found: searchTrace.correlation_found
    });
  });

  return {
    success: true,
    data: {
      items: items,
      search_trace: buildSearchTrace_(query, !!merged.length)
    },
    additional_data: {
      next_cursor: page.pagination.next_cursor
    }
  };
}

async function handleUpstreamDealsSearchWithEnrichment_(req) {
  const query = buildUpstreamQueryParams_(req.query || {});
  const [searchJson, lookups] = await Promise.all([
    fetchReadonlyUpstreamJson_("/api/v2/deals/search", query),
    buildLookups_()
  ]);
  const items = searchJson && searchJson.data && Array.isArray(searchJson.data.items)
    ? searchJson.data.items
    : [];

  if (!items.length) {
    return attachSearchTraceToSearchJson_(searchJson, req.query || {}, false);
  }

  const enrichedItems = await mapLimit_(items, DEFAULT_CONFIG.concurrency, async (result) => {
    const originalItem = result && result.item ? result.item : null;
    const dealId = Number(originalItem && originalItem.id);
    if (!Number.isFinite(dealId)) return null;

    const deal = await getLiveDealById_(dealId);
    if (!deal) return null;

    const shaped = shapeDealForApi_(deal, req.query || {});
    const searchItem = mergeSearchItem_(buildSearchItemFromDeal_(shaped), originalItem);
    const searchTrace = buildSearchTrace_(req.query || {}, true);

    return compactObject_({
      result_score: result && result.result_score != null ? Number(result.result_score) : undefined,
      deal: buildLeanDealPayload_(shaped, searchItem, lookups),
      matched_by: searchTrace.matched_by,
      search_term_normalized: searchTrace.search_term_normalized,
      correlation_found: searchTrace.correlation_found
    });
  });

  const filteredItems = enrichedItems.filter(Boolean);
  return {
    success: searchJson && searchJson.success !== false,
    data: Object.assign({}, searchJson.data || {}, {
      items: filteredItems,
      search_trace: buildSearchTrace_(req.query || {}, !!filteredItems.length)
    }),
    additional_data: searchJson && searchJson.additional_data !== undefined ? searchJson.additional_data : null
  };
}

async function handleIdentityDealSearch_(req) {
  const query = (req && req.query) || {};
  const term = String(query.term || "").trim();
  const kinds = resolveIdentitySearchKinds_(term, query.search_by);
  if (!kinds.length) return handleUpstreamDealsSearchWithEnrichment_(req);
  const criteria = kinds
    .map((kind) => ({ kind: kind, value: normalizeIdentitySearchTerm_(kind, term) }))
    .filter((criterion) => criterion.kind && criterion.value);

  const directPromise = fetchDirectDealSearchCandidates_(query);
  const personIdsPromise = Promise.all(kinds.map((kind) => findPersonIdsByIdentitySearch_(kind, term)));
  const [rawDirectResults, personIdLists] = await Promise.all([directPromise, personIdsPromise]);
  const personIds = uniqueNumbers_(personIdLists.flat());
  const rawPersonDeals = await fetchDealsByPersonIds_(personIds, query);
  const directResults = filterCandidatesByIdentityCriteria_(rawDirectResults, criteria);
  const personDeals = filterCandidatesByIdentityCriteria_(rawPersonDeals, criteria);
  const merged = mergeIdentitySearchCandidates_(directResults, personDeals);
  const page = paginateCollection_(merged, query);
  const lookups = await buildLookups_();

  const items = page.items.map((candidate) => {
    const shaped = shapeDealForApi_(candidate.deal, query);
    const searchItem = candidate.searchItem || buildSearchItemFromDeal_(shaped);
    const searchTrace = buildSearchTrace_(query, true);

    return compactObject_({
      result_score: candidate.resultScore,
      deal: buildLeanDealPayload_(shaped, searchItem, lookups),
      matched_by: searchTrace.matched_by,
      search_term_normalized: searchTrace.search_term_normalized,
      correlation_found: searchTrace.correlation_found
    });
  });

  return {
    success: true,
    data: {
      items: items,
      search_trace: buildSearchTrace_(query, !!merged.length)
    },
    additional_data: {
      next_cursor: page.pagination.next_cursor
    }
  };
}

async function handleCompositeDealSearch_(req, criteria) {
  const query = (req && req.query) || {};
  const candidateLists = await Promise.all(criteria.map((criterion) => fetchCandidatesForCriterion_(criterion, query)));
  const merged = intersectCandidateLists_(candidateLists);
  const page = paginateCollection_(merged, query);
  const lookups = await buildLookups_();
  const trace = buildCompositeSearchTrace_(criteria, !!merged.length);

  const items = page.items.map((candidate) => {
    const shaped = shapeDealForApi_(candidate.deal, query);
    const searchItem = candidate.searchItem || buildSearchItemFromDeal_(shaped);
    return compactObject_({
      result_score: candidate.resultScore,
      deal: buildLeanDealPayload_(shaped, searchItem, lookups),
      matched_by: trace.matched_by,
      search_term_normalized: trace.search_term_normalized,
      correlation_found: trace.correlation_found
    });
  });

  return {
    success: true,
    data: {
      items: items,
      search_trace: trace
    },
    additional_data: {
      next_cursor: page.pagination.next_cursor
    }
  };
}

async function fetchCandidatesForCriterion_(criterion, query) {
  const baseQuery = Object.assign({}, query || {}, {
    term: criterion.value,
    exact_match: true,
    fields: "custom_fields,title",
    limit: DEFAULT_CONFIG.upstreamMaxLimit
  });
  delete baseQuery.cursor;
  delete baseQuery.property_code;
  delete baseQuery.email;
  delete baseQuery.cpf;
  delete baseQuery.cnpj;
  delete baseQuery.document;
  delete baseQuery.documento;

  if (criterion.kind === "property_code") {
    const [directResults, exactResults] = await Promise.all([
      fetchDirectDealSearchCandidates_(baseQuery),
      fetchPropertyCodeDealCandidates_(criterion.value, baseQuery)
    ]);
    return mergeDealSearchCandidates_(directResults, exactResults)
      .filter((candidate) => candidate && dealMatchesCriterion_(candidate.deal, criterion));
  }

  const directPromise = fetchDirectDealSearchCandidates_(baseQuery);
  const personIdsPromise = isIdentityRequestedSearchBy_(criterion.kind)
    ? findPersonIdsByIdentitySearch_(criterion.kind, criterion.value)
    : Promise.resolve([]);
  const [directResults, personIds] = await Promise.all([directPromise, personIdsPromise]);
  const personDeals = await fetchDealsByPersonIds_(personIds, baseQuery);
  const merged = mergeIdentitySearchCandidates_(directResults, personDeals);
  return merged.filter((candidate) => candidateMatchesCriterion_(candidate, criterion));
}

function intersectCandidateLists_(candidateLists) {
  const lists = (candidateLists || []).filter((list) => Array.isArray(list));
  if (!lists.length) return [];

  const byId = new Map();
  for (const candidate of lists[0]) {
    if (!candidate || candidate.dealId == null) continue;
    byId.set(String(candidate.dealId), Object.assign({}, candidate, { matchedCriteriaCount: 1 }));
  }

  for (let i = 1; i < lists.length; i++) {
    const current = new Map();
    for (const candidate of lists[i]) {
      if (!candidate || candidate.dealId == null) continue;
      current.set(String(candidate.dealId), candidate);
    }

    for (const key of Array.from(byId.keys())) {
      const existing = byId.get(key);
      const next = current.get(key);
      if (!next) {
        byId.delete(key);
        continue;
      }

      existing.matchedCriteriaCount += 1;
      existing.resultScore = Math.max(Number(existing.resultScore || 0), Number(next.resultScore || 0));
      if (!existing.searchItem && next.searchItem) existing.searchItem = next.searchItem;
      if (!existing.deal && next.deal) existing.deal = next.deal;
    }
  }

  return Array.from(byId.values()).sort(compareIdentityCandidates_);
}

async function fetchDirectDealSearchCandidates_(query) {
  const upstream = buildUpstreamQueryParams_(query || {});
  delete upstream.cursor;
  upstream.limit = DEFAULT_CONFIG.upstreamMaxLimit;

  const json = await fetchReadonlyUpstreamJson_("/api/v2/deals/search", upstream);
  const items = json && json.data && Array.isArray(json.data.items) ? json.data.items : [];

  return mapLimit_(items, DEFAULT_CONFIG.concurrency, async (result) => {
    const originalItem = result && result.item ? result.item : null;
    const dealId = Number(originalItem && originalItem.id);
    if (!Number.isFinite(dealId)) return null;

    const deal = await getLiveDealById_(dealId);
    if (!deal) return null;

    return {
      dealId: dealId,
      deal: deal,
      searchItem: mergeSearchItem_(buildSearchItemFromDeal_(deal), originalItem),
      resultScore: result && result.result_score != null ? Number(result.result_score) : 1
    };
  }).then((values) => values.filter(Boolean));
}

async function fetchPropertyCodeDealCandidates_(propertyCode, query) {
  const expected = normalizeSearchTermForTrace_("property_code", propertyCode);
  if (!expected) return [];

  const fieldKeys = await getPropertyCodeFieldKeys_();
  const statuses = resolveDealStatusesForPropertyCodeScan_(query);
  const nested = await mapLimit_(statuses, Math.min(DEFAULT_CONFIG.concurrency, 3), async (status) => {
    return fetchPropertyCodeDealsForStatus_(expected, status, fieldKeys, query);
  });

  return nested.flat().filter(Boolean);
}

async function fetchPropertyCodeDealsForStatus_(propertyCode, status, fieldKeys, query) {
  const base = {
    status: status,
    limit: DEFAULT_CONFIG.upstreamMaxLimit,
    custom_fields: fieldKeys.join(",")
  };
  copyIfPresent_(query || {}, base, "owner_id");
  copyIfPresent_(query || {}, base, "pipeline_id");
  copyIfPresent_(query || {}, base, "stage_id");
  copyIfPresent_(query || {}, base, "updated_since");
  copyIfPresent_(query || {}, base, "updated_until");
  copyIfPresent_(query || {}, base, "sort_by");
  copyIfPresent_(query || {}, base, "sort_direction");

  const matches = [];
  let cursor = "";
  let pages = 0;

  while (pages < DEFAULT_CONFIG.propertyCodeScanMaxPages) {
    pages++;
    const json = await fetchReadonlyUpstreamJson_("/api/v2/deals", Object.assign({}, base, {
      cursor: cursor || undefined
    }));
    const deals = json && Array.isArray(json.data) ? json.data : [];

    for (const rawDeal of deals) {
      if (!rawDealHasPropertyCode_(rawDeal, fieldKeys, propertyCode)) continue;
      const deal = await getLiveDealById_(Number(rawDeal.id));
      if (!deal || deal.id == null) continue;
      matches.push({
        dealId: Number(deal.id),
        deal: deal,
        searchItem: buildSearchItemFromDeal_(deal),
        resultScore: 1
      });
    }

    cursor = getNextCursor_(json);
    if (!cursor) break;
  }

  return matches;
}

async function getPropertyCodeFieldKeys_() {
  const keys = PROPERTY_CODE_FIELD_FALLBACK_KEYS.slice();
  const maps = await getDealFieldMaps_();
  const byName = maps && maps.byName ? maps.byName : {};

  for (const name of Object.keys(byName)) {
    const normalized = toAsciiLower_(name);
    if (normalized !== "numero do imovel" && normalized !== "codigo do imovel") continue;
    const key = byName[name] && byName[name].key ? String(byName[name].key) : "";
    if (key && keys.indexOf(key) === -1) keys.push(key);
  }

  return keys;
}

function resolveDealStatusesForPropertyCodeScan_(query) {
  const requested = String(query && query.status || "").trim().toLowerCase();
  if (requested === "open" || requested === "won" || requested === "lost" || requested === "deleted") {
    return [requested];
  }
  return ["open", "won", "lost"];
}

function rawDealHasPropertyCode_(deal, fieldKeys, propertyCode) {
  const customFields = deal && deal.custom_fields && typeof deal.custom_fields === "object" && !Array.isArray(deal.custom_fields)
    ? deal.custom_fields
    : {};
  for (const key of fieldKeys || []) {
    if (String(customFields[key] == null ? "" : customFields[key]).trim() === propertyCode) return true;
  }
  return String(extractPropertyCode_(deal) || "").trim() === propertyCode;
}

function mergeDealSearchCandidates_(primaryResults, secondaryResults) {
  const byId = {};
  const order = [];
  for (const list of [primaryResults || [], secondaryResults || []]) {
    for (const candidate of list) {
      if (!candidate || candidate.dealId == null || !candidate.deal) continue;
      const key = String(candidate.dealId);
      const existing = byId[key];
      if (!existing) {
        byId[key] = candidate;
        order.push(key);
        continue;
      }
      if ((candidate.resultScore || 0) > (existing.resultScore || 0)) existing.resultScore = candidate.resultScore;
      if (!existing.searchItem && candidate.searchItem) existing.searchItem = candidate.searchItem;
      if (!existing.deal && candidate.deal) existing.deal = candidate.deal;
    }
  }
  return order.map((key) => byId[key]);
}

function resolveIdentitySearchKinds_(term, requestedSearchBy) {
  const requested = normalizeRequestedSearchBy_(requestedSearchBy);
  const trimmed = String(term || "").trim();

  if (requested === "cpf" && normalizeIdentitySearchTerm_("cpf", trimmed)) return ["cpf"];
  if (requested === "cnpj" && normalizeIdentitySearchTerm_("cnpj", trimmed)) return ["cnpj"];
  if (requested === "email" && normalizeIdentitySearchTerm_("email", trimmed)) return ["email"];
  if (requested === "property_code") return [];

  const out = [];
  if (normalizeIdentitySearchTerm_("email", trimmed)) out.push("email");
  if (normalizeIdentitySearchTerm_("cnpj", trimmed)) out.push("cnpj");
  else if (normalizeIdentitySearchTerm_("cpf", trimmed)) out.push("cpf");
  return out;
}

function normalizeRequestedSearchBy_(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "cpf" || text === "cnpj" || text === "email" || text === "property_code") return text;
  return "";
}

function isIdentityRequestedSearchBy_(value) {
  return value === "cpf" || value === "cnpj" || value === "email";
}

function normalizeIdentitySearchTerm_(kind, value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";

  if (kind === "cpf") {
    return normalizeStrictCpfTerm_(text);
  }

  if (kind === "cnpj") {
    return normalizeStrictCnpjTerm_(text);
  }

  if (kind === "email") {
    const normalized = text.toLowerCase();
    return /^[^\s@<>]+@[^\s@<>]+$/.test(normalized) ? normalized : "";
  }

  return "";
}

function extractCompositeSearchCriteria_(query) {
  const q = query || {};
  const out = [];
  const propertyCode = normalizeSearchTermForTrace_("property_code", q.property_code || q.codigo_imovel || q.codigo_do_imovel);
  const email = normalizeIdentitySearchTerm_("email", q.email);
  const cpf = normalizeIdentitySearchTerm_("cpf", q.cpf);
  const cnpj = normalizeIdentitySearchTerm_("cnpj", q.cnpj);
  const documentValue = String(q.document || q.documento || "").trim();
  const documentKind = detectDocumentKindFromTerm_(documentValue);

  if (propertyCode) out.push({ kind: "property_code", value: propertyCode });
  if (email) out.push({ kind: "email", value: email });
  if (cpf) out.push({ kind: "cpf", value: cpf });
  if (cnpj) out.push({ kind: "cnpj", value: cnpj });
  if (documentKind) out.push({ kind: documentKind, value: extractDigits_(documentValue) });

  return dedupeCriteria_(out);
}

function dedupeCriteria_(criteria) {
  const seen = new Set();
  const out = [];
  for (const item of criteria || []) {
    const key = String(item.kind || "") + ":" + String(item.value || "");
    if (!item.kind || !item.value || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildCompositeSearchTrace_(criteria, correlationFound) {
  return {
    matched_by: (criteria || []).map((item) => item.kind).join("+"),
    search_term_normalized: (criteria || []).reduce((acc, item) => {
      acc[item.kind] = item.value;
      return acc;
    }, {}),
    correlation_found: !!correlationFound
  };
}

function dealMatchesCriterion_(deal, criterion) {
  if (!deal || !criterion) return false;
  const kind = String(criterion.kind || "");
  const expected = String(criterion.value || "").trim();
  if (!kind || !expected) return false;

  if (kind === "property_code") {
    return String(extractPropertyCode_(deal) || "").trim() === expected;
  }

  if (kind === "email") {
    const expectedEmail = expected.toLowerCase();
    return listIdentityValuesFromDeal_(deal, kind).some((value) => extractEmails_(value).includes(expectedEmail));
  }

  if (kind === "cpf" || kind === "cnpj") {
    return listIdentityValuesFromDeal_(deal, kind).some((value) => containsExactDocumentValue_(value, expected));
  }

  return false;
}

function filterCandidatesByIdentityCriteria_(candidates, criteria) {
  const activeCriteria = (criteria || []).filter((criterion) => {
    const kind = String(criterion && criterion.kind || "");
    return isIdentityRequestedSearchBy_(kind) && criterion.value;
  });
  if (!activeCriteria.length) return [];

  return (candidates || []).filter((candidate) => {
    return activeCriteria.every((criterion) => candidateMatchesCriterion_(candidate, criterion));
  });
}

function candidateMatchesCriterion_(candidate, criterion) {
  if (!candidate || !criterion) return false;
  if (dealMatchesCriterion_(candidate.deal, criterion)) return true;

  const kind = String(criterion.kind || "");
  const expected = String(criterion.value || "").trim();
  if (isIdentityRequestedSearchBy_(kind)) return false;

  if (kind === "property_code") {
    const values = [];
    collectFlatValues_(candidate.searchItem, values);
    return values.some((value) => String(value || "").trim() === expected);
  }

  return false;
}

function listIdentityValuesFromDeal_(deal, kind) {
  const values = [];
  for (const entry of listNamedCustomFieldEntries_(deal)) {
    if (!isIdentityFieldLabelForKind_(entry.label, kind)) continue;
    collectFlatValues_(entry.normalized_value, values);
    collectFlatValues_(entry.display_value, values);
    collectFlatValues_(entry.raw_value, values);
  }
  for (const entry of listNamedPersonFieldEntries_(deal && deal.person)) {
    if (!isIdentityFieldLabelForKind_(entry.label, kind)) continue;
    collectFlatValues_(entry.normalized_value, values);
    collectFlatValues_(entry.display_value, values);
    collectFlatValues_(entry.raw_value, values);
  }
  return values.map((value) => String(value == null ? "" : value).trim()).filter(Boolean);
}

function isIdentityFieldLabelForKind_(label, kind) {
  const lower = toAsciiLower_(label);
  if (!lower) return false;
  if (kind === "email") return lower.indexOf("email") !== -1 || lower.indexOf("e-mail") !== -1;
  if (kind === "cpf") return lower.indexOf("cpf") !== -1;
  if (kind === "cnpj") return lower.indexOf("cnpj") !== -1 || lower.indexOf("cpf") !== -1;
  return false;
}

function normalizeStrictCpfTerm_(value) {
  const text = String(value == null ? "" : value).trim();
  if (/^\d{11}$/.test(text)) return text;
  if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(text)) return extractDigits_(text);
  return "";
}

function normalizeStrictCnpjTerm_(value) {
  const text = String(value == null ? "" : value).trim();
  if (/^\d{14}$/.test(text)) return text;
  if (/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(text)) return extractDigits_(text);
  return "";
}

function containsExactDocumentValue_(value, expected) {
  const normalizedExpected = String(expected || "").trim();
  if (!/^\d{11}$/.test(normalizedExpected) && !/^\d{14}$/.test(normalizedExpected)) return false;

  const text = String(value == null ? "" : value).trim();
  if (!text) return false;
  return normalizedExpected.length === 11
    ? containsStrictCpfValue_(text, normalizedExpected)
    : containsStrictCnpjValue_(text, normalizedExpected);
}

function containsStrictCpfValue_(text, expected) {
  const matches = String(text || "").match(/(?:^|\D)(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})(?=\D|$)/g) || [];
  return matches.some((match) => extractDigits_(match) === expected);
}

function containsStrictCnpjValue_(text, expected) {
  const matches = String(text || "").match(/(?:^|\D)(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})(?=\D|$)/g) || [];
  return matches.some((match) => extractDigits_(match) === expected);
}

function flattenDealValues_(deal) {
  const values = [];
  collectFlatValues_(deal && deal.title, values);
  collectFlatValues_(deal && deal.person_name, values);
  collectFlatValues_(deal && deal.org_name, values);
  collectFlatValues_(deal && deal.custom_fields_by_name, values);
  collectFlatValues_(deal && deal.custom_fields_readable, values);
  return values.map((value) => String(value == null ? "" : value).trim()).filter(Boolean);
}

function collectFlatValues_(value, out) {
  if (value === null || value === undefined || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) collectFlatValues_(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) collectFlatValues_(value[key], out);
    return;
  }
  out.push(value);
}

function extractEmails_(value) {
  const matches = String(value || "").toLowerCase().match(/[^\s@<>;,]+@[^\s@<>;,]+/g);
  return matches || [];
}

function identitySearchItemMatchesCriterion_(item, criterion) {
  if (!item || !criterion) return false;
  const kind = String(criterion.kind || "");
  const expected = String(criterion.value || "").trim();
  if (!kind || !expected) return false;

  const values = [];
  collectFlatValues_(item, values);

  if (kind === "email") {
    const expectedEmail = expected.toLowerCase();
    return values.some((value) => extractEmails_(value).includes(expectedEmail));
  }

  if (kind === "cpf" || kind === "cnpj") {
    return values.some((value) => containsExactDocumentValue_(value, expected));
  }

  return false;
}

async function findPersonIdsByIdentitySearch_(kind, term) {
  const normalized = normalizeIdentitySearchTerm_(kind, term);
  if (!normalized) return [];
  const criterion = { kind: kind, value: normalized };

  const query = {
    term: normalized,
    exact_match: true,
    limit: DEFAULT_CONFIG.upstreamMaxLimit,
    fields: kind === "email" ? "email,custom_fields" : "custom_fields"
  };

  const json = await fetchReadonlyUpstreamJson_("/api/v2/persons/search", query);
  const items = json && json.data && Array.isArray(json.data.items) ? json.data.items : [];
  const ids = [];

  for (const result of items) {
    const item = result && result.item ? result.item : null;
    const personId = Number(item && item.id);
    if (!Number.isFinite(personId) || !identitySearchItemMatchesCriterion_(item, criterion)) continue;
    ids.push(personId);
  }

  return uniqueNumbers_(ids);
}

async function fetchDealsByPersonIds_(personIds, query) {
  const ids = uniqueNumbers_(Array.from(personIds || []));
  const nested = await mapLimit_(ids, Math.min(DEFAULT_CONFIG.concurrency, 4), async (personId) => {
    const params = buildDealsListParamsForPerson_(personId, query);
    const deals = await fetchAllV2_("/deals", params);
    return mapLimit_(deals, DEFAULT_CONFIG.concurrency, async (rawDeal) => {
      const deal = await enrichLiveDeal_(rawDeal);
      if (!deal || deal.id == null) return null;
      return {
        dealId: Number(deal.id),
        deal: deal,
        searchItem: null,
        resultScore: 0.9
      };
    });
  });

  return nested.flat().filter(Boolean);
}

function buildDealsListParamsForPerson_(personId, query) {
  const q = query || {};
  const out = {
    person_id: personId,
    limit: DEFAULT_CONFIG.upstreamMaxLimit
  };

  copyIfPresent_(q, out, "status");
  copyIfPresent_(q, out, "owner_id");
  copyIfPresent_(q, out, "org_id");
  copyIfPresent_(q, out, "pipeline_id");
  copyIfPresent_(q, out, "stage_id");
  copyIfPresent_(q, out, "updated_since");
  copyIfPresent_(q, out, "updated_until");
  copyIfPresent_(q, out, "sort_by");
  copyIfPresent_(q, out, "sort_direction");
  return out;
}

function mergeIdentitySearchCandidates_(directResults, personDeals) {
  const byId = {};
  const lists = [directResults || [], personDeals || []];

  for (const list of lists) {
    for (const candidate of list) {
      if (!candidate || candidate.dealId == null || !candidate.deal) continue;
      const key = String(candidate.dealId);
      const existing = byId[key];
      if (!existing) {
        byId[key] = candidate;
        continue;
      }
      if ((candidate.resultScore || 0) > (existing.resultScore || 0)) existing.resultScore = candidate.resultScore;
      if (!existing.searchItem && candidate.searchItem) existing.searchItem = candidate.searchItem;
      if (!existing.deal && candidate.deal) existing.deal = candidate.deal;
    }
  }

  return Object.keys(byId)
    .map((key) => byId[key])
    .sort(compareIdentityCandidates_);
}

function compareIdentityCandidates_(a, b) {
  const ta = timeOrNull_(a && a.deal && a.deal.update_time);
  const tb = timeOrNull_(b && b.deal && b.deal.update_time);
  if (ta !== null || tb !== null) {
    const va = ta === null ? -Infinity : ta;
    const vb = tb === null ? -Infinity : tb;
    if (va !== vb) return vb - va;
  }
  return Number(b && b.dealId || 0) - Number(a && a.dealId || 0);
}

async function getLiveDealById_(dealId) {
  const cacheKey = ["pd_live_proxy", "deal_detail", String(dealId)].join(":");
  return getCached_(cacheKey, DEFAULT_CONFIG.detailCacheTtlSeconds, async () => {
    const json = await fetchReadonlyUpstreamJson_("/api/v2/deals/" + Number(dealId), {});
    const data = json && json.data ? json.data : null;
    return data ? enrichLiveDeal_(data) : null;
  });
}

async function enrichLiveDeal_(rawDeal) {
  const normalized = normalizeLiveDealShape_(rawDeal);
  const fieldMaps = await getDealFieldMaps_();
  const deal = enrichDealWithReadableFields_(normalized, fieldMaps);
  return enrichDealWithLinkedPerson_(deal);
}

function normalizeLiveDealShape_(deal) {
  const out = deepClone_(deal || {});
  flattenEntityField_(out, "org_id", "org_name");
  flattenEntityField_(out, "person_id", "person_name");
  flattenEntityField_(out, "owner_id", "owner_name");
  flattenEntityField_(out, "creator_user_id", "creator_user_name");
  flattenEntityField_(out, "pipeline_id", "pipeline_name");
  flattenEntityField_(out, "stage_id", "stage_name");
  flattenEntityField_(out, "visible_to", "visible_to_label");
  return out;
}

function flattenEntityField_(obj, key, nameKey) {
  if (!obj) return;
  const value = obj[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if (value.id != null) obj[key] = value.id;
  if (nameKey && !obj[nameKey]) {
    if (value.name != null) obj[nameKey] = value.name;
    else if (value.label != null) obj[nameKey] = value.label;
    else if (value.value != null && typeof value.value !== "object") obj[nameKey] = value.value;
  }
}

async function enrichDealWithLinkedPerson_(deal) {
  if (!deal) return deal;
  const personId = Number(deal.person_id);
  if (!Number.isFinite(personId)) return deal;

  const person = await getLivePersonById_(personId);
  if (!person) return deal;

  deal.person = person;
  applyLinkedPersonIdentityToDeal_(deal, person);
  return deal;
}

async function getLivePersonById_(personId) {
  const cacheKey = ["pd_live_proxy", "person_detail", String(personId)].join(":");
  return getCached_(cacheKey, DEFAULT_CONFIG.detailCacheTtlSeconds, async () => {
    const json = await fetchReadonlyUpstreamJson_("/api/v2/persons/" + Number(personId), {});
    const data = json && json.data ? json.data : null;
    return data ? enrichLivePerson_(data) : null;
  });
}

async function enrichLivePerson_(rawPerson) {
  const normalized = normalizeLivePersonShape_(rawPerson);
  const fieldMaps = await getPersonFieldMaps_();
  return enrichPersonWithReadableFields_(normalized, fieldMaps);
}

function normalizeLivePersonShape_(person) {
  const out = deepClone_(person || {});
  flattenEntityField_(out, "org_id", "org_name");
  flattenEntityField_(out, "owner_id", "owner_name");
  flattenEntityField_(out, "visible_to", "visible_to_label");
  return out;
}

async function buildLookups_() {
  return getCached_("PD_LIVE_PROXY_LOOKUPS_V2", DEFAULT_CONFIG.metadataCacheTtlSeconds, async () => {
    const [pipelineArr, stageArr, usersJson, dealFields] = await Promise.all([
      fetchAllV2_("/pipelines", { limit: DEFAULT_CONFIG.upstreamMaxLimit }),
      fetchAllV2_("/stages", { limit: DEFAULT_CONFIG.upstreamMaxLimit }),
      pipedriveGetV1_("/users", {}),
      getDealFieldsList_()
    ]);

    const pipelines = {};
    for (const item of pipelineArr) {
      if (item && item.id != null) pipelines[String(item.id)] = String(item.name || "");
    }

    const stages = {};
    for (const item of stageArr) {
      if (item && item.id != null) stages[String(item.id)] = String(item.name || "");
    }

    const users = {};
    const usersArr = usersJson && usersJson.data ? usersJson.data : [];
    for (const item of usersArr) {
      if (item && item.id != null) users[String(item.id)] = String(item.name || "");
    }

    return {
      pipelines: pipelines,
      stages: stages,
      users: users,
      dealFields: dealFields
    };
  });
}

async function getDealFieldsList_() {
  return getCached_("PD_LIVE_PROXY_DEAL_FIELDS_V2", DEFAULT_CONFIG.metadataCacheTtlSeconds, async () => {
    try {
      const json = await pipedriveGetV1_("/dealFields", {});
      const data = json && json.data ? json.data : [];
      if (data.length) return data.map(normalizeDealFieldDefinition_).filter(Boolean);
    } catch (error) {
      if (process.env.PIPEDRIVE_PROXY_DEBUG === "1") console.warn(error);
    }

    try {
      const data = await fetchAllV2_("/dealFields", { limit: DEFAULT_CONFIG.upstreamMaxLimit });
      return data.map(normalizeDealFieldDefinition_).filter(Boolean);
    } catch (error) {
      if (process.env.PIPEDRIVE_PROXY_DEBUG === "1") console.warn(error);
    }

    return [];
  });
}

async function getPersonFieldsList_() {
  return getCached_("PD_LIVE_PROXY_PERSON_FIELDS_V2", DEFAULT_CONFIG.metadataCacheTtlSeconds, async () => {
    try {
      const json = await pipedriveGetV1_("/personFields", {});
      const data = json && json.data ? json.data : [];
      if (data.length) return data.map(normalizeDealFieldDefinition_).filter(Boolean);
    } catch (error) {
      if (process.env.PIPEDRIVE_PROXY_DEBUG === "1") console.warn(error);
    }

    try {
      const data = await fetchAllV2_("/personFields", { limit: DEFAULT_CONFIG.upstreamMaxLimit });
      return data.map(normalizeDealFieldDefinition_).filter(Boolean);
    } catch (error) {
      if (process.env.PIPEDRIVE_PROXY_DEBUG === "1") console.warn(error);
    }

    return [];
  });
}

async function getDealFieldMaps_() {
  return getCached_("PD_LIVE_PROXY_DEAL_FIELD_MAPS_V2", DEFAULT_CONFIG.metadataCacheTtlSeconds, async () => {
    return buildFieldMapsFromDefinitions_(await getDealFieldsList_());
  });
}

async function getPersonFieldMaps_() {
  return getCached_("PD_LIVE_PROXY_PERSON_FIELD_MAPS_V2", DEFAULT_CONFIG.metadataCacheTtlSeconds, async () => {
    return applyFallbackPersonFieldLabels_(buildFieldMapsFromDefinitions_(await getPersonFieldsList_()));
  });
}

function buildFieldMapsFromDefinitions_(fields) {
  const byKey = {};
  const byName = {};
  for (const field of fields || []) {
    if (!field || !field.key) continue;
    const key = String(field.key);
    const meta = {
      id: field.id == null ? null : field.id,
      key: key,
      name: String(field.name || key),
      field_type: String(field.field_type || ""),
      edit_flag: !!field.edit_flag,
      options: Array.isArray(field.options) ? field.options.slice() : [],
      options_by_id: buildFieldOptionsById_(field.options),
      options_by_label: buildFieldOptionsByLabel_(field.options)
    };
    byKey[key] = meta;
    byName[meta.name] = meta;
  }
  return { byKey: byKey, byName: byName };
}

function applyFallbackPersonFieldLabels_(maps) {
  const out = maps || { byKey: {}, byName: {} };
  out.byKey = out.byKey || {};
  out.byName = out.byName || {};

  for (const key of Object.keys(PERSON_CUSTOM_FIELD_FALLBACK_LABELS)) {
    if (out.byKey[key]) continue;
    const name = PERSON_CUSTOM_FIELD_FALLBACK_LABELS[key];
    const meta = {
      id: null,
      key: key,
      name: name,
      field_type: "",
      edit_flag: false,
      options: [],
      options_by_id: {},
      options_by_label: {}
    };
    out.byKey[key] = meta;
    out.byName[name] = meta;
  }

  return out;
}

function normalizeDealFieldDefinition_(field) {
  if (!field) return null;
  const key = String(field.key || field.field_code || "").trim();
  if (!key) return null;

  const name = String(field.name || field.field_name || key).trim() || key;
  const options = [];
  const rawOptions = Array.isArray(field.options) ? field.options : [];
  for (const option of rawOptions) {
    if (!option) continue;
    options.push({
      id: option.id != null ? option.id : option.key,
      label: option.label != null ? option.label : option.name
    });
  }

  return {
    id: field.id == null ? null : field.id,
    key: key,
    name: name,
    field_type: String(field.field_type || "").trim(),
    edit_flag: !!field.edit_flag,
    options: options
  };
}

function buildFieldOptionsById_(options) {
  const out = {};
  const list = Array.isArray(options) ? options : [];
  for (const option of list) {
    if (!option || option.id == null) continue;
    out[String(option.id)] = option.label == null ? "" : String(option.label);
  }
  return out;
}

function buildFieldOptionsByLabel_(options) {
  const out = {};
  const list = Array.isArray(options) ? options : [];
  for (const option of list) {
    if (!option || option.label == null) continue;
    out[String(option.label)] = option.id == null ? null : option.id;
  }
  return out;
}

function mergeSearchItem_(fallbackItem, originalItem) {
  const base = deepClone_(fallbackItem || {});
  const original = originalItem && typeof originalItem === "object" ? deepClone_(originalItem) : {};
  const merged = Object.assign({}, base, original);

  if (!merged.custom_fields && base.custom_fields) merged.custom_fields = base.custom_fields;
  if (!merged.owner && base.owner) merged.owner = base.owner;
  if (!merged.stage && base.stage) merged.stage = base.stage;
  if (!merged.pipeline && base.pipeline) merged.pipeline = base.pipeline;
  if (!merged.person && base.person) merged.person = base.person;
  if (!merged.organization && base.organization) merged.organization = base.organization;
  return merged;
}

function buildSearchItemFromDeal_(deal) {
  const owner = deal && deal.owner_id != null ? { id: deal.owner_id } : null;
  if (owner && deal.owner_name) owner.name = deal.owner_name;

  const stage = deal && deal.stage_id != null ? { id: deal.stage_id } : null;
  if (stage && deal.stage_name) stage.name = deal.stage_name;

  const pipeline = deal && deal.pipeline_id != null ? { id: deal.pipeline_id } : null;
  if (pipeline && deal.pipeline_name) pipeline.name = deal.pipeline_name;

  const person = deal && deal.person_id != null ? { id: deal.person_id } : null;
  if (person && deal.person_name) person.name = deal.person_name;

  let organization = null;
  if (deal && (deal.org_id != null || deal.org_name)) {
    organization = {};
    if (deal.org_id != null) organization.id = deal.org_id;
    if (deal.org_name) organization.name = deal.org_name;
  }

  return {
    id: deal && deal.id != null ? deal.id : null,
    type: "deal",
    title: deal && deal.title ? deal.title : "",
    value: deal && deal.value != null ? deal.value : null,
    currency: deal && deal.currency ? deal.currency : "",
    status: deal && deal.status ? deal.status : "",
    visible_to: deal && deal.visible_to != null ? deal.visible_to : null,
    owner: owner,
    stage: stage,
    pipeline: pipeline,
    person: person,
    organization: organization,
    custom_fields: extractSearchItemCustomFields_(deal)
  };
}

function extractSearchItemCustomFields_(deal) {
  const named = deal && deal.custom_fields_by_name ? deal.custom_fields_by_name : {};
  const propertyCode = extractPropertyCode_(deal);
  if (propertyCode !== undefined && propertyCode !== null && propertyCode !== "") return [propertyCode];

  const values = [];
  for (const key of Object.keys(named)) {
    const value = named[key];
    if (value === null || value === undefined || value === "") continue;
    values.push(value);
    if (values.length >= 5) break;
  }
  return values;
}

function enrichDealWithReadableFields_(deal, fieldMaps) {
  const out = deepClone_(deal || {});
  const customFields = out && out.custom_fields && typeof out.custom_fields === "object" && !Array.isArray(out.custom_fields)
    ? out.custom_fields
    : null;

  const readable = {};
  const rawByName = {};
  const metaByKey = {};
  const keyMap = fieldMaps && fieldMaps.byKey ? fieldMaps.byKey : {};

  if (customFields) {
    for (const key of Object.keys(customFields)) {
      const meta = keyMap[key] || { key: key, name: key, field_type: "" };
      const value = customFields[key];
      const label = uniqueReadableFieldName_(readable, meta.name, key);
      const display = resolveReadableFieldValue_(value, meta);

      readable[label] = display.display_value;
      rawByName[label] = value;
      metaByKey[key] = {
        key: key,
        name: meta.name,
        field_type: meta.field_type,
        value: value,
        raw_value: value,
        display_value: display.display_value,
        normalized_value: display.normalized_value
      };
    }
  }

  if (Object.keys(readable).length) {
    out.custom_fields_readable = readable;
    out.custom_fields_by_name = readable;
    out.custom_fields_raw_by_name = rawByName;
  }

  if (Object.keys(metaByKey).length) {
    out.custom_fields_meta = metaByKey;
  } else if (customFields) {
    out.custom_fields_meta = buildFallbackCustomFieldsMeta_(customFields, keyMap);
  }

  return out;
}

function enrichPersonWithReadableFields_(person, fieldMaps) {
  const out = deepClone_(person || {});
  const customFields = out && out.custom_fields && typeof out.custom_fields === "object" && !Array.isArray(out.custom_fields)
    ? out.custom_fields
    : null;

  const readable = {};
  const rawByName = {};
  const metaByKey = {};
  const keyMap = fieldMaps && fieldMaps.byKey ? fieldMaps.byKey : {};

  if (customFields) {
    for (const key of Object.keys(customFields)) {
      const meta = keyMap[key] || { key: key, name: key, field_type: "" };
      const value = customFields[key];
      const label = uniqueReadableFieldName_(readable, meta.name, key);
      const display = resolveReadableFieldValue_(value, meta);

      readable[label] = display.display_value;
      rawByName[label] = value;
      metaByKey[key] = {
        key: key,
        name: meta.name,
        field_type: meta.field_type,
        value: value,
        raw_value: value,
        display_value: display.display_value,
        normalized_value: display.normalized_value
      };
    }
  }

  const allReadable = Object.assign({}, buildPersonStandardFieldsReadable_(out), readable);
  if (Object.keys(allReadable).length) out.person_fields_readable = allReadable;

  if (Object.keys(readable).length) {
    out.custom_fields_readable = readable;
    out.custom_fields_by_name = readable;
    out.custom_fields_raw_by_name = rawByName;
  }

  if (Object.keys(metaByKey).length) {
    out.custom_fields_meta = metaByKey;
  } else if (customFields) {
    out.custom_fields_meta = buildFallbackCustomFieldsMeta_(customFields, keyMap);
  }

  return out;
}

function buildPersonStandardFieldsReadable_(person) {
  const out = {};
  const source = person && typeof person === "object" ? person : {};
  for (const key of Object.keys(PERSON_STANDARD_FIELD_LABELS)) {
    if (source[key] === undefined) continue;
    out[PERSON_STANDARD_FIELD_LABELS[key]] = source[key];
  }
  if (source.org_name !== undefined) out["Organizacao - nome"] = source.org_name;
  if (source.owner_name !== undefined) out["Proprietario - nome"] = source.owner_name;
  if (source.visible_to_label !== undefined) out["Visivel para - rotulo"] = source.visible_to_label;
  return out;
}

function applyLinkedPersonIdentityToDeal_(deal, person) {
  if (!deal || !person) return;
  applyIfMissing_(deal, "person_name", person.name);

  const personCpf = extractPersonCpfCnpjValue_(person, "cpf");
  if (personCpf && shouldReplaceCpfValue_(getNamedDealFieldValue_(deal, "CPF do Proponente Principal"), personCpf)) {
    setNamedDealFieldValue_(deal, "CPF do Proponente Principal", personCpf);
  }
}

function getNamedDealFieldValue_(deal, label) {
  const named = deal && deal.custom_fields_by_name && typeof deal.custom_fields_by_name === "object"
    ? deal.custom_fields_by_name
    : {};
  const normalizedLabel = toAsciiLower_(label);
  for (const key of Object.keys(named)) {
    if (toAsciiLower_(key) === normalizedLabel) return named[key];
  }
  return undefined;
}

function setNamedDealFieldValue_(deal, label, value) {
  if (!deal || value === undefined || value === null || value === "") return;
  if (!deal.custom_fields_readable || typeof deal.custom_fields_readable !== "object") deal.custom_fields_readable = {};
  if (!deal.custom_fields_by_name || typeof deal.custom_fields_by_name !== "object") deal.custom_fields_by_name = deal.custom_fields_readable;
  if (!deal.custom_fields_raw_by_name || typeof deal.custom_fields_raw_by_name !== "object") deal.custom_fields_raw_by_name = {};

  const existingLabel = findExistingFieldLabel_(deal.custom_fields_by_name, label) || label;
  deal.custom_fields_readable[existingLabel] = value;
  deal.custom_fields_by_name[existingLabel] = value;
  deal.custom_fields_raw_by_name[existingLabel] = value;
}

function findExistingFieldLabel_(fields, label) {
  const normalizedLabel = toAsciiLower_(label);
  for (const key of Object.keys(fields || {})) {
    if (toAsciiLower_(key) === normalizedLabel) return key;
  }
  return "";
}

function shouldReplaceCpfValue_(currentValue, replacementValue) {
  const replacementDigits = extractDigits_(replacementValue);
  if (!/^\d{11}$/.test(replacementDigits)) return false;
  const currentDigits = extractDigits_(currentValue);
  if (!currentDigits) return true;
  if (currentDigits === replacementDigits) return false;
  return currentDigits.length !== 11;
}

function extractPersonCpfCnpjValue_(person, kind) {
  const expectedLength = kind === "cnpj" ? 14 : 11;
  const entries = listNamedPersonFieldEntries_(person);
  for (const entry of entries) {
    const label = toAsciiLower_(entry.label);
    if (kind === "cpf" && label.indexOf("cpf") === -1) continue;
    if (kind === "cnpj" && label.indexOf("cnpj") === -1) continue;
    const value = extractDocumentTextFromValue_(entry.normalized_value, expectedLength) ||
      extractDocumentTextFromValue_(entry.display_value, expectedLength) ||
      extractDocumentTextFromValue_(entry.raw_value, expectedLength);
    if (value) return value;
  }
  return "";
}

function extractDocumentTextFromValue_(value, expectedLength) {
  const values = [];
  collectFlatValues_(value, values);
  for (const item of values) {
    const text = String(item == null ? "" : item).trim();
    if (!text) continue;
    const pattern = expectedLength === 11
      ? /(?:^|\D)(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})(?=\D|$)/
      : /(?:^|\D)(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})(?=\D|$)/;
    const match = text.match(pattern);
    if (match && extractDigits_(match[1]).length === expectedLength) return match[1];
  }
  return "";
}

function buildResponseDealPayload_(deal) {
  const out = deepClone_(deal || {});
  delete out.custom_fields;
  delete out.custom_fields_by_name;
  delete out.custom_fields_raw_by_name;
  delete out.custom_fields_meta;
  return out;
}

function buildLeanDealPayload_(deal, searchItem, lookups) {
  const summary = buildDealAiSummary_(deal, lookups);
  const personName =
    (searchItem && searchItem.person && String(searchItem.person.name || "")) ||
    summary.identity.person_name ||
    deal.person_name ||
    "";
  const stageName =
    (searchItem && searchItem.stage && String(searchItem.stage.name || "")) ||
    summary.process.stage_name ||
    "";
  const pipelineName =
    (searchItem && searchItem.pipeline && String(searchItem.pipeline.name || "")) ||
    summary.process.pipeline_name ||
    "";

  return compactObject_({
    id: deal.id == null ? null : deal.id,
    title: deal.title || "",
    status: deal.status || "",
    lost_reason: deal.lost_reason || undefined,
    property_code: extractPropertyCode_(deal),
    person_name: personName || undefined,
    person: buildLeanPersonPayload_(deal.person),
    pipeline: compactObject_({
      id: deal.pipeline_id == null ? undefined : deal.pipeline_id,
      name: pipelineName || undefined
    }),
    stage: compactObject_({
      id: deal.stage_id == null ? undefined : deal.stage_id,
      name: stageName || undefined
    }),
    updated_at: deal.update_time || undefined,
    fields: buildLeanCustomFields_(deal),
    workflow: buildLeanWorkflow_(deal),
    notes: buildLeanNotes_(searchItem)
  });
}

function buildLeanPersonPayload_(person) {
  if (!person) return null;

  const fields = {};
  for (const entry of listNamedPersonFieldEntries_(person)) {
    const value = normalizeLeanValue_(entry.normalized_value !== undefined ? entry.normalized_value : entry.display_value);
    fields[entry.label] = isBlankLeanValue_(value) ? null : value;
  }

  const out = compactObject_({
    id: person.id == null ? undefined : person.id,
    name: person.name || undefined,
    first_name: person.first_name || undefined,
    last_name: person.last_name || undefined,
    email: normalizeLeanValue_(person.email),
    phone: normalizeLeanValue_(person.phone),
    fields: fields
  });
  out.cpf_cnpj = extractPersonCpfCnpjValue_(person, "cpf") || extractPersonCpfCnpjValue_(person, "cnpj") || null;
  return out;
}

function buildLeanCustomFields_(deal) {
  const out = {};
  for (const entry of listNamedCustomFieldEntries_(deal)) {
    if (!shouldExposeLeanField_(entry.label)) continue;
    const value = normalizeLeanValue_(entry.normalized_value !== undefined ? entry.normalized_value : entry.display_value);
    if (isBlankLeanValue_(value)) continue;
    out[entry.label] = value;
  }
  return out;
}

function buildLeanWorkflow_(deal) {
  const statuses = {};
  const completionDates = {};

  for (const entry of listNamedCustomFieldEntries_(deal)) {
    const label = String(entry.label || "").trim();
    const value = normalizeLeanValue_(entry.normalized_value !== undefined ? entry.normalized_value : entry.display_value);
    if (isBlankLeanValue_(value)) continue;

    if (isWorkflowStatusField_(label)) {
      statuses[stripLabelPrefix_(label, "Status:")] = value;
      continue;
    }

    if (isWorkflowCompletionDateField_(label)) {
      completionDates[stripDataTerminoPrefix_(label)] = value;
    }
  }

  return compactObject_({
    statuses: statuses,
    completion_dates: completionDates
  });
}

function buildLeanNotes_(searchItem) {
  const notes = Array.isArray(searchItem && searchItem.notes) ? searchItem.notes : [];
  return notes
    .map((note, index) => normalizeLeanNote_(note, index))
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeLeanNote_(note, index) {
  if (note === null || note === undefined || note === "") return null;
  if (typeof note === "object" && !Array.isArray(note)) {
    const value = String(note.value || note.content || note.text || note.note || "").trim();
    if (!value) return null;
    const id = Number(note.id);
    return {
      id: Number.isFinite(id) ? id : index + 1,
      value: value
    };
  }

  const value = String(note).trim();
  if (!value) return null;
  return {
    id: index + 1,
    value: value
  };
}

function shouldExposeLeanField_(label) {
  const lower = toAsciiLower_(label);
  if (!lower) return false;
  if (isWorkflowStatusField_(label) || isWorkflowCompletionDateField_(label)) return false;

  const exact = new Set([
    "modalidade",
    "forma de pagamento",
    "estado (selecionavel)",
    "estado",
    "tipo de imovel",
    "numero do imovel",
    "codigo do imovel",
    "numero da matricula",
    "cidade",
    "bairro",
    "endereco",
    "nome do arrematante",
    "e-mail do arrematante",
    "email do arrematante",
    "telefone do arrematante",
    "cpf do proponente principal",
    "ocupado?",
    "inscricao / cadastro municipal",
    "nome do condominio",
    "contatos condominio"
  ]);
  if (exact.has(lower)) return true;

  return (
    lower.indexOf("valor") !== -1 ||
    lower.indexOf("matricula") !== -1 ||
    lower.indexOf("aquisicao") !== -1 ||
    lower.indexOf("proposta") !== -1 ||
    lower.indexOf("avaliacao") !== -1 ||
    lower.indexOf("endereco") !== -1 ||
    lower.indexOf("area") !== -1 ||
    lower.indexOf("ocupado") !== -1 ||
    lower.indexOf("processo juridico") !== -1
  );
}

function isWorkflowStatusField_(label) {
  return /^status:\s*.+/i.test(String(label || "").trim());
}

function isWorkflowCompletionDateField_(label) {
  return /^data\s+termino:\s*.+/i.test(toAsciiLower_(label));
}

function stripDataTerminoPrefix_(label) {
  return stripLabelPrefix_(label, "Data termino:") || String(label || "").trim();
}

function normalizeLeanValue_(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeLeanValue_).filter((item) => !isBlankLeanValue_(item));
  }

  if (value && typeof value === "object") {
    if (value.value !== undefined && Object.keys(value).every((key) => key === "value" || key === "currency")) {
      return compactObject_({
        value: normalizeLeanValue_(value.value),
        currency: value.currency || undefined
      });
    }

    if (value.value !== undefined && String(value.value || "").trim()) {
      return String(value.value).trim();
    }

    if (value.formatted_address !== undefined && String(value.formatted_address || "").trim()) {
      return String(value.formatted_address).trim();
    }

    const out = {};
    for (const key of Object.keys(value)) {
      const normalized = normalizeLeanValue_(value[key]);
      if (!isBlankLeanValue_(normalized)) out[key] = normalized;
    }
    return out;
  }

  if (typeof value === "string") return value.trim();
  return value;
}

function isBlankLeanValue_(value) {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function buildFallbackCustomFieldsMeta_(customFields, keyMap) {
  const out = {};
  for (const key of Object.keys(customFields || {})) {
    const meta = (keyMap && keyMap[key]) || { name: key, field_type: "" };
    out[key] = {
      key: key,
      name: meta.name,
      field_type: meta.field_type || "",
      value: customFields[key],
      raw_value: customFields[key],
      display_value: customFields[key],
      normalized_value: simplifyReadableValue_(customFields[key])
    };
  }
  return out;
}

function resolveReadableFieldValue_(value, meta) {
  const displayValue = mapFieldValueToDisplay_(value, meta);
  return {
    display_value: displayValue,
    normalized_value: simplifyReadableValue_(displayValue)
  };
}

function mapFieldValueToDisplay_(value, meta) {
  if (value === null || value === undefined || value === "") return value;

  const optionsById = meta && meta.options_by_id ? meta.options_by_id : {};
  const fieldType = String(meta && meta.field_type || "").toLowerCase();

  if ((fieldType === "enum" || fieldType === "visible_to") && Object.keys(optionsById).length) {
    const mapped = optionsById[String(value)];
    return mapped !== undefined ? mapped : value;
  }

  if (fieldType === "set" && Array.isArray(value) && Object.keys(optionsById).length) {
    return value.map((item) => {
      const mapped = optionsById[String(item)];
      return mapped !== undefined ? mapped : item;
    });
  }

  if (fieldType === "set" && typeof value === "string" && value.indexOf(",") !== -1 && Object.keys(optionsById).length) {
    return value.split(",").map((item) => {
      const token = String(item || "").trim();
      const mapped = optionsById[token];
      return mapped !== undefined ? mapped : token;
    }).filter(Boolean);
  }

  return value;
}

function simplifyReadableValue_(value) {
  if (Array.isArray(value)) return value.map(simplifyReadableValue_);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = simplifyReadableValue_(value[key]);
    return out;
  }
  const text = String(value == null ? "" : value).trim();
  if (!text) return value;
  return text.replace(/^\d+\.\s*/, "").trim() || text;
}

function listNamedCustomFieldEntries_(deal) {
  const named = deal && deal.custom_fields_by_name && typeof deal.custom_fields_by_name === "object"
    ? deal.custom_fields_by_name
    : {};
  const rawByName = deal && deal.custom_fields_raw_by_name && typeof deal.custom_fields_raw_by_name === "object"
    ? deal.custom_fields_raw_by_name
    : {};
  const out = [];

  for (const label of Object.keys(named)) {
    const display = named[label];
    out.push({
      label: label,
      display_value: display,
      normalized_value: simplifyReadableValue_(display),
      raw_value: rawByName[label] !== undefined ? rawByName[label] : display,
      field_type: ""
    });
  }

  if (out.length) return out;

  const customMeta = deal && deal.custom_fields_meta ? deal.custom_fields_meta : {};
  for (const key of Object.keys(customMeta)) {
    const meta = customMeta[key] || {};
    const display = meta.display_value !== undefined ? meta.display_value : meta.value;
    out.push({
      label: String(meta.name || key),
      display_value: display,
      normalized_value: meta.normalized_value !== undefined ? meta.normalized_value : simplifyReadableValue_(display),
      raw_value: meta.raw_value !== undefined ? meta.raw_value : meta.value,
      field_type: String(meta.field_type || "")
    });
  }

  return out;
}

function listNamedPersonFieldEntries_(person) {
  const readable = person && person.person_fields_readable && typeof person.person_fields_readable === "object"
    ? person.person_fields_readable
    : {};
  const customRawByName = person && person.custom_fields_raw_by_name && typeof person.custom_fields_raw_by_name === "object"
    ? person.custom_fields_raw_by_name
    : {};
  const out = [];

  for (const label of Object.keys(readable)) {
    const display = readable[label];
    out.push({
      label: label,
      display_value: display,
      normalized_value: simplifyReadableValue_(display),
      raw_value: customRawByName[label] !== undefined ? customRawByName[label] : display,
      field_type: ""
    });
  }

  if (out.length) return out;

  const customMeta = person && person.custom_fields_meta ? person.custom_fields_meta : {};
  for (const key of Object.keys(customMeta)) {
    const meta = customMeta[key] || {};
    const display = meta.display_value !== undefined ? meta.display_value : meta.value;
    out.push({
      label: String(meta.name || key),
      display_value: display,
      normalized_value: meta.normalized_value !== undefined ? meta.normalized_value : simplifyReadableValue_(display),
      raw_value: meta.raw_value !== undefined ? meta.raw_value : meta.value,
      field_type: String(meta.field_type || "")
    });
  }

  return out;
}

function buildAiDealContext_(searchItem, deal, lookups) {
  const notes = Array.isArray(searchItem && searchItem.notes) ? searchItem.notes : [];
  const important = {
    statuses: {},
    dates: {},
    monetary: {},
    property: {},
    contacts: {}
  };

  for (const entry of listNamedCustomFieldEntries_(deal)) {
    const label = entry.label;
    const value = entry.display_value;
    const type = String(entry.field_type || "").toLowerCase();
    const lower = toAsciiLower_(label);

    if (lower.indexOf("status") !== -1) important.statuses[label] = value;
    if (
      type === "date" ||
      type === "daterange" ||
      type === "date_range" ||
      lower.indexOf("data") !== -1 ||
      lower.indexOf("prazo") !== -1 ||
      lower.indexOf("venc") !== -1
    ) {
      important.dates[label] = value;
    }
    if (type === "monetary" || (value && typeof value === "object" && value.currency !== undefined)) {
      important.monetary[label] = value;
    }
    if (
      lower.indexOf("imovel") !== -1 ||
      lower.indexOf("matricula") !== -1 ||
      lower.indexOf("endereco") !== -1 ||
      lower.indexOf("bairro") !== -1 ||
      lower.indexOf("cidade") !== -1
    ) {
      important.property[label] = value;
    }
    if (
      lower.indexOf("cliente") !== -1 ||
      lower.indexOf("cpf") !== -1 ||
      lower.indexOf("telefone") !== -1 ||
      lower.indexOf("whatsapp") !== -1 ||
      lower.indexOf("email") !== -1 ||
      lower.indexOf("contato") !== -1
    ) {
      important.contacts[label] = value;
    }
  }

  const summary = buildDealAiSummary_(deal, lookups);
  summary.identity.person_name =
    (searchItem && searchItem.person && String(searchItem.person.name || "")) ||
    summary.identity.person_name ||
    "";
  summary.identity.organization_name =
    (searchItem && searchItem.organization && String(searchItem.organization.name || "")) ||
    summary.identity.organization_name ||
    "";
  summary.process.stage_name =
    (searchItem && searchItem.stage && String(searchItem.stage.name || "")) ||
    summary.process.stage_name;

  return {
    summary: summary,
    identity: summary.identity,
    process: summary.process,
    financial: summary.financial,
    dates: summary.dates,
    property: summary.property,
    contacts: summary.contacts,
    workflow: summary.workflow,
    notes: {
      count: notes.length,
      latest: notes.slice(0, 10)
    },
    important_custom_fields: important,
    available_payloads: {
      custom_fields_readable: true,
      person: !!(deal && deal.person),
      person_fields_readable: !!(deal && deal.person && deal.person.person_fields_readable),
      ai_summary: true
    }
  };
}

function buildDealAiSummary_(deal, lookups) {
  const property = {};
  const workflowStatuses = {};
  const workflowStatusDetails = {};
  const workflowExecutors = {};
  const workflowExecutorDetails = {};
  const importantDates = {};
  const importantFinancial = {};
  const contacts = {};

  for (const entry of listNamedCustomFieldEntries_(deal)) {
    const label = entry.label;
    const lowered = toAsciiLower_(label);
    const display = entry.display_value;
    const normalized = entry.normalized_value;
    const rawValue = entry.raw_value;
    const shortStatus = stripLabelPrefix_(label, "Status:");
    const shortExecutor = stripLabelPrefix_(label, "Executor:");

    if (shortStatus) {
      workflowStatuses[shortStatus] = normalized;
      workflowStatusDetails[shortStatus] = {
        raw_value: rawValue,
        display_value: display,
        normalized_value: normalized
      };
    }

    if (shortExecutor) {
      workflowExecutors[shortExecutor] = normalized;
      workflowExecutorDetails[shortExecutor] = {
        raw_value: rawValue,
        display_value: display,
        normalized_value: normalized
      };
    }

    if (
      lowered.indexOf("imovel") !== -1 ||
      lowered.indexOf("matricula") !== -1 ||
      lowered.indexOf("endereco") !== -1 ||
      lowered.indexOf("bairro") !== -1 ||
      lowered.indexOf("cidade") !== -1 ||
      lowered.indexOf("ocupado") !== -1 ||
      lowered.indexOf("tipo de imovel") !== -1 ||
      lowered.indexOf("modalidade") !== -1
    ) {
      property[label] = normalized;
    }

    if (
      lowered.indexOf("cliente") !== -1 ||
      lowered.indexOf("cpf") !== -1 ||
      lowered.indexOf("telefone") !== -1 ||
      lowered.indexOf("whatsapp") !== -1 ||
      lowered.indexOf("email") !== -1 ||
      lowered.indexOf("contato") !== -1
    ) {
      contacts[label] = normalized;
    }

    if (
      String(entry.field_type || "").toLowerCase() === "date" ||
      String(entry.field_type || "").toLowerCase() === "daterange" ||
      String(entry.field_type || "").toLowerCase() === "date_range" ||
      lowered.indexOf("data") !== -1 ||
      lowered.indexOf("prazo") !== -1 ||
      lowered.indexOf("venc") !== -1
    ) {
      importantDates[label] = normalized;
    }

    if (
      String(entry.field_type || "").toLowerCase() === "monetary" ||
      lowered.indexOf("valor") !== -1 ||
      lowered.indexOf("preco") !== -1 ||
      lowered.indexOf("pagamento") !== -1 ||
      lowered.indexOf("fgts") !== -1
    ) {
      importantFinancial[label] = normalized;
    }
  }

  appendLinkedPersonFieldsToContacts_(contacts, deal && deal.person);

  return {
    identity: {
      deal_id: deal.id == null ? null : deal.id,
      title: deal.title || "",
      property_code: extractPropertyCode_(deal),
      person_id: deal.person_id == null ? null : deal.person_id,
      person_name: deal.person_name || "",
      organization_id: deal.org_id == null ? null : deal.org_id,
      organization_name: deal.org_name || "",
      owner_id: deal.owner_id == null ? null : deal.owner_id,
      owner_name: deal.owner_name || lookupName_(lookups && lookups.users, deal.owner_id),
      person: buildSummaryPersonIdentity_(deal && deal.person)
    },
    process: {
      deal_status: deal.status || "",
      pipeline_id: deal.pipeline_id == null ? null : deal.pipeline_id,
      pipeline_name: deal.pipeline_name || lookupName_(lookups && lookups.pipelines, deal.pipeline_id),
      stage_id: deal.stage_id == null ? null : deal.stage_id,
      stage_name: deal.stage_name || lookupName_(lookups && lookups.stages, deal.stage_id),
      visible_to: deal.visible_to == null ? null : deal.visible_to,
      is_archived: !!deal.is_archived,
      is_deleted: !!deal.is_deleted
    },
    workflow: {
      statuses: workflowStatuses,
      statuses_detailed: workflowStatusDetails,
      executors: workflowExecutors,
      executors_detailed: workflowExecutorDetails
    },
    property: property,
    contacts: contacts,
    financial: {
      value: deal.value == null ? null : deal.value,
      currency: deal.currency || "",
      probability: deal.probability == null ? null : deal.probability,
      acv: deal.acv == null ? null : deal.acv,
      arr: deal.arr == null ? null : deal.arr,
      mrr: deal.mrr == null ? null : deal.mrr,
      important_custom_fields: importantFinancial
    },
    dates: {
      add_time: deal.add_time || "",
      update_time: deal.update_time || "",
      stage_change_time: deal.stage_change_time || "",
      expected_close_date: deal.expected_close_date || "",
      close_time: deal.close_time || "",
      won_time: deal.won_time || "",
      lost_time: deal.lost_time || "",
      local_won_date: deal.local_won_date || "",
      local_lost_date: deal.local_lost_date || "",
      local_close_date: deal.local_close_date || "",
      important_custom_fields: importantDates
    }
  };
}

function appendLinkedPersonFieldsToContacts_(contacts, person) {
  if (!contacts || !person) return;
  for (const entry of listNamedPersonFieldEntries_(person)) {
    const lower = toAsciiLower_(entry.label);
    if (
      lower.indexOf("cpf") === -1 &&
      lower.indexOf("cnpj") === -1 &&
      lower.indexOf("nome") === -1 &&
      lower.indexOf("email") === -1 &&
      lower.indexOf("e-mail") === -1 &&
      lower.indexOf("telefone") === -1 &&
      lower.indexOf("conjuge") === -1 &&
      lower.indexOf("arrematante") === -1 &&
      lower.indexOf("pix") === -1
    ) {
      continue;
    }
    const value = entry.normalized_value !== undefined ? entry.normalized_value : entry.display_value;
    if (value === null || value === undefined || value === "") continue;
    contacts["Pessoa - " + entry.label] = value;
  }
}

function buildSummaryPersonIdentity_(person) {
  if (!person) return null;
  return {
    id: person.id == null ? null : person.id,
    name: person.name || "",
    first_name: person.first_name || "",
    last_name: person.last_name || "",
    email: person.email === undefined ? null : person.email,
    phone: person.phone === undefined ? null : person.phone,
    cpf_cnpj: extractPersonCpfCnpjValue_(person, "cpf") || extractPersonCpfCnpjValue_(person, "cnpj") || ""
  };
}

function extractPropertyCode_(deal) {
  const normalizedByName = normalizeCustomFieldsByName_(deal && deal.custom_fields_by_name);
  const candidates = [
    "numero do imovel",
    "codigo do imovel"
  ];

  for (const name of candidates) {
    if (normalizedByName[name] !== undefined && normalizedByName[name] !== null && normalizedByName[name] !== "") {
      return String(normalizedByName[name]).trim();
    }
  }

  const title = String((deal && deal.title) || "");
  const match = title.match(/\b\d{7,}\b/);
  return match ? match[0] : "";
}

function normalizeCustomFieldsByName_(named) {
  const out = {};
  const source = named && typeof named === "object" ? named : {};
  for (const key of Object.keys(source)) {
    out[toAsciiLower_(key)] = source[key];
  }
  return out;
}

function lookupName_(map, id) {
  if (!map || id == null || id === "") return "";
  const value = map[String(id)];
  return value == null ? "" : String(value);
}

function toAsciiLower_(value) {
  let text = String(value == null ? "" : value).toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (e) {}
  return text;
}

function stripLabelPrefix_(value, prefix) {
  const text = String(value || "").trim();
  const expected = String(prefix || "").trim();
  if (!text || !expected) return "";
  const normalizedText = toAsciiLower_(text);
  const normalizedPrefix = toAsciiLower_(expected);
  if (normalizedText.indexOf(normalizedPrefix) !== 0) return "";
  return text.substring(expected.length).replace(/^[:\s-]+/, "").trim();
}

function uniqueReadableFieldName_(target, preferredName, key) {
  const base = String(preferredName || key || "").trim() || String(key || "");
  if (!target || target[base] === undefined) return base;
  return base + " [" + String(key || "") + "]";
}

function attachSearchTraceToSearchJson_(searchJson, query, correlationFound) {
  const out = Object.assign({}, searchJson || {});
  const data = out && out.data && typeof out.data === "object" && !Array.isArray(out.data)
    ? Object.assign({}, out.data)
    : { items: [] };
  data.search_trace = buildSearchTrace_(query, correlationFound);
  out.data = data;
  return out;
}

function buildSearchTrace_(query, correlationFound) {
  const term = String(query && query.term || "").trim();
  const matchedBy = resolveMatchedByForTrace_(query, term);
  return {
    matched_by: matchedBy,
    search_term_normalized: normalizeSearchTermForTrace_(matchedBy, term),
    correlation_found: !!correlationFound
  };
}

function resolveMatchedByForTrace_(query, term) {
  const requested = normalizeRequestedSearchBy_(query && query.search_by);
  const text = String(term || "").trim();
  if (!text) return requested || "";

  if (requested === "email") return "email";
  if (requested === "property_code") return "property_code";
  if (requested === "cpf" || requested === "cnpj") return detectDocumentKindFromTerm_(text) || requested;

  if (normalizeIdentitySearchTerm_("email", text)) return "email";
  const documentKind = detectDocumentKindFromTerm_(text);
  if (documentKind) return documentKind;
  if (normalizeSearchTermForTrace_("property_code", text)) return "property_code";
  return requested || "search";
}

function detectDocumentKindFromTerm_(value) {
  const digits = extractDigits_(value);
  if (/^\d{14}$/.test(digits)) return "cnpj";
  if (/^\d{11}$/.test(digits)) return "cpf";
  return "";
}

function normalizeSearchTermForTrace_(kind, value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  if (kind === "cpf" || kind === "cnpj") return extractDigits_(text);
  if (kind === "email") return text.toLowerCase();
  if (kind === "property_code") return /^\d{7,}$/.test(text) ? text : "";
  return text;
}

async function proxyReadonlyUpstreamGet_(req) {
  const path = String(req.path || "");
  const query = buildUpstreamQueryParams_(req.query || {});
  return fetchReadonlyUpstreamJson_(path, query);
}

async function fetchReadonlyUpstreamJson_(path, query) {
  const cacheKey = buildReadonlyUpstreamCacheKey_(path, query);
  return getCached_(cacheKey, DEFAULT_CONFIG.readonlyCacheTtlSeconds, async () => {
    if (String(path || "").indexOf("/api/v2/") === 0) {
      return pipedriveGetV2_(String(path || "").substring("/api/v2".length), query);
    }
    if (String(path || "").indexOf("/v1/") === 0) {
      return pipedriveGetV1_(String(path || "").substring("/v1".length), query);
    }
    throw new ProxyHttpError("Invalid readonly upstream route.", "invalid_upstream_route", 400);
  });
}

function pipedriveGetV2_(path, params) {
  return fetchJsonWithRetry_("https://" + DEFAULT_CONFIG.domain + ".pipedrive.com/api/v2" + path, params);
}

function pipedriveGetV1_(path, params) {
  return fetchJsonWithRetry_("https://" + DEFAULT_CONFIG.domain + ".pipedrive.com/api/v1" + path, params);
}

async function fetchJsonWithRetry_(baseUrl, params) {
  const token = readRequiredEnv_(DEFAULT_CONFIG.tokenKey);
  const url = baseUrl + "?" + buildQuery_(Object.assign({ api_token: token }, params || {}));
  let attempt = 0;
  let lastErr = null;

  while (attempt <= DEFAULT_CONFIG.fetchRetries) {
    attempt++;

    try {
      const resp = await fetchWithTimeout_(url);
      const text = await resp.text();

      if (resp.status >= 200 && resp.status < 300) {
        const json = text ? JSON.parse(text) : {};
        if (json && json.success === false) {
          throw new ProxyHttpError(text, "upstream_error", 502);
        }
        return json;
      }

      const retryable = resp.status === 429 || (resp.status >= 500 && resp.status <= 599);
      if (!retryable) {
        throw new ProxyHttpError("HTTP " + resp.status + ": " + truncateText_(text), "upstream_http_error", 502);
      }

      lastErr = new ProxyHttpError("HTTP " + resp.status + ": " + truncateText_(text), "upstream_retryable_error", 502);
      await sleep_(computeRetryDelay_(attempt, resp.headers.get("retry-after")));
    } catch (error) {
      if (error instanceof ProxyHttpError && error.info !== "upstream_retryable_error") throw error;
      lastErr = error;
      if (attempt > DEFAULT_CONFIG.fetchRetries) break;
      await sleep_(computeRetryDelay_(attempt, ""));
    }
  }

  if (lastErr instanceof ProxyHttpError) throw lastErr;
  throw new ProxyHttpError(
    String((lastErr && lastErr.message) || lastErr || "Upstream fetch failed."),
    "upstream_fetch_failed",
    502
  );
}

async function fetchWithTimeout_(url) {
  const timeoutMs = DEFAULT_CONFIG.fetchTimeoutMs;
  const headers = {
    accept: "application/json",
    "user-agent": "pipedrive-live-proxy-vercel/1.0"
  };

  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return fetch(url, { headers: headers, signal: AbortSignal.timeout(timeoutMs) });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function computeRetryDelay_(attempt, retryAfter) {
  const retryAfterMs = parseRetryAfterMs_(retryAfter);
  if (retryAfterMs > 0) return Math.min(30000, retryAfterMs);
  const base = Math.min(10000, 250 * Math.pow(2, attempt - 1));
  const jitter = Math.floor(Math.random() * 125);
  return base + jitter;
}

function parseRetryAfterMs_(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const time = new Date(text).getTime();
  return Number.isFinite(time) ? Math.max(0, time - Date.now()) : 0;
}

async function fetchAllV2_(path, params) {
  const base = Object.assign({}, params || {});
  if (base.limit !== undefined) base.limit = clampUpstreamLimit_(base.limit);
  let cursor = base.cursor ? String(base.cursor) : "";
  const out = [];
  let pages = 0;
  const maxPages = readPositiveInt("PIPEDRIVE_PROXY_MAX_PAGES", 20);

  while (pages < maxPages) {
    pages++;
    const query = Object.assign({}, base, { cursor: cursor || undefined });
    const json = await pipedriveGetV2_(path, query);
    const data = json && json.data ? json.data : [];
    for (const item of data) out.push(item);
    cursor = getNextCursor_(json);
    if (!cursor) break;
  }

  return out;
}

function getNextCursor_(json) {
  const ad = json && json.additional_data ? json.additional_data : {};
  if (ad.pagination && ad.pagination.next_cursor) return String(ad.pagination.next_cursor);
  if (ad.next_cursor) return String(ad.next_cursor);
  return "";
}

function buildUpstreamQueryParams_(query) {
  const out = Object.assign({}, query || {});
  delete out.api_token;
  delete out.path;
  delete out.endpoint;
  delete out.method;
  delete out._method;
  delete out.search_by;
  if (out.limit !== undefined) out.limit = clampUpstreamLimit_(out.limit);
  return out;
}

function buildReadonlyUpstreamCacheKey_(path, query) {
  const keys = Object.keys(query || {}).sort();
  const parts = [String(path || "")];
  for (const key of keys) {
    const value = query[key];
    if (value === undefined || value === null || value === "") continue;
    parts.push(key + "=" + String(value));
  }
  return ["pd_live_proxy", parts.join("&")].join(":");
}

async function getCached_(key, ttlSeconds, builder) {
  const cacheKey = String(key);
  const ttl = Number(ttlSeconds);
  const now = Date.now();
  const entry = state.cache.get(cacheKey);

  if (entry && entry.expiresAt > now) {
    return entry.value;
  }

  const pending = state.pending.get(cacheKey);
  if (pending) return pending;

  const promise = Promise.resolve()
    .then(builder)
    .then((value) => {
      if (Number.isFinite(ttl) && ttl > 0) {
        state.cache.set(cacheKey, {
          value: value,
          expiresAt: Date.now() + ttl * 1000,
          touchedAt: Date.now()
        });
        evictCacheIfNeeded_();
      }
      return value;
    })
    .finally(() => {
      state.pending.delete(cacheKey);
    });

  state.pending.set(cacheKey, promise);
  return promise;
}

function evictCacheIfNeeded_() {
  const maxEntries = DEFAULT_CONFIG.maxCacheEntries;
  if (state.cache.size <= maxEntries) return;

  const entries = Array.from(state.cache.entries());
  entries.sort((a, b) => {
    const ax = Math.min(a[1].expiresAt || 0, a[1].touchedAt || 0);
    const bx = Math.min(b[1].expiresAt || 0, b[1].touchedAt || 0);
    return ax - bx;
  });

  const removeCount = Math.max(1, entries.length - maxEntries);
  for (let i = 0; i < removeCount; i++) state.cache.delete(entries[i][0]);
}

function buildQuery_(obj) {
  const params = new URLSearchParams();
  for (const key of Object.keys(obj || {})) {
    const value = obj[key];
    if (value === undefined || value === null || value === "") continue;
    params.append(key, String(value));
  }
  return params.toString();
}

function shapeDealForApi_(deal, query) {
  const out = deepClone_(deal || {});
  if (out.custom_fields && query && query.custom_fields) {
    const allow = parseStringSet_(query.custom_fields);
    if (allow) {
      const picked = {};
      for (const key of Object.keys(out.custom_fields || {})) {
        if (allow.has(String(key).toLowerCase())) picked[key] = out.custom_fields[key];
      }
      out.custom_fields = picked;
    }
  }
  return out;
}

function paginateCollection_(items, query) {
  const limit = parseLimit_(query && query.limit);
  const offset = parseCursorOffset_(query && query.cursor);
  const slice = items.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  const hasMore = nextOffset < items.length;

  return {
    items: slice,
    pagination: {
      limit: limit,
      more_items_in_collection: hasMore,
      next_cursor: hasMore ? encodeCursorOffset_(nextOffset) : null
    }
  };
}

function parseLimit_(value) {
  const n = Number(value || DEFAULT_CONFIG.apiDefaultLimit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CONFIG.apiDefaultLimit;
  return Math.min(DEFAULT_CONFIG.apiMaxLimit, Math.max(1, Math.floor(n)));
}

function clampUpstreamLimit_(value) {
  const n = Number(value || DEFAULT_CONFIG.upstreamMaxLimit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CONFIG.upstreamMaxLimit;
  return Math.min(DEFAULT_CONFIG.upstreamMaxLimit, Math.max(1, Math.floor(n)));
}

function parseCursorOffset_(cursor) {
  const raw = String(cursor || "").trim();
  if (!raw) return 0;
  try {
    const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    const offset = Number(parsed && parsed.offset);
    return Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
  } catch (e) {
    return 0;
  }
}

function encodeCursorOffset_(offset) {
  return Buffer.from(JSON.stringify({ offset: offset }), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseStringSet_(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const arr = raw.split(",").map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  return arr.length ? new Set(arr) : null;
}

function isTruthyQueryBoolean_(value) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function timeOrNull_(value) {
  if (value === null || value === undefined || value === "") return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function applyIfMissing_(obj, key, value) {
  if (!obj) return;
  if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return;
  if (value === undefined || value === null || value === "") return;
  obj[key] = value;
}

function copyIfPresent_(src, dest, key) {
  const value = src && src[key];
  if (value === undefined || value === null || value === "") return;
  dest[key] = value;
}

function extractDigits_(value) {
  return String(value == null ? "" : value).replace(/\D+/g, "");
}

function uniqueNumbers_(values) {
  const seen = {};
  const out = [];
  for (const value of values || []) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    const key = String(n);
    if (seen[key]) continue;
    seen[key] = true;
    out.push(n);
  }
  return out;
}

function compactObject_(obj) {
  const out = {};
  for (const key of Object.keys(obj || {})) {
    const value = obj[key];
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && !value.length) continue;
    if (value && typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length) continue;
    out[key] = value;
  }
  return out;
}

async function mapLimit_(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const out = new Array(list.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, Number(limit) || 1), list.length || 1);
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < list.length) {
      const index = next++;
      out[index] = await mapper(list[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function readRequiredEnv_(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new ProxyHttpError("Missing env: " + name, "missing_env", 500);
  }
  return value;
}

function readPositiveInt(name, fallback) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function readNonNegativeInt(name, fallback) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function buildResponseHeaders_(startedAt, options) {
  const elapsedMs = Date.now() - startedAt;
  const allowOrigin = process.env.CORS_ALLOW_ORIGIN || "*";
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-api-token",
    "access-control-max-age": "86400",
    "x-proxy-runtime": "vercel-node-fetch",
    "x-response-time-ms": String(elapsedMs)
  };

  const cacheSeconds = Number(options && options.cacheSeconds);
  if (Number.isFinite(cacheSeconds) && cacheSeconds > 0) {
    const value = "max-age=" + Math.floor(cacheSeconds) + ", stale-while-revalidate=" + Math.max(30, Math.floor(cacheSeconds * 2));
    headers["cdn-cache-control"] = value;
    headers["vercel-cdn-cache-control"] = value;
  }

  if (options && options.cacheTag) {
    headers["vercel-cache-tag"] = String(options.cacheTag);
  }

  return headers;
}

function truncateText_(value) {
  const text = String(value || "");
  return text.length > 1200 ? text.slice(0, 1200) + "..." : text;
}

function sleep_(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deepClone_(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function getSharedState_() {
  const key = "__pipedriveLiveProxyState";
  if (!globalThis[key]) {
    globalThis[key] = {
      cache: new Map(),
      pending: new Map()
    };
  }
  return globalThis[key];
}

function sanitizeUrlForLog(url) {
  try {
    const parsed = new URL(url || "/", "http://localhost");
    if (parsed.searchParams.has("api_token")) parsed.searchParams.set("api_token", "***");
    return parsed.pathname + parsed.search;
  } catch (e) {
    return String(url || "").replace(/api_token=[^&]+/g, "api_token=***");
  }
}

module.exports = {
  handleProxyRequest,
  handleWebRequest,
  handleNodeRequest,
  sanitizeUrlForLog
};
