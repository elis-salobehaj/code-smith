import { Hono } from "hono";
import { config } from "../config";
import { runPipeline } from "./pipeline";
import { type WebhookPayload, webhookPayloadSchema } from "./schemas";

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
    console.warn("[webhook] Payload validation failed:", result.error.message);
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

  // 4. Fire-and-forget — return 202 immediately
  runPipeline(event).catch((err: unknown) => {
    console.error("[pipeline] Unhandled error:", err);
  });

  return c.text("Accepted", 202);
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

apiRouter.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});
