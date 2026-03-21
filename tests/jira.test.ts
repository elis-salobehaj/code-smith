// ---------------------------------------------------------------------------
// Phase 4.5 — Jira read-only client tests
//
// Strategy:
//  • Pure utility functions (extractTicketKeys, normalisation helpers) are
//    tested without any network calls or mocking.
//  • fetchJiraTicket is tested by mocking the global fetch so no real HTTP
//    requests are made.
//  • fetchLinkedTickets integration tests cover: disabled integration, key
//    extraction, project-key allow-list, per-run cap, and dedup.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Config } from "../src/config";
import { extractTicketKeys, fetchJiraTicket, fetchLinkedTickets } from "../src/integrations/jira/client";

// ---------------------------------------------------------------------------
// extractTicketKeys — pure function
// ---------------------------------------------------------------------------

describe("extractTicketKeys", () => {
  it("extracts single ticket key from plain text", () => {
    expect(extractTicketKeys("Fixes ENG-123")).toEqual(["ENG-123"]);
  });

  it("extracts multiple keys from title + description", () => {
    const text = "Related to PROJ-10 and also ENG-456 (see PROJ-10 again)";
    expect(extractTicketKeys(text)).toEqual(["PROJ-10", "ENG-456"]);
  });

  it("returns empty array when no keys found", () => {
    expect(extractTicketKeys("no ticket here")).toEqual([]);
  });

  it("ignores lowercase project prefixes", () => {
    expect(extractTicketKeys("see eng-123 for details")).toEqual([]);
  });

  it("filters by project key allow-list when provided", () => {
    const text = "ENG-1 PLATFORM-2 SKIP-3";
    expect(extractTicketKeys(text, ["ENG", "PLATFORM"])).toEqual(["ENG-1", "PLATFORM-2"]);
  });

  it("returns empty array when no keys match allow-list", () => {
    expect(extractTicketKeys("ENG-1 PLATFORM-2", ["OTHER"])).toEqual([]);
  });

  it("allow-list matching is case-insensitive for the allow-list values", () => {
    expect(extractTicketKeys("ENG-1", ["eng"])).toEqual(["ENG-1"]);
  });

  it("deduplicates repeated keys", () => {
    expect(extractTicketKeys("ENG-1 ENG-1 ENG-1")).toEqual(["ENG-1"]);
  });

  it("handles two-character project prefix", () => {
    expect(extractTicketKeys("AB-100")).toEqual(["AB-100"]);
  });
});

// ---------------------------------------------------------------------------
// fetchJiraTicket — mocked fetch
// ---------------------------------------------------------------------------

type FetchSpy = ReturnType<typeof spyOn>;

function makeConfig(
  overrides: Partial<Config> = {},
): Pick<
  Config,
  "JIRA_BASE_URL" | "JIRA_EMAIL" | "JIRA_API_TOKEN" | "JIRA_ACCEPTANCE_CRITERIA_FIELD_ID" | "JIRA_TICKET_TIMEOUT_MS"
> {
  return {
    JIRA_BASE_URL: "https://test.atlassian.net",
    JIRA_EMAIL: "test@example.com",
    JIRA_API_TOKEN: "token123",
    JIRA_ACCEPTANCE_CRITERIA_FIELD_ID: undefined,
    JIRA_TICKET_TIMEOUT_MS: 5000,
    ...overrides,
  };
}

// Realistic ADF doc shape as returned by Jira Cloud REST API v3.
// Spec: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
//
// makeAdfDocFromBlocks — low-level helper accepting raw top-level block nodes.
// makeAdfParagraph     — wraps inline nodes in a paragraph block node.
// makeAdfDoc           — convenience wrapper: one paragraph per inline-node array.
function makeAdfDocFromBlocks(blocks: unknown[]) {
  return { type: "doc", version: 1, content: blocks };
}

function makeAdfParagraph(inlineNodes: Array<{ type: string; text?: string; attrs?: Record<string, unknown> }>) {
  return { type: "paragraph", content: inlineNodes };
}

function makeAdfDoc(paragraphs: Array<Array<{ type: string; text?: string; attrs?: Record<string, unknown> }>>) {
  return makeAdfDocFromBlocks(paragraphs.map(makeAdfParagraph));
}

function makeJiraApiResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    key: "ENG-1",
    fields: {
      summary: "Add payment gateway",
      status: { name: "In Progress" },
      issuetype: { name: "Story" },
      priority: { name: "P2" },
      assignee: { displayName: "Alice Smith" },
      description: null,
      // Realistic extra custom fields returned by Jira Cloud (passthrough-handled)
      customfield_10070: null,
      customfield_10063: null,
      ...overrides,
    },
  };
}

let fetchSpy: FetchSpy;

beforeEach(() => {
  fetchSpy = spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("fetchJiraTicket", () => {
  it("returns null when JIRA_BASE_URL is missing", async () => {
    const result = await fetchJiraTicket("ENG-1", { ...makeConfig(), JIRA_BASE_URL: undefined });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when JIRA_EMAIL is missing", async () => {
    const result = await fetchJiraTicket("ENG-1", { ...makeConfig(), JIRA_EMAIL: undefined });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when JIRA_API_TOKEN is missing", async () => {
    const result = await fetchJiraTicket("ENG-1", { ...makeConfig(), JIRA_API_TOKEN: undefined });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns normalized ticket on successful response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());

    expect(result).not.toBeNull();
    expect(result?.key).toBe("ENG-1");
    expect(result?.summary).toBe("Add payment gateway");
    expect(result?.status).toBe("In Progress");
    expect(result?.issueType).toBe("Story");
    expect(result?.priority).toBe("P2");
    expect(result?.assignee).toBe("Alice Smith");
    expect(result?.description).toBeUndefined();
    expect(result?.acceptanceCriteria).toBeUndefined();
  });

  it("extracts acceptance criteria from configured custom field", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(makeJiraApiResponse({ customfield_99999: "- User can checkout\n- Payment is confirmed" })),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await fetchJiraTicket("ENG-1", {
      ...makeConfig(),
      JIRA_ACCEPTANCE_CRITERIA_FIELD_ID: "customfield_99999",
    });

    expect(result?.acceptanceCriteria).toBe("- User can checkout\n- Payment is confirmed");
  });

  it("extracts plain-text description from ADF doc format", async () => {
    const adfDoc = makeAdfDoc([[{ type: "text", text: "This is the description." }]]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("This is the description.");
  });

  it("handles ADF hardBreak nodes as newlines between text segments", async () => {
    // Real Jira Cloud responses use hardBreak for line breaks within paragraphs
    const adfDoc = makeAdfDoc([
      [
        { type: "text", text: "First line of description." },
        { type: "hardBreak" },
        { type: "text", text: "Second line of description." },
      ],
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("First line of description.\nSecond line of description.");
  });

  it("handles ADF inlineCard nodes by extracting the URL", async () => {
    // Real Jira Cloud responses embed links as inlineCard nodes with an attrs.url
    const adfDoc = makeAdfDoc([
      [
        { type: "text", text: "See implementation docs: " },
        { type: "inlineCard", attrs: { url: "https://github.com/example/repo" } },
        { type: "text", text: " for details." },
      ],
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("See implementation docs: https://github.com/example/repo for details.");
  });

  it("handles combined hardBreak and inlineCard in ADF description", async () => {
    // Mirrors the actual Jira Cloud response shape observed in production
    const adfDoc = makeAdfDoc([
      [
        { type: "text", text: "Set up the integration tool for trial. Docs: " },
        { type: "inlineCard", attrs: { url: "https://github.com/example/integration" } },
        { type: "text", text: " " },
        { type: "hardBreak" },
        { type: "text", text: "Contact the team lead for the required access token." },
      ],
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe(
      "Set up the integration tool for trial. Docs: https://github.com/example/integration \nContact the team lead for the required access token.",
    );
  });

  it("extracts heading block nodes from ADF description", async () => {
    // heading is a top-level block node with inline content, same as paragraph
    const adfDoc = makeAdfDocFromBlocks([
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Acceptance Criteria" }] },
      makeAdfParagraph([{ type: "text", text: "Must pass all tests." }]),
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("Acceptance Criteria\nMust pass all tests.");
  });

  it("extracts bulletList block nodes from ADF description as '- item' lines", async () => {
    // bulletList → listItem → paragraph → inline nodes
    const adfDoc = makeAdfDocFromBlocks([
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [makeAdfParagraph([{ type: "text", text: "First requirement" }])] },
          { type: "listItem", content: [makeAdfParagraph([{ type: "text", text: "Second requirement" }])] },
        ],
      },
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("- First requirement\n- Second requirement");
  });

  it("extracts orderedList block nodes from ADF description as '- item' lines", async () => {
    const adfDoc = makeAdfDocFromBlocks([
      {
        type: "orderedList",
        attrs: { order: 1 },
        content: [
          { type: "listItem", content: [makeAdfParagraph([{ type: "text", text: "Step one" }])] },
          { type: "listItem", content: [makeAdfParagraph([{ type: "text", text: "Step two" }])] },
        ],
      },
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("- Step one\n- Step two");
  });

  it("extracts codeBlock content from ADF description", async () => {
    // codeBlock content contains text nodes directly (no marks per spec)
    const adfDoc = makeAdfDocFromBlocks([
      { type: "codeBlock", attrs: { language: "typescript" }, content: [{ type: "text", text: "const x = 1;" }] },
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("const x = 1;");
  });

  it("extracts blockquote by recursing into child block nodes", async () => {
    const adfDoc = makeAdfDocFromBlocks([
      { type: "blockquote", content: [makeAdfParagraph([{ type: "text", text: "Quoted context here." }])] },
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("Quoted context here.");
  });

  it("extracts expand block node title and body", async () => {
    const adfDoc = makeAdfDocFromBlocks([
      {
        type: "expand",
        attrs: { title: "Implementation Notes" },
        content: [makeAdfParagraph([{ type: "text", text: "See linked confluence page." }])],
      },
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("Implementation Notes\nSee linked confluence page.");
  });

  it("renders rule block node as '---' separator", async () => {
    const adfDoc = makeAdfDocFromBlocks([
      makeAdfParagraph([{ type: "text", text: "Before." }]),
      { type: "rule" },
      makeAdfParagraph([{ type: "text", text: "After." }]),
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("Before.\n---\nAfter.");
  });

  it("extracts mention inline node as '@DisplayName' text", async () => {
    // mention.attrs.text includes the leading @ per spec
    const adfDoc = makeAdfDoc([
      [
        { type: "text", text: "Assigned to " },
        { type: "mention", attrs: { id: "abc-123", text: "@Alice Smith", userType: "DEFAULT" } },
      ],
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("Assigned to @Alice Smith");
  });

  it("extracts emoji inline node using attrs.text unicode glyph", async () => {
    const adfDoc = makeAdfDoc([
      [
        { type: "emoji", attrs: { shortName: ":grinning:", text: "😀" } },
        { type: "text", text: " great news" },
      ],
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("😀 great news");
  });

  it("extracts emoji inline node falling back to shortName when attrs.text is absent", async () => {
    const adfDoc = makeAdfDoc([[{ type: "emoji", attrs: { shortName: ":awthanks:", id: "atlassian-awthanks" } }]]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe(":awthanks:");
  });

  it("extracts status inline node as '[label]'", async () => {
    // status.attrs.text is the label, e.g. "In Progress"
    const adfDoc = makeAdfDoc([
      [
        { type: "text", text: "Current state: " },
        { type: "status", attrs: { text: "In Progress", color: "yellow", localId: "abc" } },
      ],
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("Current state: [In Progress]");
  });

  it("extracts date inline node as ISO YYYY-MM-DD string", async () => {
    // date.attrs.timestamp is a Unix epoch in seconds as a string
    const adfDoc = makeAdfDoc([
      [
        { type: "text", text: "Due: " },
        { type: "date", attrs: { timestamp: "1740787200" } }, // 2025-03-01
      ],
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("Due: 2025-03-01");
  });

  it("extracts mixed multi-block ADF document correctly", async () => {
    // Real description might combine heading, paragraph, list, and inline nodes
    const adfDoc = makeAdfDocFromBlocks([
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Overview" }] },
      makeAdfParagraph([{ type: "text", text: "Integrate the payment system." }]),
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [makeAdfParagraph([{ type: "text", text: "Support card payments" }])] },
          { type: "listItem", content: [makeAdfParagraph([{ type: "text", text: "Handle refunds" }])] },
        ],
      },
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe(
      "Overview\nIntegrate the payment system.\n- Support card payments\n- Handle refunds",
    );
  });

  it("silently skips unknown block and inline node types", async () => {
    // The ADF spec evolves; new nodes should not crash extraction
    const adfDoc = makeAdfDocFromBlocks([
      { type: "unknownFutureBlock", content: [] },
      makeAdfParagraph([{ type: "unknownFutureInline" }, { type: "text", text: "visible" }]),
    ]);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse({ description: adfDoc })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result?.description).toBe("visible");
  });

  it("returns null on non-ok HTTP status", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network failure"));
    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result).toBeNull();
  });

  it("returns null when response does not match schema", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: "shape" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await fetchJiraTicket("ENG-1", makeConfig());
    expect(result).toBeNull();
  });

  it("sends Basic auth header with base64-encoded credentials", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await fetchJiraTicket("ENG-1", makeConfig());

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const auth = (options.headers as Record<string, string>).Authorization;
    const expected = `Basic ${Buffer.from("test@example.com:token123").toString("base64")}`;
    expect(auth).toBe(expected);
  });

  it("includes custom field in the fields query param when configured", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeJiraApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await fetchJiraTicket("ENG-1", {
      ...makeConfig(),
      JIRA_ACCEPTANCE_CRITERIA_FIELD_ID: "customfield_12345",
    });

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toContain("customfield_12345");
  });
});

// ---------------------------------------------------------------------------
// fetchLinkedTickets — integration behaviour
// ---------------------------------------------------------------------------

function makeFullConfig(
  overrides: Partial<Config> = {},
): Pick<
  Config,
  | "JIRA_ENABLED"
  | "JIRA_BASE_URL"
  | "JIRA_EMAIL"
  | "JIRA_API_TOKEN"
  | "JIRA_PROJECT_KEYS"
  | "JIRA_MAX_TICKETS"
  | "JIRA_TICKET_TIMEOUT_MS"
  | "JIRA_ACCEPTANCE_CRITERIA_FIELD_ID"
> {
  return {
    JIRA_ENABLED: true,
    JIRA_BASE_URL: "https://test.atlassian.net",
    JIRA_EMAIL: "test@example.com",
    JIRA_API_TOKEN: "token123",
    JIRA_PROJECT_KEYS: undefined,
    JIRA_MAX_TICKETS: 5,
    JIRA_TICKET_TIMEOUT_MS: 5000,
    JIRA_ACCEPTANCE_CRITERIA_FIELD_ID: undefined,
    ...overrides,
  };
}

function makeTicketResponse(key: string): Response {
  return new Response(
    JSON.stringify({
      key,
      fields: {
        summary: `Summary for ${key}`,
        status: { name: "Open" },
        issuetype: { name: "Bug" },
        priority: null,
        assignee: null,
        description: null,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("fetchLinkedTickets", () => {
  it("returns empty array when JIRA_ENABLED is false", async () => {
    const result = await fetchLinkedTickets("Fixes ENG-1", "see ENG-1", { ...makeFullConfig(), JIRA_ENABLED: false });
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty array when no ticket keys found in text", async () => {
    const result = await fetchLinkedTickets("no tickets here", undefined, makeFullConfig());
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches and returns resolved tickets", async () => {
    fetchSpy.mockResolvedValueOnce(makeTicketResponse("ENG-1"));

    const result = await fetchLinkedTickets("Fixes ENG-1", undefined, makeFullConfig());
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("ENG-1");
  });

  it("deduplicates repeated ticket keys across title and description", async () => {
    fetchSpy.mockResolvedValueOnce(makeTicketResponse("ENG-1"));

    const result = await fetchLinkedTickets("ENG-1", "also see ENG-1", makeFullConfig());
    expect(result).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("respects JIRA_MAX_TICKETS cap", async () => {
    // Provide 3 distinct keys but cap at 2
    fetchSpy.mockResolvedValueOnce(makeTicketResponse("ENG-1")).mockResolvedValueOnce(makeTicketResponse("ENG-2"));

    const result = await fetchLinkedTickets("ENG-1 ENG-2 ENG-3", undefined, {
      ...makeFullConfig(),
      JIRA_MAX_TICKETS: 2,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });

  it("filters by JIRA_PROJECT_KEYS allow-list", async () => {
    fetchSpy.mockResolvedValueOnce(makeTicketResponse("ENG-1"));

    const result = await fetchLinkedTickets("ENG-1 SKIP-99", undefined, {
      ...makeFullConfig(),
      JIRA_PROJECT_KEYS: "ENG",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result[0].key).toBe("ENG-1");
  });

  it("omits failed ticket fetches from the result but returns successful ones", async () => {
    // First ticket fails
    fetchSpy
      .mockResolvedValueOnce(new Response("error", { status: 500 }))
      .mockResolvedValueOnce(makeTicketResponse("ENG-2"));

    const result = await fetchLinkedTickets("ENG-1 ENG-2", undefined, makeFullConfig());
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("ENG-2");
  });

  it("treats undefined description as empty when extracting keys from title only", async () => {
    fetchSpy.mockResolvedValueOnce(makeTicketResponse("ENG-1"));

    const result = await fetchLinkedTickets("Fixes ENG-1", undefined, makeFullConfig());
    expect(result).toHaveLength(1);
  });
});
