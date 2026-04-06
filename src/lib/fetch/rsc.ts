export interface RscExtractResult {
  title: string;
  content: string;
}

export function extractRscContent(html: string): RscExtractResult | null {
  if (!html.includes("self.__next_f.push")) return null;

  const chunkMap = new Map<string, string>();
  const scriptRegex = /<script>self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g;

  for (const match of html.matchAll(scriptRegex)) {
    let content: string;
    try {
      content = JSON.parse('"' + match[1] + '"');
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      const colonIdx = line.indexOf(":");
      if (colonIdx <= 0 || colonIdx > 4) continue;
      const id = line.slice(0, colonIdx);
      if (!/^[0-9a-f]+$/i.test(id)) continue;
      const payload = line.slice(colonIdx + 1);
      if (!payload) continue;
      const existing = chunkMap.get(id);
      if (!existing || payload.length > existing.length) chunkMap.set(id, payload);
    }
  }

  if (chunkMap.size === 0) return null;
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
  const title = titleMatch?.[1]?.split("|")[0]?.trim() || "";

  const parsedCache = new Map<string, unknown>();
  function getParsedChunk(id: string): unknown | null {
    if (parsedCache.has(id)) return parsedCache.get(id) ?? null;
    const chunk = chunkMap.get(id);
    if (!chunk || !chunk.startsWith("[")) {
      parsedCache.set(id, null);
      return null;
    }
    try {
      const parsed = JSON.parse(chunk);
      parsedCache.set(id, parsed);
      return parsed;
    } catch {
      parsedCache.set(id, null);
      return null;
    }
  }

  const visitedRefs = new Set<string>();
  function extractNode(node: unknown): string {
    if (node == null) return "";
    if (typeof node === "string") {
      const refMatch = node.match(/^\$L([0-9a-f]+)$/i);
      if (refMatch) {
        const refId = refMatch[1];
        if (visitedRefs.has(refId)) return "";
        visitedRefs.add(refId);
        const refNode = getParsedChunk(refId);
        const result = refNode ? extractNode(refNode) : "";
        visitedRefs.delete(refId);
        return result;
      }
      if (node === "$undefined" || node === "$" || /^\$[A-Z]/.test(node)) return "";
      return node.trim() ? node : "";
    }
    if (typeof node === "number") return String(node);
    if (!Array.isArray(node)) return "";
    if (node[0] === "$" && typeof node[1] === "string") {
      const tag = node[1] as string;
      const props = (node[3] || {}) as Record<string, unknown>;
      const children = props.children;
      const content = children ? extractNode(children) : "";
      switch (tag) {
        case "h1": return `# ${content.trim()}\n\n`;
        case "h2": return `## ${content.trim()}\n\n`;
        case "h3": return `### ${content.trim()}\n\n`;
        case "p": return `${content.trim()}\n\n`;
        case "li": return `- ${content.trim()}\n`;
        case "ul":
        case "ol": return content + "\n";
        case "code": return `\`${content}\``;
        case "pre": return `\`\`\`\n${content}\n\`\`\`\n\n`;
        case "strong": return `**${content}**`;
        case "em": return `*${content}*`;
        case "a": return props.href ? `[${content}](${String(props.href)})` : content;
        default: return content;
      }
    }
    return node.map((n) => extractNode(n)).join("");
  }

  const mainChunk = getParsedChunk("23");
  if (mainChunk) {
    const content = extractNode(mainChunk).replace(/\n{3,}/g, "\n\n").trim();
    if (content.length > 100) return { title, content };
  }
  return null;
}
