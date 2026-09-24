"use strict";

const assert = require("assert/strict");
const proxy = require("../lib/pipedrive-live-proxy.js");

async function main() {
  process.env.BITRIX_INTERNAL_TOKEN = "handler-token";
  process.env.BITRIX_ALLOWED_SESSION_IDS = "321";
  const response = await proxy.handleProxyRequest({
    method: "GET", url: "https://proxy.test/api/bitrix/avaliar-atendimento",
    headers: { authorization: "Bearer handler-token" }, body: ""
  });
  assert.equal(response.status, 405);
  const root = await proxy.handleProxyRequest({ method: "GET", url: "https://proxy.test/", headers: {}, body: "" });
  assert.ok(JSON.parse(root.body).data.routes.includes("/api/bitrix/avaliar-atendimento"));
  assert.ok(JSON.parse(root.body).data.routes.includes("/api/bitrix/install"));
  assert.ok(JSON.parse(root.body).data.routes.includes("/api/bitrix/events"));
  assert.ok(JSON.parse(root.body).data.routes.includes("/api/bitrix/processar-fila"));
  console.log("ok bitrix-event-handler routes");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
