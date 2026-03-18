import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ReviewTriggerContext } from "../src/api/trigger";

// ---------------------------------------------------------------------------
// Env vars are loaded from .env.test by Bun before any module is evaluated.
// Bun automatically loads .env.test when NODE_ENV=test (set by `bun test`).
// This means config.ts can safely evaluate process.env at module load time.
// ---------------------------------------------------------------------------
const TEST_SECRET = "test-webhook-secret";
const mockRunPipeline = mock(async (_event: unknown, _trigger: ReviewTriggerContext) => undefined);

mock.module("../src/api/pipeline", () => ({
  runPipeline: mockRunPipeline,
}));

const { default: app } = await import("../src/index");

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

beforeEach(() => {
  mockRunPipeline.mockReset();
  mockRunPipeline.mockResolvedValue(undefined);
});

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
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
  });

  it("accepts MR update action and returns 202", async () => {
    const res = await app.fetch(
      makeRequest({ ...mrOpenEvent, object_attributes: { ...mrOpenEvent.object_attributes, action: "update" } }),
    );
    expect(res.status).toBe(202);
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
  });

  it("accepts MR reopen action and returns 202", async () => {
    const res = await app.fetch(
      makeRequest({ ...mrOpenEvent, object_attributes: { ...mrOpenEvent.object_attributes, action: "reopen" } }),
    );
    expect(res.status).toBe(202);
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
  });

  it("ignores MR close action and returns 200", async () => {
    const res = await app.fetch(
      makeRequest({ ...mrOpenEvent, object_attributes: { ...mrOpenEvent.object_attributes, action: "close" } }),
    );
    expect(res.status).toBe(200);
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("ignores MR merge action and returns 200", async () => {
    const res = await app.fetch(
      makeRequest({ ...mrOpenEvent, object_attributes: { ...mrOpenEvent.object_attributes, action: "merge" } }),
    );
    expect(res.status).toBe(200);
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("accepts /ai-review note on a MergeRequest and returns 202", async () => {
    const res = await app.fetch(makeRequest(noteEvent));
    expect(res.status).toBe(202);
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
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
    expect(mockRunPipeline).not.toHaveBeenCalled();
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
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Webhook — schema correctness with real GitLab payloads
// ---------------------------------------------------------------------------

describe("POST /api/v1/webhooks/gitlab — realistic GitLab payloads", () => {
  it("accepts MR event with additional GitLab fields", async () => {
    const res = await app.fetch(
      makeRequest({
        ...mrOpenEvent,
        repository: {
          name: "my-project",
          homepage: "https://gitlab.example.com/alice/my-project",
        },
        changes: {
          updated_at: {
            previous: "2026-03-15T00:00:00Z",
            current: "2026-03-15T00:05:00Z",
          },
        },
        project: {
          ...mrOpenEvent.project,
          name: "My Project",
          namespace: "alice",
          http_url: "https://gitlab.example.com/alice/my-project.git",
        },
        user: {
          ...mrOpenEvent.user,
          email: "alice@example.com",
          avatar_url: "https://gitlab.example.com/uploads/-/system/user/avatar.png",
        },
        object_attributes: {
          ...mrOpenEvent.object_attributes,
          id: 99,
          created_at: "2026-03-15T00:00:00Z",
          updated_at: "2026-03-15T00:05:00Z",
          source_project_id: 42,
          target_project_id: 42,
        },
      }),
    );

    expect(res.status).toBe(202);
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Webhook — trigger context
// ---------------------------------------------------------------------------

describe("POST /api/v1/webhooks/gitlab — trigger context", () => {
  it("passes automatic trigger for merge_request event", async () => {
    const res = await app.fetch(makeRequest(mrOpenEvent));
    expect(res.status).toBe(202);
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);

    const [, trigger] = mockRunPipeline.mock.calls[0];
    expect(trigger).toEqual({
      mode: "automatic",
      source: "merge_request_event",
    });
  });

  it("passes manual trigger for /ai-review note event", async () => {
    const res = await app.fetch(makeRequest(noteEvent));
    expect(res.status).toBe(202);
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);

    const [, trigger] = mockRunPipeline.mock.calls[0];
    expect(trigger).toEqual({
      mode: "manual",
      source: "mr_note_command",
      noteId: noteEvent.object_attributes.id,
      rawCommand: noteEvent.object_attributes.note,
    });
  });

  it("passes automatic trigger for MR update action", async () => {
    const res = await app.fetch(
      makeRequest({ ...mrOpenEvent, object_attributes: { ...mrOpenEvent.object_attributes, action: "update" } }),
    );
    expect(res.status).toBe(202);
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);

    const [, trigger] = mockRunPipeline.mock.calls[0];
    expect(trigger).toEqual({
      mode: "automatic",
      source: "merge_request_event",
    });
  });
});
