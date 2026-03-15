import { describe, expect, it, mock } from "bun:test";
import type { Finding } from "../src/agents/state";
import type { GitLabClient } from "../src/gitlab-client/client";
import type { DiffFile, Discussion, Note } from "../src/gitlab-client/types";
import { formatFindingComment, formatSummaryComment, GitLabPublisher } from "../src/publisher/gitlab-publisher";

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
  suggestedFix: "if (!req.user) return res.status(401).json({ error: 'Unauthorized' });",
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
    expect(comment).toContain("```suggestion");
    expect(comment).toContain(criticalFinding.suggestedFix as string);
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

function makeMockClient(discussions: Discussion[] = []): GitLabClient {
  return {
    getMRDiscussions: mock(async () => discussions),
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
    await pub.postSummaryComment(1, 2, "APPROVE", []);
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
    await pub.postSummaryComment(1, 2, "REQUEST_CHANGES", [criticalFinding]);
    const [, , body] = (client.createMRNote as ReturnType<typeof mock>).mock.calls[0] as [number, number, string];
    expect(body).toContain(criticalFinding.title);
  });
});
