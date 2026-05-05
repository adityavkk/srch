import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import { parseHTML } from "linkedom";
import { API_BASE, DEFAULT_MODEL, getApiKey } from "../upstream/gemini-api.js";
import { errorMessage, withTimeout } from "../core/http.js";
import type { ExtractedImage, FetchContentOptions } from "../core/types.js";

const IMAGE_MARKDOWN = /!\[([^\]]*)\]\((<?)([^)>\s]+)\2(?:\s+"[^"]*")?\)/g;

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function resolveSrc(src: string, pageUrl: string): string {
  if (src.startsWith("data:")) return src;
  return new URL(src, pageUrl).toString();
}

function imageExt(src: string, mime?: string): string {
  const byMime: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg"
  };
  if (mime && byMime[mime]) return byMime[mime];
  const ext = extname(new URL(src).pathname).toLowerCase();
  return ext && ext.length <= 6 ? ext : ".img";
}

function mergeImages(images: ExtractedImage[]): ExtractedImage[] {
  const seen = new Map<string, ExtractedImage>();
  for (const image of images) {
    const existing = seen.get(image.src);
    if (!existing) seen.set(image.src, image);
    else if (!existing.alt && image.alt) existing.alt = image.alt;
  }
  return [...seen.values()];
}

function markdownUrl(value: string): string {
  return /\s/.test(value) ? `<${value}>` : value;
}

function markdownAlt(value: string): string {
  return value.replace(/[\[\]\\]/g, "").trim();
}

async function fetchImage(src: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mime: string }> {
  const response = await fetch(src, { signal: withTimeout(signal, 30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  return { bytes: new Uint8Array(await response.arrayBuffer()), mime };
}

async function describeImage(image: ExtractedImage, bytes: Uint8Array, mime: string, signal?: AbortSignal): Promise<string> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("Gemini API key not configured");

  const request = {
    contents: [{
      parts: [
        { text: "Describe this web page image for an agent reading extracted markdown. Use one concise sentence. If it is a diagram, explain the structure and key labels." },
        { inline_data: { mime_type: mime, data: Buffer.from(bytes).toString("base64") } }
      ]
    }]
  };

  const response = await fetch(`${API_BASE}/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])])
  });
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}: ${response.statusText}`);
  const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join(" ").trim();
  if (!text) throw new Error("Gemini returned no image description");
  return text;
}

export function collectImagesFromHtml(html: string, pageUrl: string): ExtractedImage[] {
  const { document } = parseHTML(`<body>${html}</body>`);
  return mergeImages([...document.querySelectorAll("img")].flatMap((img) => {
    const raw = img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-original");
    if (!raw) return [];
    try {
      return [{ src: resolveSrc(raw, pageUrl), alt: img.getAttribute("alt")?.trim() ?? "" }];
    } catch {
      return [];
    }
  }));
}

export function collectImagesFromMarkdown(markdown: string, pageUrl: string): ExtractedImage[] {
  return mergeImages([...markdown.matchAll(IMAGE_MARKDOWN)].flatMap((match) => {
    try {
      return [{ alt: match[1]?.trim() ?? "", src: resolveSrc(match[3]!, pageUrl) }];
    } catch {
      return [];
    }
  }));
}

export async function enhanceMarkdownImages(
  content: string,
  pageUrl: string,
  htmlImages: ExtractedImage[] = [],
  options: FetchContentOptions = {},
  signal?: AbortSignal
): Promise<{ content: string; images: ExtractedImage[] }> {
  const markdownImages = collectImagesFromMarkdown(content, pageUrl);
  const images = mergeImages([...markdownImages, ...htmlImages]);
  if (!images.length) return { content, images: [] };

  const markdownSrcs = new Set(markdownImages.map((image) => image.src));
  const imageBySrc = new Map(images.map((image) => [image.src, image]));

  await Promise.all(images.filter((image) => markdownSrcs.has(image.src)).map(async (image) => {
    if (!options.downloadImagesDir && !options.describeImages) return;
    try {
      const fetched = await fetchImage(image.src, signal);
      image.bytes = fetched.bytes.byteLength;
      image.mime = fetched.mime;

      if (options.downloadImagesDir) {
        await mkdir(options.downloadImagesDir, { recursive: true });
        image.localPath = join(options.downloadImagesDir, `${sha1(image.src)}${imageExt(image.src, fetched.mime)}`);
        await writeFile(image.localPath, fetched.bytes);
      }

      if (options.describeImages) image.generatedAlt = await describeImage(image, fetched.bytes, fetched.mime, signal);
    } catch (error) {
      image.error = errorMessage(error);
    }
  }));

  const rewritten = content.replace(IMAGE_MARKDOWN, (match, alt: string, _open: string, rawSrc: string) => {
    let absolute: string;
    try {
      absolute = resolveSrc(rawSrc, pageUrl);
    } catch {
      return match;
    }
    const image = imageBySrc.get(absolute);
    if (!image) return match;
    const nextAlt = image.generatedAlt || alt;
    const nextSrc = image.localPath || rawSrc;
    return `![${markdownAlt(nextAlt)}](${markdownUrl(nextSrc)})`;
  });

  return { content: rewritten, images };
}
