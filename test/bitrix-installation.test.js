"use strict";

const assert = require("assert/strict");
const { handleBitrixInstallation, normalizeAuth_ } = require("../lib/bitrix-installation.js");
const { parseBitrixRequestBody } = require("../lib/bitrix-request.js");

process.env.BITRIX_PORTAL_DOMAIN = "smartcaixa.bitrix24.com.br";
process.env.BITRIX_SINGLE_TENANT = "true";

const auth = {
  access_token: "access-secret",
  refresh_token: "refresh-secret",
  expires_in: 3600,
  scope: "imopenlines",
  domain: "smartcaixa.bitrix24.com.br",
  server_endpoint: "https://oauth.bitrix.info/rest/",
  client_endpoint: "https://smartcaixa.bitrix24.com.br/rest/",
  member_id: "member-real",
  application_token: "application-secret"
};

async function main() {
  const parsed = parseBitrixRequestBody("auth%5Bmember_id%5D=member-real&data%5BDATA%5D%5B0%5D%5Bsession%5D%5Bid%5D=321");
  assert.equal(parsed.auth.member_id, "member-real");
  assert.equal(parsed.data.DATA["0"].session.id, "321");

  const saved = [];
  const repository = {
    getByMemberId: async () => null,
    countInstallations: async () => 0,
    saveInstallation: async (value) => { saved.push(value); return value; },
    updateBinding: async () => {}
  };
  const services = {
    installationRepository: repository,
    verifyAuth: async () => true,
    bindOnSessionFinish: async () => true
  };

  let result = await handleBitrixInstallation({ method: "POST", body: JSON.stringify({ auth }) }, services);
  assert.equal(result.status, 200);
  assert.equal(result.payload.status, "installed");
  assert.deepEqual(result.payload.events_bound, ["ONSESSIONFINISH"]);
  assert.equal(saved[0].member_id, "member-real");
  assert.ok(!JSON.stringify(result.payload).includes("access-secret"));
  assert.ok(!JSON.stringify(result.payload).includes("refresh-secret"));

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(auth)) form.set("auth[" + key + "]", String(value));
  result = await handleBitrixInstallation({ method: "POST", body: form.toString() }, services);
  assert.equal(result.payload.status, "installed");

  repository.getByMemberId = async () => ({ member_id: "member-real" });
  repository.countInstallations = async () => { throw new Error("must_not_count_on_reinstall"); };
  result = await handleBitrixInstallation({ method: "POST", body: JSON.stringify({ auth }) }, services);
  assert.equal(result.payload.status, "installed");
  assert.equal(saved.length, 3);

  const missing = Object.assign({}, auth); delete missing.application_token;
  result = await handleBitrixInstallation({ method: "POST", body: JSON.stringify({ auth: missing }) }, services);
  assert.equal(result.status, 400);
  assert.equal(result.payload.error, "missing_application_token");

  const legacy = normalizeAuth_({ AUTH_ID: "a", REFRESH_ID: "r", AUTH_EXPIRES: "60", DOMAIN: auth.domain, SERVER_ENDPOINT: auth.server_endpoint, APPLICATION_TOKEN: "t", APPLICATION_SCOPE: "imopenlines", member_id: "m" });
  assert.equal(legacy.client_endpoint, auth.client_endpoint);
  assert.equal(legacy.server_endpoint, auth.server_endpoint);
  assert.equal(legacy.application_token, "t");
  assert.equal(legacy.scope, "imopenlines");
  result = await handleBitrixInstallation({ method: "GET", body: "" }, services);
  assert.equal(result.status, 405);
  console.log("ok bitrix-installation");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
