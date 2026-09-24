"use strict";

function createBitrixClient(options) {
  const opt = options || {};
  const fetchImpl = opt.fetchImpl || global.fetch;
  const config = opt.config || {};
  const installationRepository = opt.installationRepository;

  async function callMethod(memberId, method, params) {
    const installation = installationRepository && await installationRepository.getByMemberId(String(memberId));
    if (installation) return callOAuth_(installation, method, params || {}, true);

    const expectedMemberId = clean_(config.memberId || process.env.BITRIX_MEMBER_ID);
    if (expectedMemberId && clean_(memberId) !== expectedMemberId) throw error_("bitrix_member_not_allowed", 403);
    const webhookBaseUrl = clean_(config.webhookBaseUrl || process.env.BITRIX_WEBHOOK_BASE_URL);
    if (!webhookBaseUrl) throw error_("bitrix_installation_not_found", 500);
    return request_(joinMethod_(webhookBaseUrl, method), params || {}, "webhook");
  }

  async function callOAuth_(installation, method, params, allowRefresh) {
    const endpoint = trustedClientEndpoint_(installation.client_endpoint);
    try {
      return await request_(joinMethod_(endpoint, method), Object.assign({}, params, { auth: installation.access_token }), "oauth");
    } catch (error) {
      if (!allowRefresh || !isExpired_(error)) throw error;
      const refreshed = await refresh_(installation);
      return callOAuth_(refreshed, method, params, false);
    }
  }

  async function refresh_(installation) {
    if (!installation.refresh_token || !installationRepository || !installationRepository.updateTokens) throw error_("bitrix_oauth_refresh_unavailable", 502);
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clean_(config.clientId || process.env.BITRIX_CLIENT_ID),
      client_secret: clean_(config.clientSecret || process.env.BITRIX_CLIENT_SECRET),
      refresh_token: installation.refresh_token
    }).toString();
    const serverEndpoint = new URL(clean_(installation.server_endpoint || config.serverEndpoint || "https://oauth.bitrix.info/rest/"));
    const authUrl = serverEndpoint.origin + "/oauth/token/";
    const response = await rawRequest_(authUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    if (!response.access_token || !response.refresh_token) throw error_("bitrix_oauth_refresh_failed", 502);
    return installationRepository.updateTokens(installation.member_id, {
      access_token: response.access_token,
      refresh_token: response.refresh_token,
      expires_at: Date.now() + Number(response.expires_in || 3600) * 1000
    });
  }

  async function request_(url, payload, authMode) {
    const retries = Math.max(0, Number(config.retries != null ? config.retries : process.env.BITRIX_FETCH_RETRIES || 2));
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await rawRequest_(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(payload) });
      } catch (error) {
        lastError = error;
        if (!retryable_(error) || attempt === retries) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000, 100 * (2 ** attempt))));
      }
    }
    if (lastError && authMode) lastError.authMode = authMode;
    throw lastError;
  }

  async function rawRequest_(url, requestOptions) {
    let response;
    try {
      response = await fetchImpl(url, Object.assign({}, requestOptions, { signal: AbortSignal.timeout(Number(config.timeoutMs || process.env.BITRIX_FETCH_TIMEOUT_MS || 10000)) }));
    } catch (_) {
      throw error_("bitrix_timeout", 504);
    }
    let body = null;
    try { body = await response.json(); } catch (_) {}
    if (!response.ok || body && body.error) {
      const code = clean_(body && body.error) || "bitrix_http_" + response.status;
      const status = /expired_token/i.test(code) ? 401 : /QUERY_LIMIT_EXCEEDED|OVERLOAD_LIMIT/i.test(code) ? 429 : response.status === 429 ? 429 : response.status >= 400 && response.status < 500 ? response.status : 502;
      const error = error_(code, status);
      error.upstreamCode = code;
      throw error;
    }
    return body && Object.prototype.hasOwnProperty.call(body, "result") ? body.result : body;
  }

  return { callMethod };
}

function trustedClientEndpoint_(value) {
  const parsed = new URL(clean_(value));
  if (parsed.protocol !== "https:" || !/\.bitrix24\.(com|com\.br|eu|de|fr|es|in|cn)$/.test(parsed.hostname)) throw error_("bitrix_untrusted_client_endpoint", 500);
  return parsed.toString();
}
function joinMethod_(base, method) { return String(base).replace(/\/$/, "") + "/" + encodeURIComponent(String(method)) + ".json"; }
function isExpired_(error) { return error && (error.statusCode === 401 || /expired_token/i.test(error.upstreamCode || error.code || "")); }
function retryable_(error) { return error && (error.statusCode === 429 || error.statusCode >= 500 || /QUERY_LIMIT_EXCEEDED|OVERLOAD_LIMIT/i.test(error.upstreamCode || error.code || "")); }
function clean_(value) { return String(value == null ? "" : value).trim(); }
function error_(code, statusCode) { const error = new Error(code); error.code = code; error.statusCode = statusCode; return error; }

module.exports = { createBitrixClient };
