import { Hono } from "hono";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Serves the on-device OCR engine (tesseract.js worker, WebAssembly core, Greek + English language data)
// from this server, so reading lab photos needs neither an API key nor a third-party CDN.
// The browser/app does the recognition itself; the server only hands out these static files.

const require = createRequire(import.meta.url);
const pkgDir = (name: string) => dirname(require.resolve(`${name}/package.json`));

const FILES: Record<string, () => string> = {
  "worker.min.js": () => join(pkgDir("tesseract.js"), "dist", "worker.min.js"),
  "lang/ell.traineddata.gz": () => join(pkgDir("@tesseract.js-data/ell"), "4.0.0_best_int", "ell.traineddata.gz"),
  "lang/eng.traineddata.gz": () => join(pkgDir("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz"),
};
for (const v of ["", "-simd", "-relaxedsimd"])
  for (const lstm of ["", "-lstm"]) {
    const f = `tesseract-core${v}${lstm}.wasm.js`;
    FILES[`core/${f}`] = () => join(pkgDir("tesseract.js-core"), f);
  }

const cache = new Map<string, Buffer>();

export const ocrRoutes = new Hono();

ocrRoutes.get("/*", async (c) => {
  const rel = c.req.path.replace(/^\/api\/ocr\//, "");
  const resolve = FILES[rel];
  if (!resolve) return c.json({ error: "not_found" }, 404);
  let buf = cache.get(rel);
  if (!buf) {
    buf = await readFile(resolve());
    cache.set(rel, buf);
  }
  return c.body(new Uint8Array(buf), 200, {
    "content-type": rel.endsWith(".js") ? "text/javascript" : "application/octet-stream",
    "cache-control": "public, max-age=86400",
  });
});
