#!/usr/bin/env node
import { loadConfig, getConfigPath } from "./lib/core/config.js";
import { fetchContent } from "./lib/fetch/content.js";
import { listHistory, addHistory } from "./lib/history/store.js";
import { codeSearch } from "./lib/search/code.js";
import { webSearch } from "./lib/search/web.js";
import { CODE_HELP, FETCH_HELP, HISTORY_HELP, ROOT_HELP, WEB_HELP } from "./lib/cli/help.js";
import type { SearchProvider } from "./lib/core/types.js";

function parseFlags(args: string[]): { flags: Map<string, string | boolean>; rest: string[] } {
  const flags = new Map<string, string | boolean>();
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, true);
    }
  }
  return { flags, rest };
}

function print(value: unknown, asJson: boolean): void {
  if (asJson) console.log(JSON.stringify(value, null, 2));
  else console.log(String(value));
}

function requireQuery(parts: string[], help: string): string {
  const query = parts.join(" ").trim();
  if (!query) {
    console.error(help);
    process.exit(1);
  }
  return query;
}

async function main(): Promise<void> {
  const [, , command, ...argv] = process.argv;
  if (!command || command === "help" || command === "--help") {
    console.log(ROOT_HELP);
    return;
  }

  const { flags, rest } = parseFlags(argv);
  const asJson = flags.has("json");

  if (command === "config") {
    const config = loadConfig();
    print(asJson ? { path: getConfigPath(), config } : getConfigPath(), asJson);
    return;
  }

  if (command === "web") {
    if (flags.has("help")) return void console.log(WEB_HELP);
    const query = requireQuery(rest, WEB_HELP);
    const provider = (flags.get("provider") as SearchProvider | undefined) ?? "auto";
    const result = await webSearch(query, provider);
    addHistory({ kind: "web", input: { query, provider }, output: result });
    if (asJson) return print(result, true);
    console.log(result.answer || "No summary.");
    if (result.results.length > 0) {
      console.log("\nSources:");
      for (const [index, item] of result.results.entries()) console.log(`${index + 1}. ${item.title}\n   ${item.url}`);
    }
    return;
  }

  if (command === "code") {
    if (flags.has("help")) return void console.log(CODE_HELP);
    const query = requireQuery(rest, CODE_HELP);
    const maxTokens = Number(flags.get("max-tokens") ?? 5000);
    const result = await codeSearch(query, maxTokens);
    addHistory({ kind: "code", input: { query, maxTokens }, output: { text: result } });
    return print(asJson ? { query, maxTokens, text: result } : result, asJson);
  }

  if (command === "fetch-content") {
    if (flags.has("help")) return void console.log(FETCH_HELP);
    const url = requireQuery(rest, FETCH_HELP);
    const result = await fetchContent(url);
    addHistory({ kind: "fetch", input: { url }, output: result });
    if (asJson) return print(result, true);
    if (result.error) {
      console.log(`Error: ${result.error}`);
      if (result.content) console.log(`\n${result.content}`);
      return;
    }
    console.log(`# ${result.title}\n`);
    console.log(result.content);
    return;
  }

  if (command === "history") {
    if (flags.has("help")) return void console.log(HISTORY_HELP);
    const kind = rest[0] as "web" | "code" | "fetch" | undefined;
    const entries = listHistory(kind);
    if (asJson) return print(entries, true);
    for (const entry of entries) console.log(`${entry.createdAt}  ${entry.kind}  ${entry.id}`);
    return;
  }

  console.error(ROOT_HELP);
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
