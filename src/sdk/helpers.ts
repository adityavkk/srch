/**
 * Canonical accessor for the text body of a fetched document.
 *
 * Fetch document payloads expose their body on `content` (a string). Other
 * source payloads may use top-level `text` for their body, such as bird, code,
 * deepwiki, and context7. This helper checks `text` as a defensive fallback
 * for unknown or hand-built inputs.
 *
 * It intentionally does not read nested `content.text` from web inline payloads.
 * Returns "" for missing, non-object, or non-string-bodied payloads.
 */
export function documentText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Partial<Record<"content" | "text", unknown>>;
  if (typeof p.content === "string") return p.content;
  if (typeof p.text === "string") return p.text;
  return "";
}
