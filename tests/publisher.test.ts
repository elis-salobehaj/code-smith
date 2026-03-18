import { describe, expect, it, mock } from "bun:test";
import type { Finding } from "../src/agents/state";
import type { GitLabClient } from "../src/gitlab-client/client";
import type { DiffFile, Discussion, Note } from "../src/gitlab-client/types";
import { formatFindingComment, formatSummaryComment, GitLabPublisher } from "../src/publisher/gitlab-publisher";
import { normalizeSuggestionCodeForRange } from "../src/publisher/suggestion-normalizer";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const criticalFinding: Finding = {
  file: "src/auth/middleware.ts",
  lineStart: 42,
  lineEnd: 45,
  riskLevel: "critical",
  title: "Missing authentication check",
  description: "The route handler does not verify the JWT before proceeding.",
  evidence: "Line 42 calls `next()` without checking `req.user`.",
  suggestedFix: "Add an auth guard before calling next().",
  suggestedFixCode: "if (!req.user) return res.status(401).json({ error: 'Unauthorized' });\nnext();",
};

const lowFinding: Finding = {
  file: "src/utils/format.ts",
  lineStart: 10,
  lineEnd: 10,
  riskLevel: "low",
  title: "Unused variable",
  description: "Variable `tmp` is declared but never read.",
  evidence: "Line 10: `const tmp = ...`",
};

const diffRefs = { baseSha: "base123", headSha: "head456", startSha: "start789" };
const diffFiles: DiffFile[] = [
  {
    oldPath: "src/auth/middleware.ts",
    newPath: "src/auth/middleware.ts",
    newFile: false,
    deletedFile: false,
    renamedFile: false,
    diff: [
      "@@ -40,3 +40,6 @@",
      " const before = true;",
      "+const needsAuth = req.user != null;",
      "+if (!needsAuth) return false;",
      "+next();",
    ].join("\n"),
  },
  {
    oldPath: "src/utils/format.ts",
    newPath: "src/utils/format.ts",
    newFile: false,
    deletedFile: false,
    renamedFile: false,
    diff: ["@@ -9,1 +9,2 @@", " export function format() {", "+  const tmp = '';", " }"].join("\n"),
  },
];

// ---------------------------------------------------------------------------
// formatFindingComment — pure formatter
// ---------------------------------------------------------------------------

describe("formatFindingComment", () => {
  it("includes risk emoji, level, and title in heading", () => {
    const comment = formatFindingComment(criticalFinding);
    expect(comment).toContain("git-gandalf:finding");
    expect(comment).toContain("🔴");
    expect(comment).toContain("CRITICAL");
    expect(comment).toContain("Missing authentication check");
  });

  it("includes description and evidence sections", () => {
    const comment = formatFindingComment(criticalFinding);
    expect(comment).toContain("**Risk**:");
    expect(comment).toContain("**Evidence**:");
    expect(comment).toContain(criticalFinding.description);
    expect(comment).toContain(criticalFinding.evidence);
  });

  it("includes suggested fix block when present", () => {
    const comment = formatFindingComment(criticalFinding);
    expect(comment).toContain("**Suggested Fix**:");
    expect(comment).toContain(criticalFinding.suggestedFix as string);
    expect(comment).toContain("```suggestion:-0+3");
    expect(comment).toContain(criticalFinding.suggestedFixCode as string);
  });

  it("suggestion block is empty for deletion findings", () => {
    const deletionFinding: Finding = {
      ...criticalFinding,
      suggestedFix: "Remove this line entirely.",
      suggestedFixCode: "",
    };
    const comment = formatFindingComment(deletionFinding);
    expect(comment).toContain("**Suggested Fix**: Remove this line entirely.");
    expect(comment).toContain("```suggestion:-0+3");
  });

  it("uses explicit offsets when the anchor is inside the finding range", () => {
    const comment = formatFindingComment(criticalFinding, 43);
    expect(comment).toContain("```suggestion:-1+2");
  });

  it("omits suggestion block when suggestedFixCode is absent", () => {
    const noCodeFinding: Finding = {
      ...criticalFinding,
      suggestedFix: "Refactor this module.",
      suggestedFixCode: undefined,
    };
    const comment = formatFindingComment(noCodeFinding);
    expect(comment).toContain("**Suggested Fix**: Refactor this module.");
    expect(comment).not.toContain("```suggestion");
  });

  it("omits suggested fix block when absent", () => {
    const comment = formatFindingComment(lowFinding);
    expect(comment).not.toContain("Suggested Fix");
    expect(comment).not.toContain("```suggestion");
  });

  it("uses correct emoji for each risk level", () => {
    for (const [level, emoji] of [
      ["critical", "🔴"],
      ["high", "🟠"],
      ["medium", "🟡"],
      ["low", "🔵"],
    ] as const) {
      const f: Finding = { ...lowFinding, riskLevel: level };
      expect(formatFindingComment(f)).toContain(emoji);
    }
  });
});

describe("normalizeSuggestionCodeForRange", () => {
  it("strips unchanged surrounding context from a hallucinated full-snippet suggestion", () => {
    const fileContent = [
      "#!/bin/bash",
      "this is a coding error supposed to be caught by review",
      'echo "Setting up service dependencies not managed through gradle"',
      "sudo apt-get update && sudo apt-get install openjdk-17-jdk",
      "",
    ].join("\n");

    const suggestion = [
      "#!/bin/bash",
      'echo "Setting up service dependencies not managed through gradle"',
      "sudo apt-get update && sudo apt-get install openjdk-17-jdk",
    ].join("\n");

    expect(normalizeSuggestionCodeForRange(fileContent, 2, 2, suggestion)).toBe("");
  });

  it("keeps precise local replacement code unchanged", () => {
    const fileContent = ["const count = 0;", "return count;", ""].join("\n");
    const suggestion = "const count = 1;";

    expect(normalizeSuggestionCodeForRange(fileContent, 1, 1, suggestion)).toBe(suggestion);
  });

  it("drops no-op suggestions that reproduce the original range", () => {
    const fileContent = ["const count = 0;", "return count;", ""].join("\n");

    expect(normalizeSuggestionCodeForRange(fileContent, 1, 1, "const count = 0;")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatSummaryComment — pure formatter
// ---------------------------------------------------------------------------

describe("formatSummaryComment", () => {
  it("renders APPROVE badge for APPROVE verdict", () => {
    const body = formatSummaryComment("APPROVE", []);
    expect(body).toContain("git-gandalf:summary");
    expect(body).toContain("✅ APPROVE");
  });

  it("renders REQUEST CHANGES badge", () => {
    const body = formatSummaryComment("REQUEST_CHANGES", []);
    expect(body).toContain("⚠️ REQUEST CHANGES");
  });

  it("renders NEEDS DISCUSSION badge", () => {
    const body = formatSummaryComment("NEEDS_DISCUSSION", []);
    expect(body).toContain("💬 NEEDS DISCUSSION");
  });

  it("shows no-findings message when findings array is empty", () => {
    const body = formatSummaryComment("APPROVE", []);
    expect(body).toContain("No findings");
  });

  it("lists each finding in the body when findings are present", () => {
    const body = formatSummaryComment("REQUEST_CHANGES", [criticalFinding, lowFinding]);
    expect(body).toContain(criticalFinding.title);
    expect(body).toContain(lowFinding.title);
  });

  it("shows correct severity counts in the summary table", () => {
    const body = formatSummaryComment("REQUEST_CHANGES", [criticalFinding, criticalFinding, lowFinding]);
    // critical: 2, high: 0, medium: 0, low: 1
    expect(body).toMatch(/Critical.*2/);
    expect(body).toMatch(/High.*0/);
    expect(body).toMatch(/Low.*1/);
  });

  it("includes a GitGandalf footer attribution", () => {
    const body = formatSummaryComment("APPROVE", []);
    expect(body).toContain("GitGandalf");
  });

  it("embeds hidden head SHA marker when headSha is provided", () => {
    const body = formatSummaryComment("APPROVE", [], "deadbeefsha");
    expect(body).toContain("<!-- git-gandalf:head sha=deadbeefsha -->");
    // Marker must appear before the footer separator line (not the table row |---|---|)
    const markerIdx = body.indexOf("<!-- git-gandalf:head sha=");
    const footerIdx = body.indexOf("\n---\n");
    expect(markerIdx).toBeLessThan(footerIdx);
  });

  it("omits head SHA marker when headSha is absent", () => {
    const body = formatSummaryComment("APPROVE", []);
    expect(body).not.toContain("<!-- git-gandalf:head sha=");
  });
});

// ---------------------------------------------------------------------------
// GitLabPublisher — integration with mocked GitLabClient
// ---------------------------------------------------------------------------

function makeDiscussion(filePath: string, line: number): Discussion {
  const note: Note = {
    id: 1,
    body: "existing comment",
    authorUsername: "bot",
    createdAt: "2026-01-01T00:00:00Z",
    resolvable: true,
    position: {
      baseSha: "base",
      startSha: "start",
      headSha: "head",
      positionType: "text",
      newPath: filePath,
      newLine: line,
      oldPath: filePath,
      oldLine: null,
    },
  };
  return { id: "disc-1", notes: [note] };
}

function makeBotDiscussion(filePath: string, line: number, finding: Finding): Discussion {
  const note: Note = {
    id: 2,
    body: formatFindingComment(finding),
    authorUsername: "git-gandalf",
    createdAt: "2026-01-01T00:00:00Z",
    resolvable: true,
    position: {
      baseSha: "base",
      startSha: "start",
      headSha: "head",
      positionType: "text",
      newPath: filePath,
      newLine: line,
      oldPath: filePath,
      oldLine: null,
    },
  };

  return { id: "disc-2", notes: [note] };
}

function makeMockClient(discussions: Discussion[] = [], notes: Array<{ id: number; body: string }> = []): GitLabClient {
  return {
    getMRDiscussions: mock(async () => discussions),
    getMRNotes: mock(async () => notes),
    createInlineDiscussion: mock(async () => undefined),
    createMRNote: mock(async () => undefined),
  } as unknown as GitLabClient;
}

describe("GitLabPublisher.postInlineComments", () => {
  it("skips getMRDiscussions call and creates no discussions when findings list is empty", async () => {
    const client = makeMockClient();
    const pub = new GitLabPublisher(client);
    await pub.postInlineComments(1, 2, [], diffRefs, diffFiles);
    expect(client.getMRDiscussions).not.toHaveBeenCalled();
    expect(client.createInlineDiscussion).not.toHaveBeenCalled();
  });

  it("creates an inline discussion for each non-duplicate finding", async () => {
    const client = makeMockClient([]);
    const pub = new GitLabPublisher(client);
    await pub.postInlineComments(1, 2, [criticalFinding, lowFinding], diffRefs, diffFiles);
    expect(client.createInlineDiscussion).toHaveBeenCalledTimes(2);
  });

  it("passes correct position fields to createInlineDiscussion", async () => {
    const client = makeMockClient([]);
    const pub = new GitLabPublisher(client);
    await pub.postInlineComments(1, 2, [criticalFinding], diffRefs, diffFiles);
    expect(client.createInlineDiscussion).toHaveBeenCalledWith(1, 2, expect.stringContaining("CRITICAL"), {
      baseSha: diffRefs.baseSha,
      startSha: diffRefs.startSha,
      headSha: diffRefs.headSha,
      newPath: criticalFinding.file,
      newLine: 42,
    });
  });

  it("does not treat a human comment on the same line as a duplicate", async () => {
    const existing = makeDiscussion(criticalFinding.file, criticalFinding.lineStart);
    const client = makeMockClient([existing]);
    const pub = new GitLabPublisher(client);
    await pub.postInlineComments(1, 2, [criticalFinding], diffRefs, diffFiles);
    expect(client.createInlineDiscussion).toHaveBeenCalledTimes(1);
  });

  it("skips a finding when the same GitGandalf marker already exists", async () => {
    const existing = makeBotDiscussion(criticalFinding.file, criticalFinding.lineStart, criticalFinding);
    const client = makeMockClient([existing]);
    const pub = new GitLabPublisher(client);
    await pub.postInlineComments(1, 2, [criticalFinding, lowFinding], diffRefs, diffFiles);
    expect(client.createInlineDiscussion).toHaveBeenCalledTimes(1);
    expect(client.createInlineDiscussion).toHaveBeenCalledWith(
      1,
      2,
      expect.stringContaining("LOW"),
      expect.objectContaining({ newPath: lowFinding.file }),
    );
  });

  it("skips findings that cannot be anchored to an added diff line", async () => {
    const client = makeMockClient([]);
    const pub = new GitLabPublisher(client);
    const nonDiffFinding: Finding = {
      ...criticalFinding,
      file: "src/missing.ts",
      lineStart: 99,
      lineEnd: 99,
    };
    await pub.postInlineComments(1, 2, [nonDiffFinding], diffRefs, diffFiles);
    expect(client.createInlineDiscussion).not.toHaveBeenCalled();
  });

  it("continues posting later findings when one inline discussion fails", async () => {
    const client = makeMockClient([]);
    (client.createInlineDiscussion as ReturnType<typeof mock>)
      .mockRejectedValueOnce(new Error("position invalid"))
      .mockResolvedValueOnce(undefined);
    const pub = new GitLabPublisher(client);
    await pub.postInlineComments(1, 2, [criticalFinding, lowFinding], diffRefs, diffFiles);
    expect(client.createInlineDiscussion).toHaveBeenCalledTimes(2);
  });
});

describe("GitLabPublisher.postSummaryComment", () => {
  it("calls createMRNote with the formatted summary body", async () => {
    const client = makeMockClient();
    const pub = new GitLabPublisher(client);
    await pub.postSummaryComment(1, 2, "APPROVE", [], diffRefs.headSha);
    expect(client.createMRNote).toHaveBeenCalledTimes(1);
    const [projId, mrIid, body] = (client.createMRNote as ReturnType<typeof mock>).mock.calls[0] as [
      number,
      number,
      string,
    ];
    expect(projId).toBe(1);
    expect(mrIid).toBe(2);
    expect(body).toContain("✅ APPROVE");
  });

  it("includes findings titles in the summary when findings are present", async () => {
    const client = makeMockClient();
    const pub = new GitLabPublisher(client);
    await pub.postSummaryComment(1, 2, "REQUEST_CHANGES", [criticalFinding], diffRefs.headSha);
    const [, , body] = (client.createMRNote as ReturnType<typeof mock>).mock.calls[0] as [number, number, string];
    expect(body).toContain(criticalFinding.title);
  });

  it("embeds the head SHA marker in the posted body", async () => {
    const client = makeMockClient();
    const pub = new GitLabPublisher(client);
    await pub.postSummaryComment(1, 2, "APPROVE", [], "abc123sha");
    const [, , body] = (client.createMRNote as ReturnType<typeof mock>).mock.calls[0] as [number, number, string];
    expect(body).toContain("<!-- git-gandalf:head sha=abc123sha -->");
  });

  it("skips posting when an existing note has the same head SHA", async () => {
    const existingBody = formatSummaryComment("APPROVE", [], "dupesha");
    const client = makeMockClient([], [{ id: 99, body: existingBody }]);
    const pub = new GitLabPublisher(client);
    await pub.postSummaryComment(1, 2, "APPROVE", [], "dupesha");
    expect(client.createMRNote).not.toHaveBeenCalled();
  });

  it("posts when head SHA differs from existing summary note", async () => {
    const existingBody = formatSummaryComment("APPROVE", [], "oldsha");
    const client = makeMockClient([], [{ id: 99, body: existingBody }]);
    const pub = new GitLabPublisher(client);
    await pub.postSummaryComment(1, 2, "APPROVE", [], "newsha");
    expect(client.createMRNote).toHaveBeenCalledTimes(1);
  });

  it("posts when existing note has summary marker but no head SHA (legacy note)", async () => {
    // A note posted before Phase E0 has no head SHA — must not suppress new posts
    const legacyBody = formatSummaryComment("APPROVE", []);
    const client = makeMockClient([], [{ id: 88, body: legacyBody }]);
    const pub = new GitLabPublisher(client);
    await pub.postSummaryComment(1, 2, "APPROVE", [], "newsha");
    expect(client.createMRNote).toHaveBeenCalledTimes(1);
  });
});
