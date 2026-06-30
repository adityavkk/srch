/**
 * Canonical accessor for the text body of a fetched document.
 *
 * Fetch document payloads expose their text on `content` (a string). Some
 * legacy/alternate payloads may instead expose `text`. This is the one blessed
 * way to read document text without hand-writing `unknown`/`any` narrowing.
 *
 * Returns "" for missing, non-object, or non-string-bodied payloads.
 */
export function documentText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Partial<Record<"content" | "text", unknown>>;
  if (typeof p.content === "string") return p.content;
  if (typeof p.text === "string") return p.text;
  return "";
}
