import type { GroundedAnswer } from "./types.js";

function escapeLabel(text: string): string {
  return text.replace(/[[\]\\]/g, "\\$&");
}

/**
 * Answer text with `[n]` markers after each verified claim, where `n` is the 1-based
 * position of the cited source in `answer.sources`. Claims without verified offsets
 * keep their text unmarked rather than receiving a guessed position.
 */
export function citeGroundedAnswer(answer: GroundedAnswer): string {
  const position = new Map(answer.sources.map((source, index) => [source.id, index + 1]));
  const markers = new Map<number, Set<number>>();
  for (const support of answer.supports) {
    if (support.end === undefined) continue;
    const numbers = markers.get(support.end) ?? new Set<number>();
    for (const id of support.sourceIds) {
      const number = position.get(id);
      if (number !== undefined) numbers.add(number);
    }
    if (numbers.size > 0) markers.set(support.end, numbers);
  }
  let text = answer.text;
  for (const [end, numbers] of [...markers].sort((a, b) => b[0] - a[0])) {
    text = `${text.slice(0, end)}${[...numbers].sort((a, b) => a - b).map((number) => `[${number}]`).join("")}${text.slice(end)}`;
  }
  return text;
}

/** Markdown brief: cited answer, numbered sources, requested-URL status, and executed queries. */
export function renderGroundedAnswer(answer: GroundedAnswer): string {
  const sections = [citeGroundedAnswer(answer).trim()];
  if (answer.citations === "sources-only") {
    sections.push("Note: Google returned no claim-level citations. The sources below were searched, but no claim is verified against them.");
  }
  sections.push(["Sources:", ...answer.sources.map((source, index) => `${index + 1}. [${escapeLabel(source.title)}](${source.url})${source.resolved ? "" : " (unresolved redirect)"}`)].join("\n"));
  if (answer.urlRetrievals.length > 0) {
    sections.push(["Requested URLs:", ...answer.urlRetrievals.map((item) => `- ${item.url}: ${item.status}`)].join("\n"));
  }
  if (answer.queries.length > 0) sections.push(`Search queries: ${answer.queries.map((query) => `\`${query}\``).join(", ")}`);
  sections.push(`Grounded by Google Search via ${answer.transport} (${answer.model})`);
  return sections.join("\n\n");
}
