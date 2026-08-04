import * as pdfjsLib from "pdfjs-dist";

// pdf.js runs its parser in a web worker. Vite resolves this URL at build time
// and bundles the worker alongside the app, so no CDN and no network fetch.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface Word {
  text: string;
  x: number;
  y: number;
  width: number;
}

/** Two text runs count as the same line when their baselines are within this many points. */
const LINE_TOLERANCE = 3;
/** A horizontal gap wider than this (relative to page width) reads as a column break. */
const COLUMN_GAP_RATIO = 0.12;
/** Below this, a PDF is almost certainly scanned images rather than real text. */
const MIN_USEFUL_CHARS = 120;

/**
 * Group words into lines by baseline, then emit them left-to-right.
 *
 * Resumes are frequently two-column. Reading a page in raw PDF order, or naively
 * sorting by y alone, interleaves the columns ("Python 2024 React 2023") and the
 * model then reads skills and dates as one sentence. So when a line has a wide
 * horizontal gap, the page is split at that gap and the left column is emitted
 * in full before the right one.
 */
function wordsToText(words: Word[], pageWidth: number): string {
  if (words.length === 0) return "";

  const lines: Word[][] = [];
  for (const word of [...words].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - word.y) <= LINE_TOLERANCE) {
      line.push(word);
    } else {
      lines.push([word]);
    }
  }

  // Detect a column boundary: an x position that most lines leave empty.
  const gapThreshold = pageWidth * COLUMN_GAP_RATIO;
  let splitX: number | null = null;
  const candidates: number[] = [];
  for (const line of lines) {
    const sorted = [...line].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width);
      if (gap > gapThreshold) candidates.push(sorted[i].x);
    }
  }
  // Only treat it as a real column if a good share of lines agree on the split.
  if (candidates.length >= Math.max(3, lines.length * 0.3)) {
    candidates.sort((a, b) => a - b);
    splitX = candidates[Math.floor(candidates.length / 2)];
  }

  const render = (ls: Word[][]) =>
    ls
      .map((line) =>
        [...line]
          .sort((a, b) => a.x - b.x)
          .map((w) => w.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean)
      .join("\n");

  if (splitX === null) return render(lines);

  const left = lines.map((l) => l.filter((w) => w.x < splitX!)).filter((l) => l.length);
  const right = lines.map((l) => l.filter((w) => w.x >= splitX!)).filter((l) => l.length);
  return `${render(left)}\n${render(right)}`.trim();
}

export interface PdfExtractResult {
  text: string;
  pages: number;
  /** True when the PDF carries no real text layer — i.e. it is a scan and needs OCR. */
  likelyScanned: boolean;
}

/**
 * Pull the text out of a PDF in the browser, preserving reading order.
 *
 * Runs entirely on the student's machine: no upload to a third party, no API
 * cost, and no server time limit. The extracted text is what gets sent on for
 * analysis, which is also what lets a text-only model handle PDFs at all.
 */
export async function extractPdfText(file: File): Promise<PdfExtractResult> {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;

  const pageTexts: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    const words: Word[] = [];
    for (const item of content.items) {
      // Ignore the structural markers pdf.js interleaves with real text runs.
      if (!("str" in item) || !item.str.trim()) continue;
      words.push({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width ?? 0,
      });
    }

    pageTexts.push(wordsToText(words, viewport.width));
    page.cleanup();
  }

  await doc.destroy();

  const text = pageTexts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    text,
    pages: doc.numPages,
    likelyScanned: text.replace(/\s/g, "").length < MIN_USEFUL_CHARS,
  };
}
