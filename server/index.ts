import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { secureHeaders } from "hono/secure-headers";
import { logger } from "hono/logger";
import { config } from "./config.js";
import "./db.js";
import { HttpError } from "./lib/validate.js";
import { authRoutes } from "./routes/auth.js";
import { metricRoutes } from "./routes/metrics.js";
import { careRoutes } from "./routes/care.js";
import { deviceApi, deviceRoutes, SUPPORTED_DEVICES } from "./routes/devices.js";
import { expertRoutes } from "./routes/expert.js";
import { aiRoutes } from "./routes/ai.js";

export const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  secureHeaders({
    // Calls open in a new tab, so no third-party frames are needed.
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  }),
);

// Cookie-authenticated writes must come from our own pages (CSRF defence on top of SameSite=Lax).
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && !c.req.path.startsWith("/api/device/")) {
    const origin = c.req.header("origin");
    if (origin && new URL(origin).host !== c.req.header("host")) return c.json({ error: "bad_origin" }, 403);
  }
  await next();
});

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/config", (c) =>
  c.json({
    publicUrl: config.publicUrl,
    aiEnabled: config.ai.enabled,
    clinicTimeZone: config.clinicTimeZone,
    devices: Object.entries(SUPPORTED_DEVICES).map(([kind, d]) => ({ kind, name: d.name })),
  }),
);
app.route("/api/auth", authRoutes);
app.route("/api/metrics", metricRoutes);
app.route("/api/care", careRoutes);
app.route("/api/devices", deviceRoutes);
app.route("/api/device", deviceApi); // called by the watch's phone-side service, token auth
app.route("/api/expert", expertRoutes);
app.route("/api/ai", aiRoutes);
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

if (config.isProd) {
  app.use("/*", serveStatic({ root: "./dist" }));
  // SPA fallback: client-side routes all render index.html.
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

if (process.env.VITEST !== "true") {
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`AEVUM API listening on http://localhost:${info.port}`);
  });
}
