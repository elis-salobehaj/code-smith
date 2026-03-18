// ---------------------------------------------------------------------------
// Review trigger context — carries trigger semantics past the router boundary.
// ---------------------------------------------------------------------------

export type ReviewTriggerMode = "automatic" | "manual";

export type ReviewTriggerSource = "merge_request_event" | "mr_note_command";

export interface ReviewTriggerContext {
  mode: ReviewTriggerMode;
  source: ReviewTriggerSource;
  noteId?: number;
  rawCommand?: string;
}
