import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { getDocumentProxy } from "unpdf";

const DEFAULT_MAX_PAGES = 100;
const DEFAULT_OUTPUT_DIR = join(homedir(), "Downloads");

export interface PdfExtractResult {
  title: string;
  pages: number;
  chars: number;
  outputPath: string;
  content: string;
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

function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 100).replace(/^-|-$/g, "") || "document";
}

export async function extractPdfToMarkdown(buffer: ArrayBuffer, url: string): Promise<PdfExtractResult> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const metadata = await pdf.getMetadata();
  const metadataInfo = metadata.info && typeof metadata.info === "object" ? metadata.info as Record<string, unknown> : null;
  const title = (typeof metadataInfo?.Title === "string" && metadataInfo.Title.trim()) || extractTitleFromUrl(url);
  const pagesToExtract = Math.min(pdf.numPages, DEFAULT_MAX_PAGES);
  const lines: string[] = [`# ${title}`, "", `> Source: ${url}`, `> Pages: ${pdf.numPages}${pdf.numPages > pagesToExtract ? ` (extracted first ${pagesToExtract})` : ""}`, "", "---", ""];
  for (let i = 1; i <= pagesToExtract; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: unknown) => (item as { str?: string }).str || "").join(" ").replace(/\s+/g, " ").trim();
    if (pageText) {
      if (i > 1) lines.push("", `<!-- Page ${i} -->`, "");
      lines.push(pageText);
    }
  }
  const content = lines.join("\n");
  await mkdir(DEFAULT_OUTPUT_DIR, { recursive: true });
  const outputPath = join(DEFAULT_OUTPUT_DIR, sanitizeFilename(title) + ".md");
  await writeFile(outputPath, content, "utf8");
  return { title, pages: pdf.numPages, chars: content.length, outputPath, content };
}
