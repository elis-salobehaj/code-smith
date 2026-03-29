// ---------------------------------------------------------------------------
// Thin Jira read-only client for Phase 4.5 ticket-context enrichment.
//
// Scope: issue lookup only. No writes, no transitions, no comments, no field
// edits, no worklogs, no issue creation, no link mutation.
//
// Uses direct fetch — no external Jira SDK.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { Config } from "../../config";
import { getLogger } from "../../logger";

const logger = getLogger(["codesmith", "jira"]);

// ---------------------------------------------------------------------------
// Regex for Jira-style ticket keys: one or more uppercase letters, dash, digits
// e.g. PROJ-123, ENG-456, PLATFORM-7890
// ---------------------------------------------------------------------------
const TICKET_KEY_PATTERN = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/**
 * Extract unique Jira ticket keys from a block of text.
 * When allowedProjectKeys is provided, only keys whose project prefix appears
 * in the allow-list are returned.
 */
export function extractTicketKeys(text: string, allowedProjectKeys?: string[]): string[] {
  const matches = [...text.matchAll(TICKET_KEY_PATTERN)].map((m) => m[1]);
  const unique = [...new Set(matches)];
  if (!allowedProjectKeys || allowedProjectKeys.length === 0) {
    return unique;
  }
  const allowed = new Set(allowedProjectKeys.map((k) => k.toUpperCase()));
  return unique.filter((key) => {
    const project = key.split("-")[0];
    return allowed.has(project);
  });
}

// ---------------------------------------------------------------------------
// Normalized ticket shape — only the fields the agents need
// ---------------------------------------------------------------------------

export const jiraTicketSchema = z.object({
  key: z.string(),
  summary: z.string(),
  status: z.string(),
  issueType: z.string(),
  priority: z.string().optional(),
  assignee: z.string().optional(),
  description: z.string().optional(),
  acceptanceCriteria: z.string().optional(),
});

export type JiraTicket = z.infer<typeof jiraTicketSchema>;

// ---------------------------------------------------------------------------
// Raw Jira REST API response — only the paths we parse
// ---------------------------------------------------------------------------

const jiraIssueResponseSchema = z.object({
  key: z.string(),
  // .passthrough() on fields so custom fields (e.g. customfield_12345) survive
  fields: z
    .object({
      summary: z.string(),
      status: z.object({ name: z.string() }),
      issuetype: z.object({ name: z.string() }),
      priority: z.object({ name: z.string() }).nullable().optional(),
      assignee: z.object({ displayName: z.string() }).nullable().optional(),
      description: z
        .union([
          // Jira Cloud (Atlassian Document Format) — extract plain text from paragraphs
          z.object({
            type: z.literal("doc"),
            content: z.array(z.unknown()),
          }),
          // Jira Server / Data Center may return a plain string or null
          z.string(),
          z.null(),
        ])
        .optional(),
    })
    .passthrough(),
});

// ---------------------------------------------------------------------------
// ADF (Atlassian Document Format) plain-text extraction.
// Spec: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
//
// Goal: produce readable plain text for LLM context from any valid ADF doc.
// Unknown node types are silently skipped — the spec evolves and we need
// best-effort readability, not HTML-fidelity rendering.
// ---------------------------------------------------------------------------

/** Entry point. Receives doc.content (array of top-level block nodes). */
function extractAdfText(content: unknown[]): string {
  return extractBlockNodes(content).trim();
}

function extractBlockNodes(nodes: unknown[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) continue;
    const text = extractBlockNode(node as Record<string, unknown>);
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

function extractBlockNode(n: Record<string, unknown>): string {
  const children = Array.isArray(n.content) ? (n.content as unknown[]) : [];
  switch (n.type) {
    // Inline-content containers — extract inline nodes directly
    case "paragraph":
    case "heading":
    case "codeBlock":
      return extractInlineNodes(children).trim();

    // Block-content containers — recurse into child block nodes
    case "blockquote":
    case "panel":
      return extractBlockNodes(children);

    // Lists: bulletList / orderedList → listItem → block nodes
    // Both rendered as "- item" since we target plain readability.
    case "bulletList":
    case "orderedList": {
      const items: string[] = [];
      for (const item of children) {
        if (typeof item !== "object" || item === null) continue;
        const li = item as Record<string, unknown>;
        if (li.type === "listItem" && Array.isArray(li.content)) {
          const text = extractBlockNodes(li.content as unknown[]).trim();
          if (text) items.push(`- ${text}`);
        }
      }
      return items.join("\n");
    }

    // Expandable sections: emit title then body
    case "expand":
    case "nestedExpand": {
      const attrs = n.attrs as Record<string, unknown> | undefined;
      const title = typeof attrs?.title === "string" ? attrs.title.trim() : "";
      const body = extractBlockNodes(children);
      return [title, body].filter(Boolean).join("\n");
    }

    case "rule":
      return "---";

    // table, media, taskList, syncBlock, etc. — not meaningful as plain text
    default:
      return "";
  }
}

/**
 * Extract text from an array of inline nodes, concatenated without separator.
 * Spec inline nodes: text, hardBreak, inlineCard, mention, emoji, status, date, mediaInline.
 */
function extractInlineNodes(nodes: unknown[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) continue;
    const c = node as Record<string, unknown>;
    const attrs = c.attrs as Record<string, unknown> | undefined;
    switch (c.type) {
      case "text":
        // text.marks (bold, italic, link, etc.) are formatting only; text content is enough
        if (typeof c.text === "string") parts.push(c.text);
        break;
      case "hardBreak":
        // Spec: inserts a new line; attrs.text is "\n" but we emit it directly
        parts.push("\n");
        break;
      case "inlineCard":
        // attrs.url (URI string) or attrs.data (JSON-LD) — url is the common case
        if (typeof attrs?.url === "string") parts.push(attrs.url);
        break;
      case "mention":
        // attrs.text is the display name with leading "@", e.g. "@Alice Smith"
        if (typeof attrs?.text === "string") parts.push(attrs.text);
        break;
      case "emoji":
        // attrs.text is the Unicode glyph when available; fall back to shortName (":grinning:")
        if (typeof attrs?.text === "string") parts.push(attrs.text);
        else if (typeof attrs?.shortName === "string") parts.push(attrs.shortName);
        break;
      case "status":
        // attrs.text is the status label, e.g. "In Progress"
        if (typeof attrs?.text === "string") parts.push(`[${attrs.text}]`);
        break;
      case "date": {
        // attrs.timestamp is a Unix epoch string (seconds)
        if (typeof attrs?.timestamp === "string") {
          const d = new Date(Number(attrs.timestamp) * 1000);
          if (!Number.isNaN(d.getTime())) parts.push(d.toISOString().slice(0, 10));
        }
        break;
      }
      // mediaInline and other inline nodes — no meaningful plain-text representation
    }
  }
  return parts.join("");
}

function normalizeDescription(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return raw.trim() || undefined;
  // ADF object
  const doc = raw as { type?: string; content?: unknown[] };
  if (doc.type === "doc" && Array.isArray(doc.content)) {
    const text = extractAdfText(doc.content);
    return text || undefined;
  }
  return undefined;
}

function extractCustomField(fields: Record<string, unknown>, fieldId: string | undefined): string | undefined {
  if (!fieldId) return undefined;
  const raw = fields[fieldId];
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "string") return raw.trim() || undefined;
  // ADF object in a custom field
  return normalizeDescription(raw);
}

// ---------------------------------------------------------------------------
// Single-ticket fetch
// ---------------------------------------------------------------------------

/**
 * Fetch a single Jira ticket by key.
 * Returns null and logs on any failure — never throws — so the pipeline
 * degrades safely when Jira is unavailable.
 */
export async function fetchJiraTicket(
  key: string,
  config: Pick<
    Config,
    "JIRA_BASE_URL" | "JIRA_EMAIL" | "JIRA_API_TOKEN" | "JIRA_ACCEPTANCE_CRITERIA_FIELD_ID" | "JIRA_TICKET_TIMEOUT_MS"
  >,
): Promise<JiraTicket | null> {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_ACCEPTANCE_CRITERIA_FIELD_ID, JIRA_TICKET_TIMEOUT_MS } =
    config;

  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    logger.warn("Jira fetch skipped — missing JIRA_BASE_URL, JIRA_EMAIL, or JIRA_API_TOKEN", { key });
    return null;
  }

  // Build the field projection: always fetch core fields; add acceptance criteria custom field when configured
  const fields = ["summary", "status", "issuetype", "priority", "assignee", "description"];
  if (JIRA_ACCEPTANCE_CRITERIA_FIELD_ID) {
    fields.push(JIRA_ACCEPTANCE_CRITERIA_FIELD_ID);
  }

  const url = new URL(`/rest/api/3/issue/${encodeURIComponent(key)}`, JIRA_BASE_URL);
  url.searchParams.set("fields", fields.join(","));

  const credentials = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");

  let raw: unknown;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), JIRA_TICKET_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      logger.warn("Jira ticket fetch returned non-ok status", { key, status: response.status });
      return null;
    }

    raw = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("Jira ticket fetch failed", { key, error: message });
    return null;
  }

  const parsed = jiraIssueResponseSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn("Jira ticket response failed validation", { key, issues: parsed.error.issues });
    return null;
  }

  const { fields: f } = parsed.data;
  const rawFields = parsed.data.fields as Record<string, unknown>;

  const ticket: JiraTicket = {
    key: parsed.data.key,
    summary: f.summary,
    status: f.status.name,
    issueType: f.issuetype.name,
    priority: f.priority?.name ?? undefined,
    assignee: f.assignee?.displayName ?? undefined,
    description: normalizeDescription(f.description),
    acceptanceCriteria: extractCustomField(rawFields, JIRA_ACCEPTANCE_CRITERIA_FIELD_ID),
  };

  return jiraTicketSchema.parse(ticket);
}

// ---------------------------------------------------------------------------
// Bounded multi-ticket fetch — called from the pipeline
// ---------------------------------------------------------------------------

/**
 * Extract ticket keys from MR text, fetch each one, and return the normalized
 * results.  Applies the project key allow-list, deduplication, and the per-run
 * ticket cap from config.
 */
export async function fetchLinkedTickets(
  mrTitle: string,
  mrDescription: string | undefined,
  config: Pick<
    Config,
    | "JIRA_ENABLED"
    | "JIRA_BASE_URL"
    | "JIRA_EMAIL"
    | "JIRA_API_TOKEN"
    | "JIRA_PROJECT_KEYS"
    | "JIRA_MAX_TICKETS"
    | "JIRA_TICKET_TIMEOUT_MS"
    | "JIRA_ACCEPTANCE_CRITERIA_FIELD_ID"
  >,
): Promise<JiraTicket[]> {
  if (!config.JIRA_ENABLED) {
    return [];
  }

  const combinedText = [mrTitle, mrDescription].filter(Boolean).join("\n");
  const allowedKeys = config.JIRA_PROJECT_KEYS
    ? config.JIRA_PROJECT_KEYS.split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    : undefined;

  const keys = extractTicketKeys(combinedText, allowedKeys).slice(0, config.JIRA_MAX_TICKETS);

  if (keys.length === 0) {
    return [];
  }

  logger.info("Fetching Jira ticket context", { keys });

  const results = await Promise.all(keys.map((key) => fetchJiraTicket(key, config)));

  const tickets = results.filter((t): t is JiraTicket => t !== null);
  logger.info("Jira ticket context fetched", { requested: keys.length, resolved: tickets.length });

  return tickets;
}
