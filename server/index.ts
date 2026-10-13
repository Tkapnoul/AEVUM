import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { config } from "./config.js";
import { app } from "./app.js";
import { ocrRoutes } from "./routes/ocr.js";

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

export { app };
