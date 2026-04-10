import { createClient, loadConfig, type BirdEvidencePayload, type DocsEvidencePayload, type FetchEvidencePayload, type RunError, type RunResult } from "../../sdk.js";
import type { WebEvidencePayload } from "../../sdk/sources/web-shared.js";
import type { CodeTextEvidencePayload } from "../../sdk.js";

export type RenderedCommand =
  | { kind: "ok"; data: Record<string, unknown>; text: string }
  | { kind: "error"; error: RunError };

function firstPayload<T>(result: RunResult): T | null {
  if (result.kind !== "success") return null;
  return result.evidence[0]?.payload as T | null;
}

function deriveWebAnswer(result: RunResult): string {
  if (result.kind !== "success") return "";
  const payload = result.evidence[0]?.payload as WebEvidencePayload<{ response?: { answer?: string } }> | undefined;
  const answer = payload?.native && typeof payload.native === "object" && "response" in payload.native
    ? (payload.native.response as { answer?: string } | undefined)?.answer
    : undefined;
  if (answer) return answer;
  return result.evidence.map((item) => {
    const web = item.payload as WebEvidencePayload;
    return web.snippet || web.title;
  }).join("\n\n");
}

export async function createSdkClient(trace = false) {
  const config = await loadConfig();
  return createClient({ config: config ?? undefined, trace });
}

export async function renderHome(trace = false): Promise<string> {
  const client = await createSdkClient(trace);
  const status = await client.status();
  const domainLine = `srch: ${status.domains.length} domains, ${status.summary.total} sources (${status.summary.healthy}/${status.summary.total} healthy)`;
  const domains = `domains: ${status.domains.join(", ")}`;
  const recent = status.recentRuns.length > 0
    ? `recent: ${status.recentRuns.map((item) => `${item.domain} \"${item.query}\" (${item.ago})`).join(", ")}`
    : null;
  return [domainLine, domains, recent, "help: search <domain> <query> | search --help for full reference"].filter(Boolean).join("\n");
}

export async function runWebCommand(query: string, options: { provider?: "auto" | "exa" | "brave" | "gemini" | "perplexity"; hq?: boolean; trace?: boolean }): Promise<RenderedCommand> {
  const client = await createSdkClient(options.trace);
  const result = await client.run({ domain: "web", query, provider: options.provider, hq: options.hq });
  if (result.kind === "error") return { kind: "error", error: result };

  const answer = deriveWebAnswer(result);
  const results = result.kind !== "success"
    ? []
    : result.evidence.map((item) => {
        const payload = item.payload as WebEvidencePayload;
        return { title: payload.title, url: payload.url, snippet: payload.snippet };
      });
  const provider = result.kind === "success" ? result.evidence[0]?.source ?? "auto" : "auto";
  const text = result.kind === "empty"
    ? `0 results for \"${query}\"`
    : [answer || "No summary.", ...(results.length > 0 ? ["", "Sources:", ...results.map((item, index) => `${index + 1}. ${item.title}\n   ${item.url}`)] : [])].join("\n");

  return {
    kind: "ok",
    data: { query, provider, answer, results, trace: result.trace },
    text
  };
}

export async function runFetchCommand(url: string, options: { trace?: boolean }): Promise<RenderedCommand> {
  const client = await createSdkClient(options.trace);
  const result = await client.run({ domain: "fetch", query: url });
  if (result.kind === "error") return { kind: "error", error: result };
  if (result.kind !== "success") {
    return { kind: "error", error: { ...result, kind: "error", error: { code: "fetch_empty", message: `No content for ${url}` } } };
  }

  const payload = firstPayload<FetchEvidencePayload>(result)!;
  return {
    kind: "ok",
    data: { alias: "fetch", canonicalCommand: "fetch-content", url: payload.url, title: payload.title, content: payload.content, trace: result.trace },
    text: `# ${payload.title}\n\n${payload.content}`
  };
}

export async function runCodeCommand(query: string, options: { maxTokens?: number; trace?: boolean }): Promise<RenderedCommand> {
  const client = await createSdkClient(options.trace);
  const result = await client.run({ domain: "code", query, maxTokens: options.maxTokens });
  if (result.kind === "error") return { kind: "error", error: result };

  const text = result.kind === "empty"
    ? `0 results for \"${query}\"`
    : result.evidence.map((item) => {
        const payload = item.payload as CodeTextEvidencePayload;
        return `${payload.title}\n${payload.text}`;
      }).join("\n\n---\n\n");

  return { kind: "ok", data: { ...result }, text };
}

export async function runDocsCommand(query: string, options: { trace?: boolean }): Promise<RenderedCommand> {
  const client = await createSdkClient(options.trace);
  const result = await client.run({ domain: "docs", query });
  if (result.kind === "error") return { kind: "error", error: result };

  const rows = result.kind !== "success"
    ? []
    : result.evidence.map((item) => item.payload as DocsEvidencePayload);
  const text = rows.length === 0
    ? "No results."
    : rows.flatMap((item, index) => [`${index + 1}. ${item.title}`, `   ${item.file}`, `   score=${item.score.toFixed(3)}`, ...(item.snippet ? [`   ${item.snippet}`] : [])]).join("\n");

  return { kind: "ok", data: { ...result }, text };
}

export async function runSocialCommand(query: string, options: { count?: number; trace?: boolean }): Promise<RenderedCommand> {
  const client = await createSdkClient(options.trace);
  const result = await client.run({ domain: "social", query, count: options.count });
  if (result.kind === "error") return { kind: "error", error: result };

  const tweets = result.kind !== "success"
    ? []
    : result.evidence.map((item) => item.payload as BirdEvidencePayload);
  const text = tweets.length === 0
    ? "No tweets found."
    : tweets.map((tweet, index) => `${index + 1}. @${tweet.author}${tweet.createdAt ? " " + tweet.createdAt : ""}\n   ${tweet.text.split("\n")[0]}\n   ${tweet.url}`).join("\n");

  return { kind: "ok", data: { ...result, count: tweets.length, tweets }, text };
}
