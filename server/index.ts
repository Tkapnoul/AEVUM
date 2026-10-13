import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { aiProvider, config } from "./config.js";
import "./db.js";
import { HttpError } from "./lib/validate.js";
import { authRoutes } from "./routes/auth.js";
import { metricRoutes } from "./routes/metrics.js";
import { careRoutes } from "./routes/care.js";
import { deviceApi, deviceRoutes } from "./routes/devices.js";
import { expertRoutes } from "./routes/expert.js";
import { aiRoutes } from "./routes/ai.js";
import { adminRoutes } from "./routes/admin.js";
import { bioAgeRoutes } from "./routes/bioage.js";
import { labRoutes } from "./routes/labs.js";
import { ocrRoutes } from "./routes/ocr.js";

export const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  secureHeaders({
    // Calls open in a new tab, so no third-party frames are needed.
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      // On-device lab reading: tesseract runs WebAssembly in a blob: worker, pdf.js renders scanned pages.
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      imgSrc: ["'self'", "data:", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],
      manifestSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  }),
);

// The native app's WebView runs on its own origin (capacitor://localhost on iOS, https://localhost on Android)
// and authenticates with a Bearer token, never cookies.
const NATIVE_ORIGINS = ["capacitor://localhost", "https://localhost", "http://localhost", "ionic://localhost"];
app.use("/api/*", cors({ origin: (o) => (NATIVE_ORIGINS.includes(o) ? o : null), allowHeaders: ["content-type", "authorization"], maxAge: 86400 }));

// Cookie-authenticated writes must come from our own pages (CSRF defence on top of SameSite=Lax).
// Bearer-authenticated requests carry no ambient credentials, so they are exempt.
app.use("/api/*", async (c, next) => {
  const bearer = c.req.header("authorization")?.startsWith("Bearer ");
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS" && !bearer && !c.req.path.startsWith("/api/device/")) {
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
    aiEnabled: aiProvider != null,
    aiProvider,
    clinicTimeZone: config.clinicTimeZone,
    zeppDevices: ["amazfit_bip6"],
  }),
);
app.route("/api/auth", authRoutes);
app.route("/api/metrics", metricRoutes);
app.route("/api/care", careRoutes);
app.route("/api/devices", deviceRoutes);
app.route("/api/device", deviceApi); // called by the watch's phone-side service, token auth
app.route("/api/expert", expertRoutes);
app.route("/api/ai", aiRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/bioage", bioAgeRoutes);
app.route("/api/labs", labRoutes);
app.route("/api/ocr", ocrRoutes); // public static files for on-device OCR
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
