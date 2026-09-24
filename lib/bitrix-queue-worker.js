"use strict";

const crypto = require("crypto");
const { createBitrixSupabaseRepository } = require("./bitrix-supabase-repository.js");
const { createServices } = require("./bitrix-evaluation-clients.js");
const { evaluateBitrixAttendance } = require("./bitrix-evaluation.js");

async function handleBitrixQueueWorker(input, dependencies) {
  if (!["GET", "POST"].includes(String(input && input.method || "").toUpperCase())) return result_(405, { success: false, error: "method_not_allowed" });
  if (!cronTokenValid_(input && input.headers || {})) return result_(401, { success: false, error: "unauthorized" });
  const services = dependencies || createWorkerServices();

  try {
    const summary = await processBitrixQueue(services);
    return result_(200, { success: true, status: "processed", jobs: summary });
  } catch (error) {
    return result_(Number(error && error.statusCode) || 503, { success: false, error: safeCode_(error && error.code, "bitrix_queue_failed") });
  }
}

async function processBitrixQueue(services, options) {
  const opt = options || {};
  const limit = Math.min(5, positiveInt_(opt.limit || process.env.BITRIX_QUEUE_BATCH_SIZE) || 1);
  const maxAttempts = Math.min(10, positiveInt_(opt.maxAttempts || process.env.BITRIX_QUEUE_MAX_ATTEMPTS) || 5);
  const summary = { claimed: 0, completed: 0, not_evaluable: 0, failed: 0 };
  const jobs = await services.repository.claimJobs(limit);
  summary.claimed = jobs.length;
  for (const job of jobs) {
    try {
      const evaluation = await services.evaluateJob({
        member_id: job.member_id,
        session_id: job.session_id,
        chat_id: job.chat_id,
        line_id: job.line_id,
        connector_id: job.connector_id,
        event_id: job.event_id,
        source: "on_session_finish",
        force: false,
        dry_run: false
      });
      const status = clean_(evaluation && evaluation.payload && evaluation.payload.status);
      if (evaluation && evaluation.status < 400 && ["saved", "already_processed"].includes(status)) {
        await services.repository.completeJob(job.id, "completed");
        summary.completed += 1;
      } else if (evaluation && evaluation.status < 400 && status === "not_evaluable") {
        await services.repository.completeJob(job.id, "not_evaluable");
        summary.not_evaluable += 1;
      } else {
        const code = safeCode_(evaluation && evaluation.payload && evaluation.payload.error, "bitrix_evaluation_failed");
        await services.repository.failJob(job, code, maxAttempts);
        summary.failed += 1;
      }
    } catch (error) {
      await services.repository.failJob(job, safeCode_(error && error.code, "bitrix_job_failed"), maxAttempts);
      summary.failed += 1;
    }
  }
  return summary;
}

function createWorkerServices(options) {
  const opt = options || {};
  const repository = opt.repository || createBitrixSupabaseRepository(opt);
  const evaluationServices = opt.evaluationServices || createServices({ installationRepository: repository, fetchImpl: opt.fetchImpl });
  return {
    repository,
    evaluateJob: (body) => evaluateBitrixAttendance(body, evaluationServices)
  };
}

function cronTokenValid_(headers) {
  const expected = Buffer.from(clean_(process.env.CRON_SECRET));
  const supplied = Buffer.from(clean_(headers.authorization || headers.Authorization).replace(/^Bearer\s+/i, ""));
  return expected.length >= 16 && expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function safeCode_(value, fallback) { const code = clean_(value); return /^[a-z0-9_]+$/i.test(code) ? code : fallback; }
function positiveInt_(value) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : 0; }
function clean_(value) { return String(value == null ? "" : value).trim(); }
function result_(status, payload) { return { status, payload }; }

module.exports = { handleBitrixQueueWorker, processBitrixQueue, createWorkerServices, cronTokenValid_ };
