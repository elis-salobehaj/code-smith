export interface SummaryNoteRecord {
  id: number;
  body: string;
}

export const SUMMARY_MARKER = "<!-- git-gandalf:summary -->";
export const HEAD_MARKER_PREFIX = "<!-- git-gandalf:head sha=";

export function findExistingSummaryNote(notes: SummaryNoteRecord[], headSha: string): SummaryNoteRecord | null {
  if (!headSha) {
    return null;
  }

  const headMarker = `${HEAD_MARKER_PREFIX}${headSha} -->`;
  return notes.find((note) => note.body.includes(SUMMARY_MARKER) && note.body.includes(headMarker)) ?? null;
}
