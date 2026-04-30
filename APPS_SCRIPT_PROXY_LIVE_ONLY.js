// Production Realase Vercel - Davi Vieira 30/04/2026

/*
Standalone Apps Script Web App for a live Pipedrive readonly proxy.

Important:
- Deploy this file in a separate Apps Script project.
- Keep the real Pipedrive token only in Script Properties.
- Keep the public proxy token only in Script Properties.
- This proxy accepts GET only.
- If you want true read-only credentials on the Pipedrive side, prefer OAuth read scopes.

Required Script Properties:
- PIPEDRIVE_API_TOKEN
- PIPEDRIVE_PROXY_API_TOKEN
*/

const LIVE_PROXY_CONFIG = {
  domain: "smartleiloes",
  tokenKey: "PIPEDRIVE_API_TOKEN",
  proxyTokenKey: "PIPEDRIVE_PROXY_API_TOKEN",
  apiDefaultLimit: 100,
  apiMaxLimit: 500,
  upstreamMaxLimit: 100,
  apiReadonlyUpstreamCacheTtlSeconds: 60,
  apiDetailCacheTtlSeconds: 60,
  metadataCacheTtlSeconds: 21600
};

function doGet(e) {
  return handleLiveProxyWebRequest_(e, "GET");
}

function doPost(e) {
  return handleLiveProxyWebRequest_(e, "POST");
}

function handleLiveProxyWebRequest_(e, defaultMethod) {
  try {
    const req = normalizeLiveProxyRequest_(e, defaultMethod);

    if (!req.path || req.path === "/") {
      return jsonOutput_({
        success: true,
        data: {
          name: "Pipedrive Live Proxy API",
          mode: "readonly_live_upstream",
          data_source: "pipedrive_live",
          routes: [
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
          ],
          filters: [
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
          ],
          auth: "Use ?api_token=SEU_TOKEN_DA_PROXY"
        },
        additional_data: null
      });
    }

    if (req.path === "/health") {
      return jsonOutput_({
        success: true,
        data: {
          status: "ok",
          now: new Date().toISOString()
        },
        additional_data: null
      });
    }

    assertLiveProxyAuthorized_(req);

    if (req.method !== "GET") {
      return errorOutput_("This proxy is readonly and accepts GET only.", "readonly_only");
    }

    if (req.path === "/api/v2/deals/search") {
      return handleLiveDealsSearch_(req);
    }

    const dealMatch = String(req.path || "").match(/^\/api\/v2\/deals\/(\d+)$/);
    if (dealMatch) {
      return handleLiveDealDetails_(req, Number(dealMatch[1]));
    }

    if (!isAllowedLiveReadonlyPath_(req.path)) {
      return errorOutput_("Unsupported GET route for the readonly proxy.", "unsupported_route");
    }

    return proxyReadonlyUpstreamGet_(req);
  } catch (e) {
    return errorOutput_(String((e && e.message) || e), "proxy_error");
  }
}

function normalizeLiveProxyRequest_(e, defaultMethod) {
  const query = Object.assign({}, (e && e.parameter) || {});
  const overrideMethod = String(query._method || query.method || defaultMethod || "GET").trim().toUpperCase();
  const rawPath =
    (e && e.pathInfo ? String(e.pathInfo) : "") ||
    String(query.path || query.endpoint || "").replace(/^https?:\/\/[^/]+/i, "");

  return {
    method: overrideMethod,
    path: normalizeApiPath_(rawPath),
    query: query
  };
}

function normalizeApiPath_(rawPath) {
  const clean = String(rawPath || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\?.*$/, "");
  return clean ? "/" + clean : "/";
}

function assertLiveProxyAuthorized_(req) {
  const configured = String(PropertiesService.getScriptProperties().getProperty(LIVE_PROXY_CONFIG.proxyTokenKey) || "").trim();
  if (!configured) {
    throw new Error("Set PIPEDRIVE_PROXY_API_TOKEN in Script Properties.");
  }
  const incoming = String((req && req.query && req.query.api_token) || "").trim();
  if (!incoming || incoming !== configured) {
    throw new Error("Unauthorized. Use the proxy api_token.");
  }
}

function isAllowedLiveReadonlyPath_(path) {
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

function handleLiveDealDetails_(req, dealId) {
  const deal = getLiveDealById_(dealId);
  if (!deal) return errorOutput_("Deal not found.", "not_found");

  const lookups = buildLookups_();
  const shaped = shapeDealForApi_(deal, req.query || {});
  shaped.ai_summary = buildDealAiSummary_(shaped, lookups);
  const responseDeal = buildResponseDealPayload_(shaped);

  return jsonOutput_({
    success: true,
    data: responseDeal,
    additional_data: null
  });
}

function handleLiveDealsSearch_(req) {
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

function handleUpstreamDealsSearchWithEnrichment_(req) {
  const query = buildUpstreamQueryParams_(req.query || {});
  const searchJson = fetchReadonlyUpstreamJson_("/api/v2/deals/search", query);
  const items = searchJson && searchJson.data && Array.isArray(searchJson.data.items) ? searchJson.data.items : [];
  if (!items.length) return jsonOutput_(attachSearchTraceToSearchJson_(searchJson, req.query || {}, false));

  const lookups = buildLookups_();
  const enrichedItems = [];

  for (const result of items) {
    const originalItem = result && result.item ? result.item : null;
    const dealId = Number(originalItem && originalItem.id);
    if (!isFinite(dealId)) {
      enrichedItems.push(result);
      continue;
    }

    const deal = getLiveDealById_(dealId);
    if (!deal) {
      enrichedItems.push(result);
      continue;
    }

    const shaped = shapeDealForApi_(deal, req.query || {});
    shaped.ai_summary = buildDealAiSummary_(shaped, lookups);
    const searchItem = mergeSearchItem_(buildSearchItemFromDeal_(shaped), originalItem);
    const aiContext = buildAiDealContext_(searchItem, shaped, lookups);
    const responseDeal = buildResponseDealPayload_(shaped);
    const searchTrace = buildSearchTrace_(req.query || {}, true);

    enrichedItems.push(Object.assign({}, result, {
      item: searchItem,
      deal: responseDeal,
      ai_context: aiContext,
      matched_by: searchTrace.matched_by,
      search_term_normalized: searchTrace.search_term_normalized,
      correlation_found: searchTrace.correlation_found
    }));
  }

  const data = Object.assign({}, searchJson.data || {}, {
    items: enrichedItems,
    search_trace: buildSearchTrace_(req.query || {}, !!enrichedItems.length)
  });
  return jsonOutput_({
    success: searchJson && searchJson.success !== false,
    data: data,
    additional_data: searchJson && searchJson.additional_data !== undefined ? searchJson.additional_data : null
  });
}

function handleIdentityDealSearch_(req) {
  const query = (req && req.query) || {};
  const term = String(query.term || "").trim();
  const kinds = resolveIdentitySearchKinds_(term, query.search_by);
  if (!kinds.length) return handleUpstreamDealsSearchWithEnrichment_(req);

  const directResults = fetchDirectDealSearchCandidates_(query);
  const personIds = new Set();
  for (const kind of kinds) {
    const ids = findPersonIdsByIdentitySearch_(kind, term);
    for (const id of ids) personIds.add(id);
  }

  const personDeals = fetchDealsByPersonIds_(personIds, query);
  const merged = mergeIdentitySearchCandidates_(directResults, personDeals);
  const page = paginateCollection_(merged, query);
  const lookups = buildLookups_();
  const items = [];

  for (const candidate of page.items) {
    const shaped = shapeDealForApi_(candidate.deal, query);
    shaped.ai_summary = buildDealAiSummary_(shaped, lookups);
    const searchItem = candidate.searchItem || buildSearchItemFromDeal_(shaped);
    const responseDeal = buildResponseDealPayload_(shaped);
    const searchTrace = buildSearchTrace_(query, true);
    items.push({
      result_score: candidate.resultScore,
      item: searchItem,
      deal: responseDeal,
      ai_context: buildAiDealContext_(searchItem, shaped, lookups),
      matched_by: searchTrace.matched_by,
      search_term_normalized: searchTrace.search_term_normalized,
      correlation_found: searchTrace.correlation_found
    });
  }

  return jsonOutput_({
    success: true,
    data: {
      items: items,
      search_trace: buildSearchTrace_(query, !!merged.length)
    },
    additional_data: {
      next_cursor: page.pagination.next_cursor
    }
  });
}

function fetchDirectDealSearchCandidates_(query) {
  const upstream = buildUpstreamQueryParams_(query || {});
  delete upstream.cursor;
  upstream.limit = LIVE_PROXY_CONFIG.upstreamMaxLimit;

  const json = fetchReadonlyUpstreamJson_("/api/v2/deals/search", upstream);
  const items = json && json.data && Array.isArray(json.data.items) ? json.data.items : [];
  const out = [];

  for (const result of items) {
    const originalItem = result && result.item ? result.item : null;
    const dealId = Number(originalItem && originalItem.id);
    if (!isFinite(dealId)) continue;
    const deal = getLiveDealById_(dealId);
    if (!deal) continue;

    out.push({
      dealId: dealId,
      deal: deal,
      searchItem: mergeSearchItem_(buildSearchItemFromDeal_(deal), originalItem),
      resultScore: result && result.result_score != null ? Number(result.result_score) : 1
    });
  }

  return out;
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

function findPersonIdsByIdentitySearch_(kind, term) {
  const normalized = normalizeIdentitySearchTerm_(kind, term);
  if (!normalized) return [];

  const query = {
    term: normalized,
    exact_match: true,
    limit: 100,
    fields: kind === "email" ? "email,custom_fields" : "custom_fields"
  };

  const json = fetchReadonlyUpstreamJson_("/api/v2/persons/search", query);
  const items = json && json.data && Array.isArray(json.data.items) ? json.data.items : [];
  const ids = [];

  for (const result of items) {
    const item = result && result.item ? result.item : null;
    const personId = Number(item && item.id);
    if (isFinite(personId)) ids.push(personId);
  }

  return uniqueNumbers_(ids);
}

function fetchDealsByPersonIds_(personIds, query) {
  const ids = uniqueNumbers_(Array.from(personIds || []));
  const out = [];

  for (const personId of ids) {
    const params = buildLiveDealsListParamsForPerson_(personId, query);
    const deals = fetchAllV2_("/deals", params);
    for (const rawDeal of deals) {
      const deal = enrichLiveDeal_(rawDeal);
      if (!deal || deal.id == null) continue;
      out.push({
        dealId: Number(deal.id),
        deal: deal,
        searchItem: null,
        resultScore: 0.9
      });
    }
  }

  return out;
}

function buildLiveDealsListParamsForPerson_(personId, query) {
  const q = query || {};
  const out = {
    person_id: personId,
    limit: LIVE_PROXY_CONFIG.upstreamMaxLimit
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
    .map(key => byId[key])
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

function getLiveDealById_(dealId) {
  const cacheKey = ["pd_live_proxy", "deal_detail", String(dealId)].join(":");
  return getCached_(cacheKey, LIVE_PROXY_CONFIG.apiDetailCacheTtlSeconds, function() {
    const json = fetchReadonlyUpstreamJson_("/api/v2/deals/" + Number(dealId), {});
    const data = json && json.data ? json.data : null;
    return data ? enrichLiveDeal_(data) : null;
  });
}

function enrichLiveDeal_(rawDeal) {
  const normalized = normalizeLiveDealShape_(rawDeal);
  const fieldMaps = getDealFieldMaps_();
  return enrichDealWithReadableFields_(normalized, fieldMaps, null);
}

function normalizeLiveDealShape_(deal) {
  const out = JSON.parse(JSON.stringify(deal || {}));
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

function buildLookups_() {
  return getCached_("PD_LIVE_PROXY_LOOKUPS_V1", LIVE_PROXY_CONFIG.metadataCacheTtlSeconds, function() {
    const pipelines = {};
    const pipelineArr = fetchAllV2_("/pipelines", { limit: LIVE_PROXY_CONFIG.upstreamMaxLimit });
    for (const item of pipelineArr) {
      if (item && item.id != null) pipelines[String(item.id)] = String(item.name || "");
    }

    const stages = {};
    const stageArr = fetchAllV2_("/stages", { limit: LIVE_PROXY_CONFIG.upstreamMaxLimit });
    for (const item of stageArr) {
      if (item && item.id != null) stages[String(item.id)] = String(item.name || "");
    }

    const users = {};
    const usersJson = pipedriveGetV1_("/users", {});
    const usersArr = usersJson && usersJson.data ? usersJson.data : [];
    for (const item of usersArr) {
      if (item && item.id != null) users[String(item.id)] = String(item.name || "");
    }

    return {
      pipelines: pipelines,
      stages: stages,
      users: users,
      dealFields: getDealFieldsList_()
    };
  });
}

function getDealFieldsList_() {
  return getCached_("PD_LIVE_PROXY_DEAL_FIELDS_V1", LIVE_PROXY_CONFIG.metadataCacheTtlSeconds, function() {
    try {
      const json = pipedriveGetV1_("/dealFields", {});
      const data = json && json.data ? json.data : [];
      if (data.length) return data.map(normalizeDealFieldDefinition_).filter(Boolean);
    } catch (e) {}

    try {
      return fetchAllV2_("/dealFields", { limit: LIVE_PROXY_CONFIG.upstreamMaxLimit }).map(normalizeDealFieldDefinition_).filter(Boolean);
    } catch (e) {}

    return [];
  });
}

function getDealFieldMaps_() {
  return getCached_("PD_LIVE_PROXY_DEAL_FIELD_MAPS_V1", LIVE_PROXY_CONFIG.metadataCacheTtlSeconds, function() {
    const byKey = {};
    const byName = {};
    const fields = getDealFieldsList_();
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
  const base = JSON.parse(JSON.stringify(fallbackItem || {}));
  const original = originalItem && typeof originalItem === "object" ? JSON.parse(JSON.stringify(originalItem)) : {};
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

function enrichDealWithReadableFields_(deal, fieldMaps, rowMap) {
  const out = JSON.parse(JSON.stringify(deal || {}));
  const customFields = out && out.custom_fields && typeof out.custom_fields === "object" && !Array.isArray(out.custom_fields)
    ? out.custom_fields
    : null;

  applySheetLabelsToDeal_(out, rowMap);

  const sheetViews = buildSheetReadableFieldViews_(rowMap);
  const readable = Object.assign({}, sheetViews.readable);
  const rawByName = Object.assign({}, sheetViews.rawByName);
  const metaByKey = {};
  const keyMap = fieldMaps && fieldMaps.byKey ? fieldMaps.byKey : {};

  if (customFields) {
    for (const key of Object.keys(customFields)) {
      const meta = keyMap[key] || { key: key, name: key, field_type: "" };
      const value = customFields[key];
      const label = uniqueReadableFieldName_(readable, meta.name, key);
      const display = readable[label] !== undefined
        ? {
            display_value: readable[label],
            normalized_value: simplifyReadableValue_(readable[label])
          }
        : resolveReadableFieldValue_(value, meta);

      if (readable[label] === undefined) readable[label] = display.display_value;
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
  const out = JSON.parse(JSON.stringify(deal || {}));
  delete out.custom_fields;
  delete out.custom_fields_by_name;
  delete out.custom_fields_raw_by_name;
  delete out.custom_fields_meta;
  return out;
}

function applySheetLabelsToDeal_(deal, rowMap) {
  if (!deal || !rowMap) return;
  applyIfMissing_(deal, "org_name", rowMap["Negocio - Organizacao"]);
  applyIfMissing_(deal, "person_name", rowMap["Negocio - Pessoa de contato"]);
  applyIfMissing_(deal, "owner_name", rowMap["Negocio - Proprietario"]);
  applyIfMissing_(deal, "creator_user_name", rowMap["Negocio - Criado por"]);
  applyIfMissing_(deal, "pipeline_name", rowMap["Negocio - Funil"]);
  applyIfMissing_(deal, "stage_name", rowMap["Negocio - Etapa"]);
}

function buildSheetReadableFieldViews_(rowMap) {
  const readable = {};
  const rawByName = {};
  if (!rowMap) return { readable: readable, rawByName: rawByName };

  for (const header of Object.keys(rowMap)) {
    if (!isCustomSheetFieldHeader_(header)) continue;
    const value = rowMap[header];
    if (value === null || value === undefined || value === "") continue;
    const label = uniqueReadableFieldName_(readable, stripDealSheetPrefix_(header), header);
    readable[label] = value;
    rawByName[label] = value;
  }

  return { readable: readable, rawByName: rawByName };
}

function isCustomSheetFieldHeader_(header) {
  const text = String(header || "").trim();
  return !!text && text.indexOf("Negocio - ") === 0;
}

function stripDealSheetPrefix_(header) {
  return String(header || "").replace(/^Negocio - /, "").trim();
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
    return value.map(function(item) {
      const mapped = optionsById[String(item)];
      return mapped !== undefined ? mapped : item;
    });
  }

  if (fieldType === "set" && typeof value === "string" && value.indexOf(",") !== -1 && Object.keys(optionsById).length) {
    return value.split(",").map(function(item) {
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

function proxyReadonlyUpstreamGet_(req) {
  const path = String(req.path || "");
  const query = buildUpstreamQueryParams_(req.query || {});
  const json = fetchReadonlyUpstreamJson_(path, query);
  return jsonOutput_(json);
}

function fetchReadonlyUpstreamJson_(path, query) {
  const cacheKey = buildReadonlyUpstreamCacheKey_(path, query);
  return getCached_(cacheKey, LIVE_PROXY_CONFIG.apiReadonlyUpstreamCacheTtlSeconds, function() {
    if (String(path || "").indexOf("/api/v2/") === 0) {
      return pipedriveGetV2_(String(path || "").substring("/api/v2".length), query);
    }
    if (String(path || "").indexOf("/v1/") === 0) {
      return pipedriveGetV1_(String(path || "").substring("/v1".length), query);
    }
    throw new Error("Invalid readonly upstream route.");
  });
}

function pipedriveGetV2_(path, params) {
  return fetchJsonWithRetry_("https://" + LIVE_PROXY_CONFIG.domain + ".pipedrive.com/api/v2" + path, params);
}

function pipedriveGetV1_(path, params) {
  return fetchJsonWithRetry_("https://" + LIVE_PROXY_CONFIG.domain + ".pipedrive.com/api/v1" + path, params);
}

function fetchJsonWithRetry_(baseUrl, params) {
  const token = String(PropertiesService.getScriptProperties().getProperty(LIVE_PROXY_CONFIG.tokenKey) || "").trim();
  if (!token) throw new Error("Set PIPEDRIVE_API_TOKEN in Script Properties.");

  const qs = buildQuery_(Object.assign({ api_token: token }, params || {}));
  const url = baseUrl + "?" + qs;
  let attempt = 0;
  let lastErr = null;

  while (attempt < 6) {
    attempt++;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = resp.getResponseCode();
    const text = resp.getContentText();

    if (code >= 200 && code < 300) {
      const json = JSON.parse(text);
      if (json && json.success === false) throw new Error(text);
      return json;
    }

    const retryable = code === 429 || (code >= 500 && code <= 599);
    if (!retryable) throw new Error("HTTP " + code + ": " + text);

    lastErr = new Error("HTTP " + code + ": " + text);
    Utilities.sleep(Math.min(30000, 500 * Math.pow(2, attempt)));
  }

  throw lastErr || new Error("Upstream fetch failed.");
}

function fetchAllV2_(path, params) {
  const base = Object.assign({}, params || {});
  if (base.limit !== undefined) base.limit = clampUpstreamLimit_(base.limit);
  let cursor = base.cursor ? String(base.cursor) : "";
  const out = [];

  while (true) {
    const query = Object.assign({}, base, { cursor: cursor || undefined });
    const json = pipedriveGetV2_(path, query);
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

function getCached_(key, ttlSeconds, builder) {
  const cache = CacheService.getScriptCache();
  try {
    const value = cache.get(key);
    if (value) return JSON.parse(value);
  } catch (e) {}

  const built = builder();
  try {
    const serialized = JSON.stringify(built);
    if (serialized.length <= 90000) cache.put(key, serialized, ttlSeconds);
  } catch (e) {}
  return built;
}

function buildQuery_(obj) {
  const parts = [];
  for (const key of Object.keys(obj || {})) {
    const value = obj[key];
    if (value === undefined || value === null || value === "") continue;
    parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
  }
  return parts.join("&");
}

function shapeDealForApi_(deal, query) {
  const out = JSON.parse(JSON.stringify(deal || {}));
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
  const n = Number(value || LIVE_PROXY_CONFIG.apiDefaultLimit);
  if (!isFinite(n) || n <= 0) return LIVE_PROXY_CONFIG.apiDefaultLimit;
  return Math.min(LIVE_PROXY_CONFIG.apiMaxLimit, Math.max(1, Math.floor(n)));
}

function clampUpstreamLimit_(value) {
  const n = Number(value || LIVE_PROXY_CONFIG.upstreamMaxLimit);
  if (!isFinite(n) || n <= 0) return LIVE_PROXY_CONFIG.upstreamMaxLimit;
  return Math.min(LIVE_PROXY_CONFIG.upstreamMaxLimit, Math.max(1, Math.floor(n)));
}

function parseCursorOffset_(cursor) {
  const raw = String(cursor || "").trim();
  if (!raw) return 0;
  try {
    const decoded = Utilities.newBlob(Utilities.base64DecodeWebSafe(raw)).getDataAsString();
    const parsed = JSON.parse(decoded);
    const offset = Number(parsed && parsed.offset);
    return isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
  } catch (e) {
    return 0;
  }
}

function encodeCursorOffset_(offset) {
  return Utilities.base64EncodeWebSafe(JSON.stringify({ offset: offset }));
}

function parseStringSet_(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const arr = raw.split(",").map(function(item) {
    return String(item || "").trim().toLowerCase();
  }).filter(Boolean);
  return arr.length ? new Set(arr) : null;
}

function isTruthyQueryBoolean_(value) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function timeOrNull_(value) {
  if (value === null || value === undefined || value === "") return null;
  const t = new Date(value).getTime();
  return isFinite(t) ? t : null;
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
    if (!isFinite(n)) continue;
    const key = String(n);
    if (seen[key]) continue;
    seen[key] = true;
    out.push(n);
  }
  return out;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorOutput_(message, info) {
  return jsonOutput_({
    success: false,
    error: message,
    error_info: info || "",
    data: null,
    additional_data: null
  });
}
