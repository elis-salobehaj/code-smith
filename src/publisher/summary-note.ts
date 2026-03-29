export interface SummaryNoteRecord {
  id: number;
  body: string;
}

export const SUMMARY_MARKER = "<!-- code-smith:summary -->";
export const HEAD_MARKER_PREFIX = "<!-- code-smith:head sha=";

export function findExistingSummaryNote(notes: SummaryNoteRecord[], headSha: string): SummaryNoteRecord | null {
  if (!headSha) {
    return null;
  }

  const headMarker = `${HEAD_MARKER_PREFIX}${headSha} -->`;
  return notes.find((note) => note.body.includes(SUMMARY_MARKER) && note.body.includes(headMarker)) ?? null;
}
