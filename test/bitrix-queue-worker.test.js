"use strict";

const assert = require("assert/strict");
const { handleBitrixQueueWorker } = require("../lib/bitrix-queue-worker.js");

process.env.CRON_SECRET = "cron-secret-at-least-16-chars";

async function runWith(evaluation) {
  const calls = [];
  const job = { id: "job-1", member_id: "member-real", event_id: 77, session_id: 246018, chat_id: 64395, line_id: 19, connector_id: "livechat", attempts: 1 };
  const services = {
    repository: {
      claimJobs: async () => [job],
      completeJob: async (id, status) => calls.push(["complete", id, status]),
      failJob: async (value, code) => calls.push(["fail", value.id, code])
    },
    evaluateJob: async (body) => { assert.equal(body.session_id, 246018); assert.equal(body.source, "on_session_finish"); return evaluation; }
  };
  const result = await handleBitrixQueueWorker({ method: "GET", headers: { authorization: "Bearer " + process.env.CRON_SECRET } }, services);
  return { result, calls };
}

async function main() {
  let output = await runWith({ status: 200, payload: { success: true, status: "saved" } });
  assert.equal(output.result.payload.jobs.completed, 1);
  assert.deepEqual(output.calls[0], ["complete", "job-1", "completed"]);

  output = await runWith({ status: 200, payload: { success: true, status: "not_evaluable" } });
  assert.equal(output.result.payload.jobs.not_evaluable, 1);
  assert.deepEqual(output.calls[0], ["complete", "job-1", "not_evaluable"]);

  output = await runWith({ status: 502, payload: { success: false, error: "bitrix_timeout" } });
  assert.equal(output.result.payload.jobs.failed, 1);
  assert.deepEqual(output.calls[0], ["fail", "job-1", "bitrix_timeout"]);

  const unauthorized = await handleBitrixQueueWorker({ method: "GET", headers: { authorization: "Bearer wrong" } }, {});
  assert.equal(unauthorized.status, 401);
  console.log("ok bitrix-queue-worker");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
