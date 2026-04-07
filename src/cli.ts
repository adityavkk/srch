#!/usr/bin/env node
import { getConfigSafe, setProvider, setSecretRef, unsetField } from "./lib/config/commands.js";
import { getConfigPath } from "./lib/core/config.js";
import { inspectTools } from "./lib/cli/tools.js";
import { CONFIG_HELP } from "./lib/cli/config-help.js";
import { CODE_HELP, DOCS_HELP, FETCH_HELP, FLIGHTS_HELP, HISTORY_HELP, INSPECT_HELP, ROOT_HELP, WEB_HELP } from "./lib/cli/help.js";
import { TWITTER_HELP } from "./lib/cli/twitter-help.js";
import { fail, ok } from "./lib/cli/output.js";
import type { SearchProvider } from "./lib/core/types.js";
import { summarizeBestChunk } from "./lib/docs/format.js";
import { docsAddCollection, docsEmbed, docsListCollections, docsSearch, docsStatus, docsUpdate } from "./lib/docs/qmd.js";
import { fetchContent } from "./lib/fetch/content.js";
import { bookFlight, formatFlightLocationsText, formatFlightSearchText, getFlightsProfile, getFlightsSystemInfo, linkFlightsGithub, registerFlightsAgent, resolveFlightLocation, searchFlights, setupFlightsPayment, unlockFlightOffer, type LetsFGSearchOptions, type Passenger } from "./lib/flights/letsfg.js";
import { listHistory, addHistory } from "./lib/history/store.js";
import { codeSearch } from "./lib/search/code.js";
import { repoSearch } from "./lib/search/repo.js";
import { webSearch } from "./lib/search/web.js";
import { twitterSearch, twitterRead, twitterThread } from "./lib/upstream/bird.js";
import { createTraceSink } from "./lib/trace.js";

type FlagValue = string | boolean | string[];

function parseFlags(args: string[]): { flags: Map<string, FlagValue>; rest: string[] } {
  const flags = new Map<string, FlagValue>();
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
      const existing = flags.get(key);
      if (Array.isArray(existing)) existing.push(next);
      else if (typeof existing === "string") flags.set(key, [existing, next]);
      else flags.set(key, next);
      i++;
    } else {
      flags.set(key, true);
    }
  }
  return { flags, rest };
}

function getStringFlag(flags: Map<string, FlagValue>, key: string): string | undefined {
  const value = flags.get(key);
  if (Array.isArray(value)) return value.at(-1);
  return typeof value === "string" ? value : undefined;
}

function getStringFlags(flags: Map<string, FlagValue>, key: string): string[] {
  const value = flags.get(key);
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}

function getNumberFlag(flags: Map<string, FlagValue>, key: string): number | undefined {
  const value = getStringFlag(flags, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function printText(value: string): void {
  console.log(value);
}

function printJson(command: string[], data: unknown): void {
  console.log(JSON.stringify(ok(command, data), null, 2));
}

function exitJsonError(command: string[], message: string): never {
  console.error(JSON.stringify(fail(command, message), null, 2));
  process.exit(1);
}

function requireQuery(parts: string[], help: string, command: string[], asJson: boolean): string {
  const query = parts.join(" ").trim();
  if (!query) {
    if (asJson) exitJsonError(command, "Missing query");
    console.error(help);
    process.exit(1);
  }
  return query;
}

function parseFlightSearchOptions(flags: Map<string, FlagValue>): LetsFGSearchOptions {
  const cabin = getStringFlag(flags, "cabin");
  const sort = getStringFlag(flags, "sort");
  const returnDate = getStringFlag(flags, "return") ?? getStringFlag(flags, "return-date");
  const currency = getStringFlag(flags, "currency")?.toUpperCase();
  return {
    returnDate,
    adults: getNumberFlag(flags, "adults"),
    children: getNumberFlag(flags, "children"),
    infants: getNumberFlag(flags, "infants"),
    cabinClass: cabin === "M" || cabin === "W" || cabin === "C" || cabin === "F" ? cabin : undefined,
    maxStopovers: getNumberFlag(flags, "max-stopovers"),
    currency,
    limit: getNumberFlag(flags, "limit"),
    sort: sort === "price" || sort === "duration" ? sort : undefined,
    maxBrowsers: getNumberFlag(flags, "max-browsers")
  };
}

function parsePassengerJson(raw: string, command: string[], asJson: boolean): Passenger {
  try {
    const parsed = JSON.parse(raw) as Passenger;
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string" || typeof parsed.given_name !== "string" || typeof parsed.family_name !== "string" || typeof parsed.born_on !== "string") {
      throw new Error("Passenger JSON must include id, given_name, family_name, and born_on.");
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (asJson) exitJsonError(command, `Invalid passenger JSON: ${message}`);
    throw new Error(`Invalid passenger JSON: ${message}`);
  }
}

function parsePassengers(flags: Map<string, FlagValue>, command: string[], asJson: boolean): Passenger[] {
  const passengersJson = getStringFlag(flags, "passengers");
  if (passengersJson) {
    try {
      const parsed = JSON.parse(passengersJson) as unknown;
      if (!Array.isArray(parsed)) throw new Error("--passengers must be a JSON array.");
      return parsed.map((item) => parsePassengerJson(JSON.stringify(item), command, asJson));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (asJson) exitJsonError(command, `Invalid passengers JSON: ${message}`);
      throw new Error(`Invalid passengers JSON: ${message}`);
    }
  }

  const passengerValues = getStringFlags(flags, "passenger");
  if (passengerValues.length === 0) {
    if (asJson) exitJsonError(command, "Missing --passenger or --passengers");
    throw new Error("Missing --passenger or --passengers");
  }
  return passengerValues.map((value) => parsePassengerJson(value, command, asJson));
}

async function main(): Promise<void> {
  const [, , command, ...argv] = process.argv;
  if (!command || command === "help" || command === "--help") {
    console.log(ROOT_HELP);
    return;
  }

  const { flags, rest } = parseFlags(argv);
  const asJson = flags.has("json");
  const trace = createTraceSink(flags.has("verbose"));
  trace.step("cli", `${command} start`, { asJson, cwd: process.cwd() });

  try {
    if (command === "config") {
      if (flags.has("help")) {
        console.log(CONFIG_HELP);
        return;
      }
      const sub = rest[0];
      if (!sub) {
        const data = await trace.span("config", "inspect config", async () => ({ path: getConfigPath(), config: getConfigSafe() }));
        if (asJson) return printJson(["config"], { ...data, trace: trace.snapshot() });
        printText(getConfigPath());
        return;
      }
      if (sub === "set" && rest[1] === "provider" && rest[2]) {
        const config = await trace.span("config.set", "set provider", async () => setProvider(rest[2]!));
        if (asJson) return printJson(["config", "set", "provider"], { path: getConfigPath(), config, trace: trace.snapshot() });
        printText(`provider=${config.provider ?? "auto"}`);
        return;
      }
      if (sub === "set-secret-ref" && rest[1] && rest[2] && rest[3]) {
        const field = rest[1];
        const source = rest[2];
        const key = rest[3];
        const config = await trace.span("config.set-secret-ref", field, async () => setSecretRef(field, source, key));
        if (asJson) return printJson(["config", "set-secret-ref", field], { path: getConfigPath(), config, trace: trace.snapshot() });
        printText(`${field}=ref:${source}:${key}`);
        return;
      }
      if (sub === "unset" && rest[1]) {
        const field = rest[1];
        const config = await trace.span("config.unset", field, async () => unsetField(field));
        if (asJson) return printJson(["config", "unset", field], { path: getConfigPath(), config, trace: trace.snapshot() });
        printText(`${field}=unset`);
        return;
      }
      if (asJson) exitJsonError(["config"], "Invalid config command");
      console.error(CONFIG_HELP);
      process.exit(1);
    }

    if (command === "inspect") {
      if (flags.has("help") || rest[0] !== "tools") {
        console.log(INSPECT_HELP);
        return;
      }
      const result = await trace.span("inspect", "collect tool diagnostics", async () => inspectTools());
      if (asJson) return printJson(["inspect", "tools"], { ...result, trace: trace.snapshot() });
      printText(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "flights") {
      if (flags.has("help")) return void console.log(FLIGHTS_HELP);

      const sub = rest[0];
      const flightsSearchMode = !sub || !new Set(["search", "resolve", "register", "link-github", "unlock", "book", "setup-payment", "me", "system-info"]).has(sub);
      const searchArgs = flightsSearchMode ? rest : sub === "search" ? rest.slice(1) : [];

      if (flightsSearchMode || sub === "search") {
        const [origin, destination, dateFrom] = searchArgs;
        if (!origin || !destination || !dateFrom) {
          if (asJson) exitJsonError(sub === "search" ? ["flights", "search"] : ["flights"], "Usage: search flights <origin> <destination> <date>");
          console.error(FLIGHTS_HELP);
          process.exit(1);
        }
        const options = parseFlightSearchOptions(flags);
        trace.step("flights.search", "dispatch", { origin, destination, dateFrom, hasReturn: Boolean(options.returnDate), sort: options.sort });
        const data = await trace.span("flights.search", `${origin}-${destination}`, async () => searchFlights(origin, destination, dateFrom, options));
        addHistory({ kind: "flights", input: { origin, destination, dateFrom, options }, output: data });
        if (asJson) return printJson(sub === "search" ? ["flights", "search"] : ["flights"], { origin, destination, dateFrom, ...data, trace: trace.snapshot() });
        printText(formatFlightSearchText(data.result, data.offerSummaries, data.bestOffer));
        return;
      }

      if (sub === "resolve") {
        const query = requireQuery(rest.slice(1), FLIGHTS_HELP, ["flights", "resolve"], asJson);
        trace.step("flights.resolve", "dispatch", { queryChars: query.length });
        const data = await trace.span("flights.resolve", query, async () => resolveFlightLocation(query));
        if (asJson) return printJson(["flights", "resolve"], { ...data, trace: trace.snapshot() });
        printText(formatFlightLocationsText(query, data.locations));
        return;
      }

      if (sub === "register") {
        const name = getStringFlag(flags, "name");
        const email = getStringFlag(flags, "email");
        if (!name || !email) {
          if (asJson) exitJsonError(["flights", "register"], "Usage: search flights register --name <agent> --email <email>");
          console.error(FLIGHTS_HELP);
          process.exit(1);
        }
        const owner = getStringFlag(flags, "owner");
        const description = getStringFlag(flags, "description");
        trace.step("flights.register", "dispatch", { name, email });
        const data = await trace.span("flights.register", name, async () => registerFlightsAgent(name, email, owner, description));
        if (asJson) return printJson(["flights", "register"], { ...data, trace: trace.snapshot() });
        printText(JSON.stringify(data, null, 2));
        return;
      }

      if (sub === "link-github") {
        const username = rest[1];
        if (!username) {
          if (asJson) exitJsonError(["flights", "link-github"], "Usage: search flights link-github <username>");
          console.error(FLIGHTS_HELP);
          process.exit(1);
        }
        trace.step("flights.link-github", "dispatch", { username });
        const data = await trace.span("flights.link-github", username, async () => linkFlightsGithub(username));
        if (asJson) return printJson(["flights", "link-github"], { ...data, trace: trace.snapshot() });
        printText(JSON.stringify(data, null, 2));
        return;
      }

      if (sub === "unlock") {
        const offerId = rest[1];
        if (!offerId) {
          if (asJson) exitJsonError(["flights", "unlock"], "Usage: search flights unlock <offer_id>");
          console.error(FLIGHTS_HELP);
          process.exit(1);
        }
        trace.step("flights.unlock", "dispatch", { offerId });
        const data = await trace.span("flights.unlock", offerId, async () => unlockFlightOffer(offerId));
        if (asJson) return printJson(["flights", "unlock"], { ...data, trace: trace.snapshot() });
        printText(JSON.stringify(data, null, 2));
        return;
      }

      if (sub === "book") {
        const offerId = rest[1];
        if (!offerId) {
          if (asJson) exitJsonError(["flights", "book"], "Usage: search flights book <offer_id> --passenger '{...}' --email <email>");
          console.error(FLIGHTS_HELP);
          process.exit(1);
        }
        const email = getStringFlag(flags, "email");
        if (!email) {
          if (asJson) exitJsonError(["flights", "book"], "Missing --email");
          throw new Error("Missing --email");
        }
        const phone = getStringFlag(flags, "phone");
        const idempotencyKey = getStringFlag(flags, "idempotency-key");
        const passengers = parsePassengers(flags, ["flights", "book"], asJson);
        trace.step("flights.book", "dispatch", { offerId, passengers: passengers.length });
        const data = await trace.span("flights.book", offerId, async () => bookFlight(offerId, passengers, email, phone, idempotencyKey));
        if (asJson) return printJson(["flights", "book"], { ...data, trace: trace.snapshot() });
        printText(JSON.stringify(data, null, 2));
        return;
      }

      if (sub === "setup-payment") {
        const token = getStringFlag(flags, "token");
        trace.step("flights.setup-payment", "dispatch", { hasToken: Boolean(token) });
        const data = await trace.span("flights.setup-payment", token ? "with-token" : "default", async () => setupFlightsPayment(token));
        if (asJson) return printJson(["flights", "setup-payment"], { ...data, trace: trace.snapshot() });
        printText(JSON.stringify(data, null, 2));
        return;
      }

      if (sub === "me") {
        trace.step("flights.me", "dispatch", { hasApiKey: Boolean(process.env.LETSFG_API_KEY) });
        const data = await trace.span("flights.me", "profile", async () => getFlightsProfile());
        if (asJson) return printJson(["flights", "me"], { ...data, trace: trace.snapshot() });
        printText(JSON.stringify(data, null, 2));
        return;
      }

      if (sub === "system-info") {
        trace.step("flights.system-info", "dispatch", {});
        const data = await trace.span("flights.system-info", "systemInfo", async () => getFlightsSystemInfo());
        if (asJson) return printJson(["flights", "system-info"], { ...data, trace: trace.snapshot() });
        printText(JSON.stringify(data.info, null, 2));
        return;
      }

      if (asJson) exitJsonError(["flights"], "Unknown flights command");
      console.error(FLIGHTS_HELP);
      process.exit(1);
    }

    if (command === "web") {
      if (flags.has("help")) return void console.log(WEB_HELP);
      const query = requireQuery(rest, WEB_HELP, ["web"], asJson);
      const provider = (flags.get("provider") as SearchProvider | undefined) ?? "auto";
      const hq = flags.has("hq");
      trace.step("web", "dispatch", { provider, hq, queryChars: query.length });
      const result = await trace.span("web.search", hq ? "exa-paid" : provider, async () => webSearch(query, provider, { hq }));
      trace.step("web.result", "provider selected", { requestedProvider: provider, hq, provider: result.provider, nativeProvider: typeof result.native === "object" && result.native && "provider" in result.native ? String((result.native as { provider?: unknown }).provider) : undefined, resultCount: result.results.length });
      addHistory({ kind: "web", input: { query, provider }, output: result });
      if (asJson) return printJson(["web"], { query, requestedProvider: provider, ...result, trace: trace.snapshot() });
      console.log(result.answer || "No summary.");
      if (result.results.length > 0) {
        console.log("\nSources:");
        for (const [index, item] of result.results.entries()) console.log(`${index + 1}. ${item.title}\n   ${item.url}`);
      }
      return;
    }

    if (command === "code") {
      if (flags.has("help")) return void console.log(CODE_HELP);

      if (rest[0] === "repo") {
        const target = rest[1];
        const repoQuery = rest.slice(2).join(" ").trim();
        if (!target || !repoQuery) {
          if (asJson) exitJsonError(["code", "repo"], "Usage: search code repo <target> <query>");
          console.error(CODE_HELP);
          process.exit(1);
        }
        trace.step("code.repo", "resolve target", { target, queryChars: repoQuery.length });
        const result = await trace.span("code.repo.clone", target, async () => {
          const r = await repoSearch(target, repoQuery);
          trace.step("code.repo.search", "ripgrep complete", { matchCount: r.matchCount, truncated: r.truncated, cached: r.cached, cloned: r.cloned });
          return r;
        });
        addHistory({ kind: "code", input: { target, query: repoQuery, mode: "repo" }, output: result });
        if (asJson) return printJson(["code", "repo"], { ...result, trace: trace.snapshot() });
        if (result.matches.length === 0) {
          printText(`No matches in ${result.localPath}`);
          return;
        }
        printText(`${result.matchCount} matches in ${result.localPath}${result.cached ? " (cached)" : ""}${result.truncated ? " (truncated)" : ""}`);
        for (const m of result.matches) {
          console.log(`  ${m.file}:${m.line}  ${m.text}`);
        }
        return;
      }

      const query = requireQuery(rest, CODE_HELP, ["code"], asJson);
      const maxTokens = Number(flags.get("max-tokens") ?? 5000);
      trace.step("code", "dispatch", { maxTokens, queryChars: query.length });
      const result = await trace.span("code.search", "exa-mcp", async () => codeSearch(query, maxTokens));
      addHistory({ kind: "code", input: { query, maxTokens }, output: result });
      if (asJson) return printJson(["code"], { ...result, trace: trace.snapshot() });
      printText(result.text);
      if (result.secondary?.length) {
        for (const src of result.secondary) console.log(`\n[secondary: ${src.label}]`);
      }
      return;
    }

    if (command === "docs") {
      if (flags.has("help")) return void console.log(DOCS_HELP);

      if (rest[0] === "index") {
        const sub = rest[1];
        if (sub === "add") {
          const path = rest[2];
          const name = flags.get("name");
          const pattern = (flags.get("pattern") as string | undefined) ?? "**/*.md";
          if (!path || typeof name !== "string") {
            if (asJson) exitJsonError(["docs", "index", "add"], "Missing path or --name");
            console.error(DOCS_HELP);
            process.exit(1);
          }
          const result = await trace.span("docs.index.add", name, async () => docsAddCollection(path, name, pattern), { path, pattern });
          if (asJson) return printJson(["docs", "index", "add"], { path, name, pattern, collections: result, trace: trace.snapshot() });
          printText(`${result.length} collections`);
          return;
        }
        if (sub === "list") {
          const result = await trace.span("docs.index.list", "qmd collections", async () => docsListCollections());
          if (asJson) return printJson(["docs", "index", "list"], { collections: result, count: result.length, trace: trace.snapshot() });
          for (const item of result) console.log(`${item.name}\t${item.pwd}\t${item.doc_count}`);
          return;
        }
        if (sub === "update") {
          const result = await trace.span("docs.index.update", "qmd update", async () => docsUpdate());
          if (asJson) return printJson(["docs", "index", "update"], { ...result, trace: trace.snapshot() });
          printText(`indexed=${result.indexed} updated=${result.updated} unchanged=${result.unchanged} removed=${result.removed}`);
          return;
        }
        if (sub === "embed") {
          const result = await trace.span("docs.index.embed", "qmd embed", async () => docsEmbed());
          if (asJson) return printJson(["docs", "index", "embed"], { ...result, trace: trace.snapshot() });
          printText(`docs=${result.docsProcessed} chunks=${result.chunksEmbedded} errors=${result.errors}`);
          return;
        }
        if (sub === "status") {
          const result = await trace.span("docs.index.status", "qmd status", async () => docsStatus());
          if (asJson) return printJson(["docs", "index", "status"], { ...result, trace: trace.snapshot() });
          printText(`docs=${result.status.totalDocuments} collections=${result.collections.length} needsEmbedding=${result.status.needsEmbedding}`);
          return;
        }
        if (asJson) exitJsonError(["docs", "index"], "Unknown docs index subcommand");
        console.error(DOCS_HELP);
        process.exit(1);
      }

      const query = requireQuery(rest, DOCS_HELP, ["docs"], asJson);
      trace.step("docs", "dispatch", { queryChars: query.length });
      const result = await trace.span("docs.search", "qmd-sdk", async () => docsSearch(query));
      const rows = result.results.map((item) => ({
        title: item.title,
        file: item.file,
        score: item.score,
        docid: item.docid,
        snippet: summarizeBestChunk(item.bestChunk)
      }));
      const data = { ...result, count: rows.length, results: rows };
      addHistory({ kind: "docs", input: { query }, output: data });
      if (asJson) return printJson(["docs"], { ...data, trace: trace.snapshot() });
      if (rows.length === 0) {
        printText("No results.");
        return;
      }
      for (const [index, item] of rows.entries()) {
        console.log(`${index + 1}. ${item.title}`);
        console.log(`   ${item.file}`);
        console.log(`   score=${item.score.toFixed(3)}`);
        if (item.snippet) console.log(`   ${item.snippet}`);
      }
      return;
    }

    if (command === "social") {
      if (flags.has("help")) return void console.log(`search social — social retrieval\n\nUsage:\n  search social <query...>\n  search social x <query...>\n  search social x read <id-or-url>\n  search social x thread <id-or-url>\n\nExamples:\n  search social x "bun runtime"\n  search social x thread https://x.com/i/status/123456\n\nNotes:\n  - today, social routes to X/Twitter flows\n  - subdomains like reddit/hn can fit here later\n`);
      const socialSubdomain = rest[0];
      const socialRest = socialSubdomain === "x" ? rest.slice(1) : rest;
      const invokedAs = socialSubdomain === "x" ? "social x" : "social";
      if (socialRest[0] === "read" && socialRest[1]) {
        const id = socialRest[1];
        trace.step("twitter.read", "dispatch", { id, alias: invokedAs });
        const result = await trace.span("twitter.read", id, async () => twitterRead(id));
        if (asJson) return printJson(invokedAs.split(" "), { ...result, trace: trace.snapshot() });
        printText(typeof result.tweet === "string" ? result.tweet : JSON.stringify(result.tweet, null, 2));
        return;
      }
      if (socialRest[0] === "thread" && socialRest[1]) {
        const id = socialRest[1];
        trace.step("twitter.thread", "dispatch", { id, alias: invokedAs });
        const result = await trace.span("twitter.thread", id, async () => twitterThread(id));
        if (asJson) return printJson(invokedAs.split(" "), { ...result, trace: trace.snapshot() });
        for (const tweet of result.tweets) printText(typeof tweet === "string" ? tweet : JSON.stringify(tweet, null, 2));
        return;
      }
      const query = requireQuery(socialRest, TWITTER_HELP, invokedAs.split(" "), asJson);
      const count = Number(flags.get("count") ?? 10);
      trace.step("twitter.search", "dispatch", { query, count, alias: invokedAs });
      const result = await trace.span("twitter.search", "bird", async () => twitterSearch(query, count));
      addHistory({ kind: "web", input: { query, source: "twitter", alias: invokedAs }, output: result });
      if (asJson) return printJson(invokedAs.split(" "), { ...result, trace: trace.snapshot() });
      if (result.tweets.length === 0) {
        printText("No tweets found.");
        return;
      }
      for (const [index, tweet] of result.tweets.entries()) {
        console.log(`${index + 1}. @${tweet.author}${tweet.createdAt ? " " + tweet.createdAt : ""}`);
        console.log(`   ${tweet.text.split("\n")[0]}`);
        console.log(`   https://x.com/i/status/${tweet.id}`);
      }
      return;
    }

    if (command === "twitter" || command === "x.com") {
      if (flags.has("help")) return void console.log(TWITTER_HELP);
      const invokedAs = command;
      if (rest[0] === "read" && rest[1]) {
        const id = rest[1];
        trace.step("twitter.read", "dispatch", { id, alias: invokedAs });
        const result = await trace.span("twitter.read", id, async () => twitterRead(id));
        if (asJson) return printJson([invokedAs, "read"], { ...result, trace: trace.snapshot() });
        printText(typeof result.tweet === "string" ? result.tweet : JSON.stringify(result.tweet, null, 2));
        return;
      }
      if (rest[0] === "thread" && rest[1]) {
        const id = rest[1];
        trace.step("twitter.thread", "dispatch", { id, alias: invokedAs });
        const result = await trace.span("twitter.thread", id, async () => twitterThread(id));
        if (asJson) return printJson([invokedAs, "thread"], { ...result, trace: trace.snapshot() });
        for (const tweet of result.tweets) printText(typeof tweet === "string" ? tweet : JSON.stringify(tweet, null, 2));
        return;
      }
      const query = requireQuery(rest, TWITTER_HELP, [invokedAs], asJson);
      const count = Number(flags.get("count") ?? 10);
      trace.step("twitter.search", "dispatch", { query, count, alias: invokedAs });
      const result = await trace.span("twitter.search", "bird", async () => twitterSearch(query, count));
      addHistory({ kind: "web", input: { query, source: "twitter", alias: invokedAs }, output: result });
      if (asJson) return printJson([invokedAs], { ...result, trace: trace.snapshot() });
      if (result.tweets.length === 0) {
        printText("No tweets found.");
        return;
      }
      for (const [index, tweet] of result.tweets.entries()) {
        console.log(`${index + 1}. @${tweet.author}${tweet.createdAt ? " " + tweet.createdAt : ""}`);
        console.log(`   ${tweet.text.split("\n")[0]}`);
        console.log(`   https://x.com/i/status/${tweet.id}`);
      }
      return;
    }

    if (command === "fetch-content" || command === "fetch") {
      if (flags.has("help")) return void console.log(FETCH_HELP);
      const invokedAs = command;
      const url = requireQuery(rest, FETCH_HELP, [invokedAs], asJson);
      trace.step("fetch", "dispatch", { url, alias: invokedAs });
      const result = await trace.span("fetch.content", url, async () => fetchContent(url));
      addHistory({ kind: "fetch", input: { url, alias: invokedAs }, output: result });
      if (asJson) return printJson([invokedAs], { alias: invokedAs, canonicalCommand: "fetch-content", ...result, trace: trace.snapshot() });
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
      const kind = rest[0] as "web" | "code" | "fetch" | "docs" | "flights" | undefined;
      const entries = await trace.span("history", kind ?? "all", async () => listHistory(kind));
      if (asJson) return printJson(["history"], { kind: kind ?? null, count: entries.length, entries, trace: trace.snapshot() });
      for (const entry of entries) console.log(`${entry.createdAt}  ${entry.kind}  ${entry.id}`);
      return;
    }

    if (asJson) exitJsonError([command], "Unknown command");
    console.error(ROOT_HELP);
    process.exit(1);
  } finally {
    trace.flush();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (process.argv.includes("--json")) {
    console.error(JSON.stringify(fail(process.argv.slice(2, 3), message), null, 2));
  } else {
    console.error(message);
  }
  process.exit(1);
});
