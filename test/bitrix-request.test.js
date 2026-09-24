"use strict";

const assert = require("assert/strict");
const { parseBitrixRequestBody } = require("../lib/bitrix-request.js");

function main() {
  assert.deepEqual(parseBitrixRequestBody('{"auth":{"member_id":"m"}}'), { auth: { member_id: "m" } });
  const form = parseBitrixRequestBody("auth%5Bmember_id%5D=m&data%5BDATA%5D%5B0%5D%5Bsession%5D%5Bid%5D=42");
  assert.equal(form.auth.member_id, "m");
  assert.equal(form.data.DATA["0"].session.id, "42");
  assert.throws(() => parseBitrixRequestBody("{"), /invalid_json/);
  assert.throws(() => parseBitrixRequestBody("x=" + "a".repeat(70 * 1024)), /payload_too_large/);
  console.log("ok bitrix-request");
}

main();
