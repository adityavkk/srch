import { basename } from "node:path";
import { getDocumentProxy } from "unpdf";
import { MAX_DOCUMENT_BYTES, ResponseTooLargeError } from "./body.js";

const DEFAULT_MAX_PAGES = 100;

export interface PdfExtractResult {
  title: string;
  pages: number;
  chars: number;
  content: string;
  extractedPages: number;
  warnings: string[];
}

export function isPdf(url: string, contentType?: string): boolean {
  if (contentType?.includes("application/pdf")) return true;
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

function extractTitleFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return basename(pathname, ".pdf").replace(/[_-]+/g, " ").trim() || "document";
  } catch {
    return "document";
  }
}

export async function extractPdfToMarkdown(buffer: ArrayBuffer, url: string, signal?: AbortSignal): Promise<PdfExtractResult> {
  signal?.throwIfAborted();
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  try {
    const metadata = await pdf.getMetadata();
    const metadataInfo = metadata.info && typeof metadata.info === "object" ? metadata.info as Record<string, unknown> : null;
    const title = (typeof metadataInfo?.Title === "string" && metadataInfo.Title.trim()) || extractTitleFromUrl(url);
    const pagesToExtract = Math.min(pdf.numPages, DEFAULT_MAX_PAGES);
    const lines: string[] = [`# ${title}`, "", `> Source: ${url}`, `> Pages: ${pdf.numPages}${pdf.numPages > pagesToExtract ? ` (extracted first ${pagesToExtract})` : ""}`, "", "---", ""];
    const warnings: string[] = [];
    if (pdf.numPages > pagesToExtract) warnings.push(`PDF truncated: extracted ${pagesToExtract} of ${pdf.numPages} pages`);
    let textBytes = 0;
    for (let i = 1; i <= pagesToExtract; i++) {
      signal?.throwIfAborted();
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: unknown) => (item as { str?: string }).str || "").join(" ").replace(/\s+/g, " ").trim();
      textBytes += Buffer.byteLength(pageText);
      if (textBytes > MAX_DOCUMENT_BYTES) throw new ResponseTooLargeError();
      if (pageText) {
        if (i > 1) lines.push("", `<!-- Page ${i} -->`, "");
        lines.push(pageText);
      }
    }
    signal?.throwIfAborted();
    if (!textBytes) warnings.push("PDF contains no extractable text; scanned pages may require OCR");
    const content = lines.join("\n");
    return { title, pages: pdf.numPages, extractedPages: pagesToExtract, chars: content.length, content, warnings };
  } finally {
    await pdf.destroy();
  }
}
