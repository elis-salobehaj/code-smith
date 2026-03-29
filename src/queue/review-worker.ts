// ---------------------------------------------------------------------------
// BullMQ review worker (Phase 5.1)
//
// Picks up ReviewJobData from the "review" queue and runs the full review
// pipeline inside the same async context that the router would have used in
// fire-and-forget mode — requestId is re-established so all log lines from
// the pipeline carry the same correlation ID that was generated in the router.
//
// lockDuration is set to 10 minutes to accommodate slow agent + tool loops.
// Stalled jobs are retried up to maxStalledCount times.
// ---------------------------------------------------------------------------

import { type Queue, Worker } from "bullmq";
import { runPipeline } from "../api/pipeline";
import { config } from "../config";
import { getLogger } from "../logger";
import { getConnectionOptions } from "./connection";
import {
  createReviewDeadLetterQueue,
  enqueueReviewDeadLetter,
  hasExhaustedAttempts,
  REVIEW_DEAD_LETTER_QUEUE_NAME,
  type ReviewDeadLetterJobData,
} from "./dead-letter";
import type { ReviewJobData } from "./review-queue";
import { REVIEW_QUEUE_NAME } from "./review-queue";
import { ReviewJobTimeoutError, runReviewJobWithTimeout } from "./review-worker-core";

const logger = getLogger(["codesmith", "worker"]);

let _deadLetterQueue: Queue<ReviewDeadLetterJobData> | null = null;

function getDeadLetterQueue(): Queue<ReviewDeadLetterJobData> {
  if (!_deadLetterQueue) {
    _deadLetterQueue = createReviewDeadLetterQueue();
  }
  return _deadLetterQueue;
}

export function createReviewWorker(): Worker<ReviewJobData> {
  const worker = new Worker<ReviewJobData>(
    REVIEW_QUEUE_NAME,
    async (job) => {
      logger.info("Processing review job", {
        jobId: job.id,
        requestId: job.data.requestId,
        attempt: job.attemptsMade + 1,
        timeoutMs: config.REVIEW_JOB_TIMEOUT_MS,
      });

      await runReviewJobWithTimeout(job.data, {
        timeoutMs: config.REVIEW_JOB_TIMEOUT_MS,
        pipelineRunner: runPipeline,
      });
    },
    {
      // biome-ignore lint/suspicious/noExplicitAny: BullMQ ConnectionOptions accepts plain options objects
      connection: getConnectionOptions() as any,
      concurrency: config.WORKER_CONCURRENCY,
      // Allow up to 10 minutes for the pipeline (agent loops can be slow).
      lockDuration: 10 * 60 * 1_000,
      // Stalled jobs are retried — use the same retry count as the queue default.
      maxStalledCount: 3,
    },
  );

  worker.on("completed", (job) => {
    logger.info("Review job completed", { jobId: job.id });
  });

  worker.on("failed", (job, err) => {
    logger.error("Review job failed", {
      jobId: job?.id,
      error: err instanceof Error ? err.message : String(err),
    });

    if (!job?.id || !job.data) {
      return;
    }

    const maxAttempts = Math.max(job.opts.attempts ?? 1, 1);
    if (!hasExhaustedAttempts(job.attemptsMade, maxAttempts)) {
      return;
    }

    const failureReason = err instanceof ReviewJobTimeoutError ? "timeout" : "processor_error";
    enqueueReviewDeadLetter(getDeadLetterQueue(), job.data, {
      originalJobId: String(job.id),
      attemptsMade: job.attemptsMade,
      maxAttempts,
      error: err instanceof Error ? err.message : String(err),
      failureReason,
    })
      .then(() => {
        logger.error("Review job moved to dead-letter queue", {
          jobId: job.id,
          deadLetterQueue: REVIEW_DEAD_LETTER_QUEUE_NAME,
          failureReason,
        });
      })
      .catch((deadLetterErr: unknown) => {
        logger.error("Failed to move review job to dead-letter queue", {
          jobId: job.id,
          deadLetterQueue: REVIEW_DEAD_LETTER_QUEUE_NAME,
          error: deadLetterErr instanceof Error ? deadLetterErr.message : String(deadLetterErr),
        });
      });
  });

  worker.on("stalled", (jobId) => {
    logger.warn("Review job stalled — will be retried", { jobId });
  });

  return worker;
}
