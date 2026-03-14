import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

const projectSchema = z
  .object({
    id: z.number(),
    web_url: z.string().url(),
    path_with_namespace: z.string(),
  })
  .strict();

const userSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    username: z.string(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Merge Request event
// ---------------------------------------------------------------------------

const mergeRequestAttributesSchema = z
  .object({
    iid: z.number(),
    title: z.string(),
    description: z.string().nullable(),
    source_branch: z.string(),
    target_branch: z.string(),
    action: z.string(),
    url: z.string().url(),
    state: z.string(),
    draft: z.boolean().optional(),
    work_in_progress: z.boolean().optional(),
  })
  .strict();

export const mergeRequestEventSchema = z
  .object({
    object_kind: z.literal("merge_request"),
    event_type: z.string(),
    project: projectSchema,
    user: userSchema,
    object_attributes: mergeRequestAttributesSchema,
  })
  .strict();

export type MergeRequestEvent = z.infer<typeof mergeRequestEventSchema>;

// ---------------------------------------------------------------------------
// Note (comment) event — triggered when someone comments /ai-review
// ---------------------------------------------------------------------------

const noteAttributesSchema = z
  .object({
    id: z.number(),
    note: z.string(),
    noteable_type: z.string(),
    noteable_id: z.number().nullable().optional(),
    url: z.string().url().optional(),
  })
  .strict();

const noteMergeRequestSchema = z
  .object({
    iid: z.number(),
    title: z.string(),
    source_branch: z.string(),
    target_branch: z.string(),
    state: z.string(),
  })
  .strict();

export const noteEventSchema = z
  .object({
    object_kind: z.literal("note"),
    event_type: z.string().optional(),
    project: projectSchema,
    user: userSchema,
    object_attributes: noteAttributesSchema,
    merge_request: noteMergeRequestSchema,
  })
  .strict();

export type NoteEvent = z.infer<typeof noteEventSchema>;

// ---------------------------------------------------------------------------
// Discriminated union — the webhook router parses against this
// ---------------------------------------------------------------------------

export const webhookPayloadSchema = z.discriminatedUnion("object_kind", [mergeRequestEventSchema, noteEventSchema]);

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
