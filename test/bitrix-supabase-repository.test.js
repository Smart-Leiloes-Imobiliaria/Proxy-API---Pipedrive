"use strict";

const assert = require("assert/strict");
const { createBitrixSupabaseRepository } = require("../lib/bitrix-supabase-repository.js");

async function main() {
  const encryptionKey = Buffer.alloc(32, 7).toString("base64");
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), method: options.method, body: options.body || "" });
    const input = options.body ? JSON.parse(options.body) : null;
    if (options.method === "POST" && String(url).includes("bitrix_installations")) {
      return response_(200, [Object.assign({ created_at: new Date().toISOString() }, input)]);
    }
    return response_(200, []);
  };
  const repository = createBitrixSupabaseRepository({
    supabaseUrl: "https://project-ref.supabase.co",
    supabaseSecretKey: "sb_secret_test_value",
    encryptionKey,
    fetchImpl
  });
  const installation = await repository.saveInstallation({
    member_id: "member-real", domain: "smartcaixa.bitrix24.com.br",
    client_endpoint: "https://smartcaixa.bitrix24.com.br/rest/", server_endpoint: "https://oauth.bitrix.info/rest/",
    scope: "imopenlines", access_token: "plain-access", refresh_token: "plain-refresh",
    application_token: "plain-app", expires_in: 3600
  });
  assert.equal(installation.access_token, "plain-access");
  assert.equal(installation.refresh_token, "plain-refresh");
  assert.equal(installation.application_token, "plain-app");
  assert.ok(!requests[0].body.includes("plain-access"));
  assert.ok(!requests[0].body.includes("plain-refresh"));
  assert.ok(!requests[0].body.includes("plain-app"));
  assert.ok(requests[0].body.includes("access_token_ciphertext"));
  console.log("ok bitrix-supabase-repository");
}

function response_(status, payload) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
