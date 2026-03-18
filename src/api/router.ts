import { Hono } from "hono";
import { config } from "../config";
import { getLogger, withContext } from "../logger";
import { runPipeline } from "./pipeline";
import { type WebhookPayload, webhookPayloadSchema } from "./schemas";
import type { ReviewTriggerContext } from "./trigger";

const logger = getLogger(["gandalf", "router"]);

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

  // 5. Fire-and-forget — return 202 immediately
  const requestId = Bun.randomUUIDv7();
  withContext({ requestId }, () => {
    runPipeline(event, trigger).catch((err: unknown) => {
      logger.error("Unhandled pipeline error", { error: err instanceof Error ? err.message : String(err) });
    });
  });

  return c.text("Accepted", 202);
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

apiRouter.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});
