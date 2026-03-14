import type { WebhookPayload } from "./schemas";

/**
 * Stub pipeline entry-point. Phases 2–4 will replace this body with the full
 * orchestration: fetch MR data → clone repo → run agents → publish findings.
 */
export async function runPipeline(event: WebhookPayload): Promise<void> {
  console.log(`[pipeline] Received event: ${event.object_kind} project=${event.project.id}`);
}
