import { errorMessage } from "../core/http.js";
import { exaBodyChars, parseExaFetchResults, parseExaSearchResults, splitExaSearchBlocks } from "../upstream/exa-format.js";
import { callExaMcpRaw, exaMcpText, listExaMcpTools, type ExaMcpTool } from "../upstream/exa-mcp.js";
import { EXA_FETCH_TOOL, EXA_SEARCH_TOOL, exaFetchArguments, exaSearchArguments } from "../upstream/exa.js";

export const EXA_INSPECT_QUERY = "TypeScript handbook page that explains the satisfies operator";

export type ExaReplyCheck = {
  tool: string;
  rawChars: number;
  bodyChars: number;
  items: number;
  itemsWithText: number;
  // Results whose own part of the reply had text that srch did not keep.
  itemsMissingText: number;
};

export type ExaInspectReport = {
  status: "ok" | "warn";
  warnings: string[];
  tools: ExaMcpTool[];
  search?: ExaReplyCheck;
  fetch?: ExaReplyCheck & { url: string };
};

// Compare the arguments srch sends with the live tools/list schema.
export function diagnoseExaArguments(tools: ExaMcpTool[], toolName: string, sent: string[]): string[] {
  const tool = tools.find((item) => item.name === toolName);
  if (!tool) return [`${toolName} is missing from tools/list`];
  return [
    ...sent.filter((name) => !tool.arguments.includes(name)).map((name) => `${toolName}: srch sends "${name}", which tools/list does not list`),
    ...tool.required.filter((name) => !sent.includes(name)).map((name) => `${toolName}: tools/list requires "${name}", which srch does not send`)
  ];
}

// Warn when the reply carries text that the parsed results lost.
export function diagnoseExaReply(check: ExaReplyCheck): string[] {
  if (check.items === 0) {
    return [check.bodyChars > 0
      ? `${check.tool}: reply has ${check.bodyChars} characters of text, but srch parsed no results`
      : `${check.tool}: reply has no results`];
  }
  return check.itemsMissingText > 0
    ? [`${check.tool}: ${check.itemsMissingText} of ${check.items} results have no text, but the reply has ${check.bodyChars} characters of text`]
    : [];
}

async function checkTools(query: string, signal?: AbortSignal): Promise<{ tools: ExaMcpTool[]; warnings: string[] }> {
  try {
    const tools = await listExaMcpTools(signal);
    return {
      tools,
      warnings: [
        ...diagnoseExaArguments(tools, EXA_SEARCH_TOOL, Object.keys(exaSearchArguments(query))),
        ...diagnoseExaArguments(tools, EXA_FETCH_TOOL, Object.keys(exaFetchArguments([])))
      ]
    };
  } catch (error) {
    return { tools: [], warnings: [`tools/list failed: ${errorMessage(error)}`] };
  }
}

async function checkSearch(query: string, signal?: AbortSignal): Promise<{ check?: ExaReplyCheck; firstUrl?: string; warnings: string[] }> {
  try {
    const text = exaMcpText(await callExaMcpRaw(EXA_SEARCH_TOOL, exaSearchArguments(query, { numResults: 3 }), signal));
    const hits = parseExaSearchResults(text);
    const missing = splitExaSearchBlocks(text).filter((block) => exaBodyChars(block) > 0 && parseExaSearchResults(block).every((hit) => !hit.text));
    const check = { tool: EXA_SEARCH_TOOL, rawChars: text.length, bodyChars: exaBodyChars(text), items: hits.length, itemsWithText: hits.filter((hit) => hit.text).length, itemsMissingText: missing.length };
    return { check, firstUrl: hits.at(0)?.url, warnings: diagnoseExaReply(check) };
  } catch (error) {
    return { warnings: [`${EXA_SEARCH_TOOL} failed: ${errorMessage(error)}`] };
  }
}

async function checkFetch(url: string, signal?: AbortSignal): Promise<{ check?: ExaReplyCheck & { url: string }; warnings: string[] }> {
  try {
    const text = exaMcpText(await callExaMcpRaw(EXA_FETCH_TOOL, exaFetchArguments([url], 2_000), signal));
    const pages = parseExaFetchResults(text);
    const read = pages.flatMap((page) => page.kind === "page" ? [page] : []);
    const bodyChars = exaBodyChars(text);
    const check = { tool: EXA_FETCH_TOOL, url, rawChars: text.length, bodyChars, items: read.length, itemsWithText: read.filter((page) => page.text).length, itemsMissingText: bodyChars > 0 ? read.filter((page) => !page.text).length : 0 };
    const failed = pages.flatMap((page) => page.kind === "error" ? [`${EXA_FETCH_TOOL}: could not read ${page.url}: ${page.error}`] : []);
    return { check, warnings: [...failed, ...(failed.length > 0 && read.length === 0 ? [] : diagnoseExaReply(check))] };
  } catch (error) {
    return { warnings: [`${EXA_FETCH_TOOL} failed: ${errorMessage(error)}`] };
  }
}

// Live smoke check of the free Exa MCP: schema drift, and replies whose text srch drops.
// Calls run one after another; the free tier rate-limits bursts.
export async function inspectExa(query = EXA_INSPECT_QUERY, signal?: AbortSignal): Promise<ExaInspectReport> {
  const toolCheck = await checkTools(query, signal);
  const searchCheck = await checkSearch(query, signal);
  const fetchCheck = searchCheck.firstUrl ? await checkFetch(searchCheck.firstUrl, signal) : { warnings: [] };
  const warnings = [...toolCheck.warnings, ...searchCheck.warnings, ...fetchCheck.warnings];
  return {
    status: warnings.length > 0 ? "warn" : "ok",
    warnings,
    tools: toolCheck.tools,
    ...(searchCheck.check ? { search: searchCheck.check } : {}),
    ...(fetchCheck.check ? { fetch: fetchCheck.check } : {})
  };
}

export function formatExaInspect(report: ExaInspectReport): string {
  const replyLine = (check: ExaReplyCheck) => `${check.tool}: ${check.items} results, ${check.itemsWithText} with text, ${check.bodyChars} text characters in reply`;
  return [
    `Exa MCP: ${report.status}`,
    ...report.warnings.map((warning) => `  warning: ${warning}`),
    `tools: ${report.tools.map((tool) => `${tool.name}(${tool.arguments.join(", ")})`).join(" ") || "none"}`,
    ...(report.search ? [replyLine(report.search)] : []),
    ...(report.fetch ? [`${replyLine(report.fetch)} (${report.fetch.url})`] : [])
  ].join("\n");
}
