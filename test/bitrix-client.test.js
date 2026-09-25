"use strict";

const assert = require("assert/strict");
const { createBitrixClient } = require("../lib/bitrix-client.js");

async function main() {
  let calledUrl = "";
  let calledBody = null;
  const client = createBitrixClient({
    config: { webhookBaseUrl: "https://portal.bitrix24.com.br/rest/1/secret/", memberId: "portal-1", retries: 0 },
    fetchImpl: async (url, options) => {
      calledUrl = String(url); calledBody = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ result: { sessionId: 321 } }) };
    }
  });
  const result = await client.callMethod("portal-1", "imopenlines.session.history.get", { SESSION_ID: 321 });
  assert.equal(result.sessionId, 321);
  assert.ok(calledUrl.endsWith("/imopenlines.session.history.get.json"));
  assert.equal(calledBody.SESSION_ID, 321);
  await assert.rejects(() => client.callMethod("other", "profile", {}), /bitrix_member_not_allowed/);

  let installation = { member_id: "portal-1", client_endpoint: "https://portal.bitrix24.com.br/rest/", server_endpoint: "https://oauth.bitrix.info/rest/", access_token: "old", refresh_token: "refresh-old" };
  const calls = [];
  const oauth = createBitrixClient({
    config: { clientId: "client", clientSecret: "secret", retries: 0 },
    installationRepository: {
      getByMemberId: async () => installation,
      updateTokens: async (_, tokens) => { installation = Object.assign({}, installation, tokens); return installation; }
    },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), body: options.body });
      if (String(url).includes("oauth/token")) return { ok: true, status: 200, json: async () => ({ access_token: "new", refresh_token: "refresh-new", expires_in: 3600 }) };
      if (JSON.parse(options.body).auth === "old") return { ok: true, status: 200, json: async () => ({ error: "expired_token" }) };
      return { ok: true, status: 200, json: async () => ({ result: { ok: true } }) };
    }
  });
  assert.deepEqual(await oauth.callMethod("portal-1", "profile", {}), { ok: true });
  assert.equal(installation.refresh_token, "refresh-new");
  assert.equal(calls.length, 3);

  let proactiveInstallation = {
    member_id: "portal-1",
    client_endpoint: "https://portal.bitrix24.com.br/rest/",
    server_endpoint: "https://oauth.bitrix.info/rest/",
    access_token: "stale",
    refresh_token: "refresh-stale",
    expires_at: Date.now() - 1000
  };
  const proactiveCalls = [];
  const proactive = createBitrixClient({
    config: { clientId: "client", clientSecret: "secret", retries: 0, refreshSkewMs: 60000 },
    installationRepository: {
      getByMemberId: async () => proactiveInstallation,
      updateTokens: async (_, tokens) => {
        proactiveInstallation = Object.assign({}, proactiveInstallation, tokens);
        return proactiveInstallation;
      }
    },
    fetchImpl: async (url, options) => {
      proactiveCalls.push({ url: String(url), body: options.body });
      if (String(url).includes("oauth/token")) {
        return { ok: true, status: 200, json: async () => ({ access_token: "fresh", refresh_token: "refresh-fresh", expires_in: 3600 }) };
      }
      assert.equal(JSON.parse(options.body).auth, "fresh");
      return { ok: true, status: 200, json: async () => ({ result: { refreshed: true } }) };
    }
  });
  assert.deepEqual(await proactive.callMethod("portal-1", "profile", {}), { refreshed: true });
  assert.equal(proactiveCalls.length, 2);
  assert.ok(proactiveCalls[0].url.includes("oauth/token"));
  assert.equal(proactiveInstallation.refresh_token, "refresh-fresh");

  const missingCredentials = createBitrixClient({
    config: { clientId: "", clientSecret: "", retries: 0, refreshSkewMs: 60000 },
    installationRepository: {
      getByMemberId: async () => Object.assign({}, proactiveInstallation, { expires_at: Date.now() - 1000 }),
      updateTokens: async () => { throw new Error("unexpected_update"); }
    }
  });
  await assert.rejects(
    () => missingCredentials.callMethod("portal-1", "profile", {}),
    /bitrix_oauth_client_credentials_missing/
  );
  console.log("ok bitrix-client");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
