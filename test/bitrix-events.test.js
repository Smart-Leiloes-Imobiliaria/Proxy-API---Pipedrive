"use strict";

const assert = require("assert/strict");
const { handleBitrixEvent } = require("../lib/bitrix-events.js");

process.env.BITRIX_ALLOWED_CHAT_IDS = "64395,67331";
process.env.BITRIX_ALLOWED_SESSION_IDS = "";
process.env.BITRIX_ALLOWED_LINE_IDS = "";
process.env.BITRIX_ALLOWED_CONNECTORS = "livechat";

function eventBody() {
  return {
    event: "ONSESSIONFINISH",
    eventId: 77,
    data: { DATA: [
      { connector: { connector_id: "livechat", line_id: 19, chat_id: 64395, user_id: 800 }, session: { id: 246018, closed: "Y" }, chat: { id: 64395 }, user: { id: 800 } },
      { connector: { connector_id: "livechat", line_id: 19, chat_id: 67331, user_id: 802 }, session: { id: 252348, closed: "Y" }, chat: { id: 67331 }, user: { id: 802 } },
      { connector: { connector_id: "livechat", line_id: 19, chat_id: 99999, user_id: 801 }, session: { id: 246019, closed: "Y" }, chat: { id: 99999 }, user: { id: 801 } }
    ] },
    auth: { member_id: "member-real", application_token: "expected-token", access_token: "event-token-must-not-persist" }
  };
}

async function main() {
  const jobs = [];
  let scheduled = 0;
  const repository = {
    getByMemberId: async () => ({ member_id: "member-real", application_token: "expected-token" }),
    enqueueJob: async (job) => { jobs.push(job); return { inserted: true, job }; }
  };
  let result = await handleBitrixEvent({ method: "POST", body: JSON.stringify(eventBody()) }, { installationRepository: repository, scheduleProcessing: () => { scheduled += 1; } });
  assert.equal(result.status, 202);
  assert.deepEqual({ accepted: result.payload.accepted, ignored: result.payload.ignored }, { accepted: 2, ignored: 1 });
  assert.equal(jobs[0].session_id, 246018);
  assert.equal(jobs[0].chat_id, 64395);
  assert.equal(jobs[0].event_key, "bitrix-event:member-real:77:246018");
  assert.equal(jobs[1].session_id, 252348);
  assert.equal(jobs[1].chat_id, 67331);
  assert.ok(!Object.prototype.hasOwnProperty.call(jobs[0], "access_token"));
  assert.ok(!JSON.stringify(jobs[0]).includes("event-token-must-not-persist"));
  assert.equal(scheduled, 1);

  const duplicateRepo = Object.assign({}, repository, { enqueueJob: async () => ({ inserted: false }) });
  result = await handleBitrixEvent({ method: "POST", body: JSON.stringify(eventBody()) }, { installationRepository: duplicateRepo });
  assert.equal(result.payload.duplicates, 2);

  const invalid = eventBody(); invalid.auth.application_token = "wrong";
  result = await handleBitrixEvent({ method: "POST", body: JSON.stringify(invalid) }, { installationRepository: repository });
  assert.equal(result.status, 403);
  assert.equal(result.payload.error, "invalid_application_token");

  const unknown = eventBody(); unknown.event = "ONAPPTEST";
  result = await handleBitrixEvent({ method: "POST", body: JSON.stringify(unknown) }, { installationRepository: repository });
  assert.equal(result.status, 200);
  assert.equal(result.payload.status, "ignored");

  const form = new URLSearchParams();
  form.set("event", "ONSESSIONFINISH"); form.set("eventId", "78");
  form.set("auth[member_id]", "member-real"); form.set("auth[application_token]", "expected-token");
  form.set("data[DATA][0][connector][connector_id]", "livechat");
  form.set("data[DATA][0][connector][line_id]", "19");
  form.set("data[DATA][0][connector][chat_id]", "64395");
  form.set("data[DATA][0][session][id]", "246020"); form.set("data[DATA][0][session][closed]", "Y");
  form.set("data[DATA][0][chat][id]", "64395");
  result = await handleBitrixEvent({ method: "POST", body: form.toString() }, { installationRepository: repository });
  assert.equal(result.payload.accepted, 1);
  assert.equal(jobs.at(-1).session_id, 246020);

  result = await handleBitrixEvent({ method: "GET", body: "" }, { installationRepository: repository });
  assert.equal(result.status, 405);
  console.log("ok bitrix-events");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
