import { describe, expect, it } from "bun:test";
import app from "../src/index";

// ---------------------------------------------------------------------------
// Env vars are loaded from .env.test by Bun before any module is evaluated.
// Bun automatically loads .env.test when NODE_ENV=test (set by `bun test`).
// This means config.ts can safely evaluate process.env at module load time.
// ---------------------------------------------------------------------------
const TEST_SECRET = "test-webhook-secret";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown, secret: string | null = TEST_SECRET): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secret !== null) {
    headers["X-Gitlab-Token"] = secret;
  }
  return new Request("http://localhost/api/v1/webhooks/gitlab", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const mrOpenEvent = await Bun.file("tests/fixtures/sample_mr_event.json").json();
const noteEvent = await Bun.file("tests/fixtures/sample_note_event.json").json();

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

describe("GET /api/v1/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await app.fetch(new Request("http://localhost/api/v1/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Webhook — authentication
// ---------------------------------------------------------------------------

describe("POST /api/v1/webhooks/gitlab — authentication", () => {
  it("returns 401 when X-Gitlab-Token header is missing", async () => {
    const res = await app.fetch(makeRequest(mrOpenEvent, null));
    expect(res.status).toBe(401);
  });

  it("returns 401 when X-Gitlab-Token is wrong", async () => {
    const res = await app.fetch(makeRequest(mrOpenEvent, "wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is not valid JSON", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/webhooks/gitlab", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gitlab-Token": TEST_SECRET,
        },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Webhook — payload validation
// ---------------------------------------------------------------------------

describe("POST /api/v1/webhooks/gitlab — payload validation", () => {
  it("returns 400 when payload has unknown object_kind", async () => {
    const res = await app.fetch(makeRequest({ object_kind: "push", ref: "refs/heads/main" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when required fields are missing from MR event", async () => {
    const res = await app.fetch(makeRequest({ object_kind: "merge_request" }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Webhook — event filtering
// ---------------------------------------------------------------------------

describe("POST /api/v1/webhooks/gitlab — event filtering", () => {
  it("accepts MR open action and returns 202", async () => {
    const res = await app.fetch(makeRequest(mrOpenEvent));
    expect(res.status).toBe(202);
  });

  it("accepts MR update action and returns 202", async () => {
    const res = await app.fetch(
      makeRequest({ ...mrOpenEvent, object_attributes: { ...mrOpenEvent.object_attributes, action: "update" } }),
    );
    expect(res.status).toBe(202);
  });

  it("accepts MR reopen action and returns 202", async () => {
    const res = await app.fetch(
      makeRequest({ ...mrOpenEvent, object_attributes: { ...mrOpenEvent.object_attributes, action: "reopen" } }),
    );
    expect(res.status).toBe(202);
  });

  it("ignores MR close action and returns 200", async () => {
    const res = await app.fetch(
      makeRequest({ ...mrOpenEvent, object_attributes: { ...mrOpenEvent.object_attributes, action: "close" } }),
    );
    expect(res.status).toBe(200);
  });

  it("ignores MR merge action and returns 200", async () => {
    const res = await app.fetch(
      makeRequest({ ...mrOpenEvent, object_attributes: { ...mrOpenEvent.object_attributes, action: "merge" } }),
    );
    expect(res.status).toBe(200);
  });

  it("accepts /ai-review note on a MergeRequest and returns 202", async () => {
    const res = await app.fetch(makeRequest(noteEvent));
    expect(res.status).toBe(202);
  });

  it("ignores note that does not start with /ai-review", async () => {
    const res = await app.fetch(
      makeRequest({
        ...noteEvent,
        object_attributes: {
          ...noteEvent.object_attributes,
          note: "looks good to me",
        },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("ignores note on an Issue (not a MergeRequest)", async () => {
    const res = await app.fetch(
      makeRequest({
        ...noteEvent,
        object_attributes: {
          ...noteEvent.object_attributes,
          noteable_type: "Issue",
          note: "/ai-review",
        },
      }),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Webhook — schema correctness (Zod strict — no extra keys pass)
// ---------------------------------------------------------------------------

describe("POST /api/v1/webhooks/gitlab — Zod strict schema", () => {
  it("rejects MR event with extra unexpected top-level key", async () => {
    const res = await app.fetch(makeRequest({ ...mrOpenEvent, unexpected_key: true }));
    expect(res.status).toBe(400);
  });
});
