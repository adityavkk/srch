// Parsers for the plain-text replies of Exa's free MCP tools.
//
// web_search_exa returns one block per hit, separated by "---" lines:
//   Title: … / URL: … / Published: … / Author: … / Highlights: (text follows)
// Older replies used "Published Date:" and "Text: …" instead. Both are accepted.
//
// web_fetch_exa returns pages back to back with no separator:
//   # <title> / URL: … / [Published: …] / [Author: …] / blank line / markdown
// A failed URL becomes one line: "Error fetching <url>: <code>".

export interface ExaSearchHit {
  title: string;
  url: string;
  text: string;
  publishedDate?: string;
  author?: string;
}

export type ExaFetchedPage =
  | { kind: "page"; url: string; title: string; text: string; publishedDate?: string; author?: string }
  | { kind: "error"; url: string; error: string };

const FIELD_LINE = /^([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)?):(?: (.*))?$/;
const BODY_MARKERS = new Set(["Highlights", "Text"]);
const FETCH_FIELDS = new Set(["Published", "Published Date", "Author"]);
const FETCH_ERROR = /^Error fetching (\S+): (.*)$/;

function lines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "N/A" ? trimmed : undefined;
}

function metadata(fields: Map<string, string>): { publishedDate?: string; author?: string } {
  const publishedDate = present(fields.get("Published") ?? fields.get("Published Date"));
  const author = present(fields.get("Author"));
  return { ...(publishedDate ? { publishedDate } : {}), ...(author ? { author } : {}) };
}

function isSearchHitStart(all: string[], index: number): boolean {
  if (FIELD_LINE.exec(all[index])?.[1] !== "Title") return false;
  for (let next = index + 1; next < all.length; next++) {
    const field = FIELD_LINE.exec(all[next]);
    if (!field || BODY_MARKERS.has(field[1])) return false;
    if (field[1] === "URL") return true;
  }
  return false;
}

function parseSearchHit(block: string[]): ExaSearchHit | null {
  const fields = new Map<string, string>();
  const body: string[] = [];
  let inHeader = true;
  for (const line of block) {
    if (!inHeader) {
      body.push(line);
      continue;
    }
    const field = FIELD_LINE.exec(line);
    if (field && !BODY_MARKERS.has(field[1])) {
      fields.set(field[1], field[2] ?? "");
      continue;
    }
    // A body marker ends the header. Without one, the first non-field line starts the body.
    inHeader = false;
    if (!field) body.push(line);
    else if (field[2]) body.push(field[2]);
  }

  const url = present(fields.get("URL"));
  if (!url) return null;
  return {
    title: present(fields.get("Title")) ?? "",
    url,
    text: body.join("\n").replace(/(?:^|\n)-{3,}\s*$/, "").trim(),
    ...metadata(fields)
  };
}

// Raw text of each hit, from its Title line to the next hit.
export function splitExaSearchBlocks(text: string): string[] {
  const all = lines(text);
  const starts = all.flatMap((_, index) => isSearchHitStart(all, index) ? [index] : []);
  return starts.map((start, index) => all.slice(start, starts[index + 1] ?? all.length).join("\n"));
}

export function parseExaSearchResults(text: string): ExaSearchHit[] {
  return splitExaSearchBlocks(text).flatMap((block) => {
    const hit = parseSearchHit(lines(block));
    return hit ? [hit] : [];
  });
}

function isFetchPageStart(all: string[], index: number): boolean {
  return all[index].startsWith("# ") && (all[index + 1]?.startsWith("URL: ") ?? false);
}

function parseFetchSection(section: string[]): ExaFetchedPage {
  const [heading = "", urlLine = "", ...rest] = section;
  const error = FETCH_ERROR.exec(heading);
  if (error) return { kind: "error", url: error[1], error: error[2].trim() };

  const fields = new Map<string, string>();
  let bodyStart = 0;
  for (; bodyStart < rest.length; bodyStart++) {
    const field = FIELD_LINE.exec(rest[bodyStart]);
    if (!field || !FETCH_FIELDS.has(field[1])) break;
    fields.set(field[1], field[2] ?? "");
  }

  const title = heading.slice(2).trim();
  return {
    kind: "page",
    url: urlLine.slice(5).trim(),
    title: title === "(no title)" ? "" : title,
    text: rest.slice(bodyStart).join("\n").trim(),
    ...metadata(fields)
  };
}

export function parseExaFetchResults(text: string): ExaFetchedPage[] {
  const all = lines(text);
  const starts = all.flatMap((line, index) => FETCH_ERROR.test(line) || isFetchPageStart(all, index) ? [index] : []);
  return starts.map((start, index) => parseFetchSection(all.slice(start, starts[index + 1] ?? all.length)));
}

// Plain one-line excerpt of markdown-ish text, cut at a word boundary.
export function excerpt(text: string, maxChars = 300): string {
  const plain = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*(?:```|~~~).*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxChars) return plain;
  const cut = plain.slice(0, maxChars - 3);
  const space = cut.lastIndexOf(" ");
  return `${(space > maxChars / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}
