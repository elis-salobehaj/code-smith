import type { Queue } from "bullmq";
import { Hono } from "hono";
import { config } from "../config";
import { getLogger, withContext } from "../logger";
import type { ReviewJobData } from "../queue/review-queue";
import { buildReviewJobData, createReviewQueue } from "../queue/review-queue";
import { runPipeline } from "./pipeline";
import { type WebhookPayload, webhookPayloadSchema } from "./schemas";
import type { ReviewTriggerContext } from "./trigger";

const logger = getLogger(["codesmith", "router"]);

function isMetadataOnlyMergeRequestUpdate(event: WebhookPayload): boolean {
  if (event.object_kind !== "merge_request") {
    return false;
  }

  if (event.object_attributes.action !== "update") {
    return false;
  }

  const previousHead = event.object_attributes.oldrev;
  const lastCommit = event.object_attributes.last_commit;
  const currentHead =
    typeof lastCommit === "object" && lastCommit !== null && "id" in lastCommit && typeof lastCommit.id === "string"
      ? lastCommit.id
      : undefined;
  return Boolean(previousHead && currentHead && previousHead === currentHead);
}

function isAutomaticDraftMergeRequest(event: WebhookPayload): boolean {
  if (event.object_kind !== "merge_request") {
    return false;
  }

  return Boolean(event.object_attributes.draft || event.object_attributes.work_in_progress);
}

// ---------------------------------------------------------------------------
// Lazy-initialised BullMQ queue — only created when QUEUE_ENABLED=true so
// the webhook server never connects to Valkey in fire-and-forget mode.
// ---------------------------------------------------------------------------
let _reviewQueue: Queue<ReviewJobData> | null = null;

function getReviewQueue(): Queue<ReviewJobData> {
  if (!_reviewQueue) {
    _reviewQueue = createReviewQueue();
  }
  return _reviewQueue;
}

export const apiRouter = new Hono();

// ---------------------------------------------------------------------------
// POST /webhooks/gitlab
// ---------------------------------------------------------------------------

apiRouter.post("/webhooks/gitlab", async (c) => {
  // 1. Verify the shared secret
  const token = c.req.header("X-Gitlab-Token");
  if (token !== config.GITLAB_WEBHOOK_SECRET) {
    return c.text("Unauthorized", 401);
  }

  // 2. Parse and validate the payload
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.text("Invalid JSON", 400);
  }

  const result = webhookPayloadSchema.safeParse(rawBody);
  if (!result.success) {
    logger.warn("Payload validation failed: {error}", { error: result.error.message });
    return c.text("Invalid payload", 400);
  }

  const event: WebhookPayload = result.data;

  // 3. Filter: only process relevant events
  const shouldProcess = (() => {
    if (event.object_kind === "merge_request") {
      return ["open", "update", "reopen"].includes(event.object_attributes.action);
    }
    if (event.object_kind === "note") {
      // Only trigger on /ai-review comment on a merge request
      return (
        event.object_attributes.noteable_type === "MergeRequest" &&
        event.object_attributes.note.trim().startsWith("/ai-review")
      );
    }
    return false;
  })();

  if (!shouldProcess) {
    return c.text("Ignored", 200);
  }

  if (isMetadataOnlyMergeRequestUpdate(event)) {
    const lastCommit = event.object_attributes.last_commit;
    const currentHead =
      typeof lastCommit === "object" && lastCommit !== null && "id" in lastCommit && typeof lastCommit.id === "string"
        ? lastCommit.id
        : undefined;
    logger.info("Ignoring metadata-only merge request update", {
      projectId: event.project.id,
      mrIid: event.object_attributes.iid,
      oldrev: event.object_attributes.oldrev,
      currentHead,
    });
    return c.text("Ignored", 200);
  }

  if (!config.REVIEW_DRAFT_MRS && isAutomaticDraftMergeRequest(event)) {
    logger.info("Ignoring draft merge request event because REVIEW_DRAFT_MRS=false", {
      projectId: event.project.id,
      mrIid: event.object_attributes.iid,
    });
    return c.text("Ignored", 200);
  }

  // 4. Build trigger context
  const trigger: ReviewTriggerContext =
    event.object_kind === "note"
      ? {
          mode: "manual",
          source: "mr_note_command",
          noteId: event.object_attributes.id,
          rawCommand: event.object_attributes.note,
        }
      : {
          mode: "automatic",
          source: "merge_request_event",
        };

  // 5. Dispatch: enqueue via BullMQ when queue is enabled, otherwise run
  //    fire-and-forget (original behaviour preserved for non-queue deployments).
  const requestId = Bun.randomUUIDv7();

  if (config.QUEUE_ENABLED) {
    // Enqueue — only acknowledge the webhook after BullMQ accepted the job.
    const jobData = buildReviewJobData(event, trigger, requestId);
    try {
      const job = await getReviewQueue().add("review", jobData);
      logger.info("Review job enqueued", { requestId, jobId: job.id });
    } catch (err: unknown) {
      logger.error("Failed to enqueue review job", {
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.text("Queue unavailable", 503);
    }
  } else {
    // Fire-and-forget (original behaviour)
    withContext({ requestId }, () => {
      runPipeline(event, trigger).catch((err: unknown) => {
        logger.error("Unhandled pipeline error", { error: err instanceof Error ? err.message : String(err) });
      });
    });
  }

  return c.text("Accepted", 202);
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

apiRouter.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});
