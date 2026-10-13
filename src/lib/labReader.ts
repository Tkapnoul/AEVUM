import { apiUrl } from "./native";

// Reads a lab report on the device, without AI: a PDF's text layer via pdf.js, and photos (or scanned PDFs)
// via tesseract OCR. The OCR engine and Greek/English language data are served by our own server.
// Both libraries are loaded only when the member actually picks a file.

export type ReadStage = "pdf" | "ocr-load" | "ocr" | "ai";

const abs = (path: string) => new URL(apiUrl(path), window.location.href).href;
const MAX_PAGES = 8;

/** pdf.js returns positioned text runs; rebuild table rows by grouping runs that share a baseline. */
function rowsFromItems(items: { str: string; transform: number[] }[]): string[] {
  const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
  for (const it of items) {
    if (!it.str?.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const row = rows.find((r) => Math.abs(r.y - y) < 3);
    if (row) row.parts.push({ x, s: it.str });
    else rows.push({ y, parts: [{ x, s: it.str }] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) =>
      r.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.s)
        .join(" "),
    );
}

async function ocrCanvases(images: HTMLCanvasElement[], onStage: (s: ReadStage, p?: number) => void): Promise<string> {
  onStage("ocr-load");
  const { createWorker } = await import("tesseract.js");
  // English first: names are Greek but units, abbreviations (HDL, MCV, CRP) and decimals read far better this way.
  const worker = await createWorker(["eng", "ell"], 1, {
    workerPath: abs("/ocr/worker.min.js"),
    corePath: abs("/ocr/core"),
    langPath: abs("/ocr/lang"),
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onStage("ocr", m.progress);
    },
  });
  try {
    let text = "";
    for (const img of images) {
      const { data } = await worker.recognize(img);
      text += `${data.text}\n`;
    }
    return text;
  } finally {
    await worker.terminate();
  }
}

/** OCR works best at ~2400 px on the long side: phone photos (12+ MP) are scaled down, screenshots scaled up. */
async function imageToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(3, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

/** The report's plain text, one table row per line. */
export async function readLabText(file: File, onStage: (s: ReadStage, progress?: number) => void = () => {}): Promise<string> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    onStage("pdf");
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const lines: string[] = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      lines.push(...rowsFromItems(content.items as { str: string; transform: number[] }[]));
    }
    const text = lines.join("\n");
    // A scanned PDF has (almost) no text layer: render the pages and OCR them instead.
    if (text.replace(/\s/g, "").length > 80) return text;
    const canvases: HTMLCanvasElement[] = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const c = document.createElement("canvas");
      c.width = viewport.width;
      c.height = viewport.height;
      await page.render({ canvas: c, viewport }).promise;
      canvases.push(c);
    }
    return ocrCanvases(canvases, onStage);
  }
  return ocrCanvases([await imageToCanvas(file)], onStage);
}
