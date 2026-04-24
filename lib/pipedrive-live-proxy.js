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
  maxCacheEntries: readPositiveInt("PIPEDRIVE_PROXY_MAX_CACHE_ENTRIES", 1000)
};

const ROUTES = [
  "/health",
  "/api/v2/deals",
  "/api/v2/deals/{id}",
  "/api/v2/deals/products",
  "/api/v2/deals/search",
  "/api/v2/persons",
  "/api/v2/persons/{id}",
  "/api/v2/organizations",
  "/api/v2/organizations/{id}",
  "/api/v2/pipelines",
  "/api/v2/stages",
  "/v1/users",
  "/v1/dealFields"
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
  const configured = readRequiredEnv_(DEFAULT_CONFIG.proxyTokenKey);
  const incoming =
    String(req.query.api_token || "").trim() ||
    parseBearerToken_(req.headers.authorization) ||
    String(req.headers["x-api-token"] || "").trim();

  if (!incoming || incoming !== configured) {
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
    p === "/v1/dealFields"
  );
}

async function handleDealDetails_(req, dealId) {
  const deal = await getLiveDealById_(dealId);
  if (!deal) throw new ProxyHttpError("Deal not found.", "not_found", 404);

  const lookups = await buildLookups_();
  const shaped = shapeDealForApi_(deal, req.query || {});
  shaped.ai_summary = buildDealAiSummary_(shaped, lookups);

  return {
    success: true,
    data: buildResponseDealPayload_(shaped),
    additional_data: null
  };
}

async function handleDealsSearch_(req) {
  const query = (req && req.query) || {};
  if (shouldUseIdentityDealSearch_(query)) {
    return handleIdentityDealSearch_(req);
  }
  return handleUpstreamDealsSearchWithEnrichment_(req);
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
    if (!Number.isFinite(dealId)) return result;

    const deal = await getLiveDealById_(dealId);
    if (!deal) return result;

    const shaped = shapeDealForApi_(deal, req.query || {});
    shaped.ai_summary = buildDealAiSummary_(shaped, lookups);
    const searchItem = mergeSearchItem_(buildSearchItemFromDeal_(shaped), originalItem);
    const searchTrace = buildSearchTrace_(req.query || {}, true);

    return Object.assign({}, result, {
      item: searchItem,
      deal: buildResponseDealPayload_(shaped),
      ai_context: buildAiDealContext_(searchItem, shaped, lookups),
      matched_by: searchTrace.matched_by,
      search_term_normalized: searchTrace.search_term_normalized,
      correlation_found: searchTrace.correlation_found
    });
  });

  return {
    success: searchJson && searchJson.success !== false,
    data: Object.assign({}, searchJson.data || {}, {
      items: enrichedItems,
      search_trace: buildSearchTrace_(req.query || {}, !!enrichedItems.length)
    }),
    additional_data: searchJson && searchJson.additional_data !== undefined ? searchJson.additional_data : null
  };
}

async function handleIdentityDealSearch_(req) {
  const query = (req && req.query) || {};
  const term = String(query.term || "").trim();
  const kinds = resolveIdentitySearchKinds_(term, query.search_by);
  if (!kinds.length) return handleUpstreamDealsSearchWithEnrichment_(req);

  const directPromise = fetchDirectDealSearchCandidates_(query);
  const personIdsPromise = Promise.all(kinds.map((kind) => findPersonIdsByIdentitySearch_(kind, term)));
  const [directResults, personIdLists] = await Promise.all([directPromise, personIdsPromise]);
  const personIds = uniqueNumbers_(personIdLists.flat());
  const personDeals = await fetchDealsByPersonIds_(personIds, query);
  const merged = mergeIdentitySearchCandidates_(directResults, personDeals);
  const page = paginateCollection_(merged, query);
  const lookups = await buildLookups_();

  const items = page.items.map((candidate) => {
    const shaped = shapeDealForApi_(candidate.deal, query);
    shaped.ai_summary = buildDealAiSummary_(shaped, lookups);
    const searchItem = candidate.searchItem || buildSearchItemFromDeal_(shaped);
    const searchTrace = buildSearchTrace_(query, true);

    return {
      result_score: candidate.resultScore,
      item: searchItem,
      deal: buildResponseDealPayload_(shaped),
      ai_context: buildAiDealContext_(searchItem, shaped, lookups),
      matched_by: searchTrace.matched_by,
      search_term_normalized: searchTrace.search_term_normalized,
      correlation_found: searchTrace.correlation_found
    };
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
    const digits = extractDigits_(text);
    return /^\d{11}$/.test(digits) || /^\d{14}$/.test(digits) ? digits : "";
  }

  if (kind === "cnpj") {
    const digits = extractDigits_(text);
    return /^\d{14}$/.test(digits) ? digits : "";
  }

  if (kind === "email") {
    const normalized = text.toLowerCase();
    return /^[^\s@<>]+@[^\s@<>]+$/.test(normalized) ? normalized : "";
  }

  return "";
}

async function findPersonIdsByIdentitySearch_(kind, term) {
  const normalized = normalizeIdentitySearchTerm_(kind, term);
  if (!normalized) return [];

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
    if (Number.isFinite(personId)) ids.push(personId);
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
  return enrichDealWithReadableFields_(normalized, fieldMaps);
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

async function getDealFieldMaps_() {
  return getCached_("PD_LIVE_PROXY_DEAL_FIELD_MAPS_V2", DEFAULT_CONFIG.metadataCacheTtlSeconds, async () => {
    const byKey = {};
    const byName = {};
    const fields = await getDealFieldsList_();
    for (const field of fields) {
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
  });
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

function buildResponseDealPayload_(deal) {
  const out = deepClone_(deal || {});
  delete out.custom_fields;
  delete out.custom_fields_by_name;
  delete out.custom_fields_raw_by_name;
  delete out.custom_fields_meta;
  return out;
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
    workflow: summary.workflow,
    notes: {
      count: notes.length,
      latest: notes.slice(0, 10)
    },
    important_custom_fields: important,
    available_payloads: {
      custom_fields_readable: true,
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
      owner_name: deal.owner_name || lookupName_(lookups && lookups.users, deal.owner_id)
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

function extractPropertyCode_(deal) {
  const normalizedByName = normalizeCustomFieldsByName_(deal && deal.custom_fields_by_name);
  const candidates = [
    "numero do imovel",
    "codigo do imovel"
  ];

  for (const name of candidates) {
    if (normalizedByName[name] !== undefined && normalizedByName[name] !== null && normalizedByName[name] !== "") {
      return normalizedByName[name];
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
