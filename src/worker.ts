// ---------------------------------------------------------------------------
// Worker process entrypoint (Phase 5.1)
//
// Start this process alongside the webhook server when QUEUE_ENABLED=true:
//   bun run src/worker.ts
//
// The worker consumes review jobs from the BullMQ "review" queue backed by
// Valkey and runs the full review pipeline for each job. It is intentionally
// separate from the webhook server so each process can be scaled and restarted
// independently (e.g. as separate Kubernetes Deployments).
//
// Graceful shutdown: on SIGTERM / SIGINT the worker drains its in-flight jobs
// then exits cleanly, giving the active pipeline time to finish.
// ---------------------------------------------------------------------------

import { config } from "./config";
import { initLogging } from "./logger";
import { createReviewWorker } from "./queue/review-worker";

// TLS / custom CA (same bootstrap as the webhook server — the worker also
// makes outgoing HTTPS calls to GitLab and Bedrock).
if (config.GITLAB_CA_FILE) {
  process.env.NODE_EXTRA_CA_CERTS = config.GITLAB_CA_FILE;
}

await initLogging();

import { getLogger } from "./logger";

const logger = getLogger(["codesmith", "worker"]);

if (!config.QUEUE_ENABLED) {
  logger.warn("QUEUE_ENABLED is false — worker process started but queue is disabled. Set QUEUE_ENABLED=true.");
}

const worker = createReviewWorker();

logger.info("Review worker started", {
  queueName: "review",
  concurrency: config.WORKER_CONCURRENCY,
  valkey: config.VALKEY_URL,
});

async function shutdown(signal: string) {
  logger.info("Received shutdown signal — draining worker", { signal });
  await worker.close();
  logger.info("Worker shut down cleanly");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
