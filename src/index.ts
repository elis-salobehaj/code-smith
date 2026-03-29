import { honoLogger } from "@logtape/hono";
import { Hono } from "hono";
import { apiRouter } from "./api/router";
import { config } from "./config";
import { initLogging } from "./logger";

// ---------------------------------------------------------------------------
// Phase 4.6 — GitLab TLS / custom-CA bootstrap
//
// Must run before any HTTPS connections are opened so Bun's TLS context
// picks up the extra CA cert for @gitbeaker/rest API calls.
// Git subprocesses receive the same file via GIT_SSL_CAINFO injected in
// RepoManager.run() — see src/context/repo-manager.ts.
// ---------------------------------------------------------------------------
if (config.GITLAB_CA_FILE) {
  process.env.NODE_EXTRA_CA_CERTS = config.GITLAB_CA_FILE;
}

await initLogging();

const app = new Hono();

app.use(
  honoLogger({
    category: ["codesmith", "http"],
    level: "info",
    format: "combined",
    skip: (c) => c.req.path === "/api/v1/health",
  }),
);
app.route("/api/v1", apiRouter);

export default {
  port: config.PORT,
  fetch: app.fetch,
};
