import { Hono } from "hono";
import { logger } from "hono/logger";
import { apiRouter } from "./api/router";
import { config } from "./config";

const app = new Hono();

app.use("*", logger());
app.route("/api/v1", apiRouter);

export default {
  port: config.PORT,
  fetch: app.fetch,
};
