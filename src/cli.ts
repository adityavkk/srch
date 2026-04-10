#!/usr/bin/env node
import { getConfigSafe, setProvider, setSecret, setSecretRef, unsetField } from "./lib/config/commands.js";
import { getConfigPath, loadConfig } from "./lib/core/config.js";
import { inspectTools } from "./lib/cli/tools.js";
import { CONFIG_HELP } from "./lib/cli/config-help.js";
import { CODE_HELP, DOCS_HELP, FETCH_HELP, FLIGHTS_HELP, HISTORY_HELP, INSPECT_HELP, INSTALL_HELP, REWARDS_FLIGHTS_HELP, ROOT_HELP, WEB_HELP } from "./lib/cli/help.js";
import { TWITTER_HELP } from "./lib/cli/twitter-help.js";
import { emitFailure, emitSuccess } from "./lib/cli/emit.js";
import type { SearchProvider } from "./lib/core/types.js";
import { summarizeBestChunk } from "./lib/docs/format.js";
import { docsAddCollection, docsEmbed, docsListCollections, docsSearch, docsStatus, docsUpdate } from "./lib/docs/qmd.js";
import { fetchContent } from "./lib/fetch/content.js";
import { formatFlightLocationsText, formatFlightSearchText, resolveFlightLocation, searchFlights, type FliFlightSearchOptions } from "./lib/flights/fli.js";
import { listHistory, addHistory } from "./lib/history/store.js";
import { buildInstallPlan, executeInstallPlan, isOptionalInstallTarget, renderInstallPlan } from "./lib/install/optional.js";
import { formatRewardsFlightSearchText, formatRewardsRoutesText, formatRewardsTripsText, getRewardFlightRoutes, getRewardFlightTrips, searchRewardFlights, type RewardsCabin, type RewardsFlightSearchOptions } from "./lib/rewards-flights/seats-aero.js";
import { codeSearch } from "./lib/search/code.js";
import { repoSearch } from "./lib/search/repo.js";
import { webSearch } from "./lib/search/web.js";
import { twitterSearch, twitterRead, twitterThread } from "./lib/upstream/bird.js";
import { createTraceSink } from "./lib/trace.js";
import { inspectSecretSources } from "./lib/core/secrets.js";

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

function exitJsonError(command: string[], message: string): never {
  emitFailure(command, message, { asJson: true });
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

function parseFlightSearchOptions(flags: Map<string, FlagValue>): FliFlightSearchOptions {
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
    sort: sort === "price" || sort === "duration" ? sort : undefined
  };
}

function parseRewardsFlightSearchOptions(originAirport: string, destinationAirport: string, flags: Map<string, FlagValue>): RewardsFlightSearchOptions {
  const date = getStringFlag(flags, "date");
  const startDate = date ?? getStringFlag(flags, "start-date");
  const endDate = date ?? getStringFlag(flags, "end-date");
  const cabins = getStringFlags(flags, "cabin").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean) as RewardsCabin[];
  const sources = getStringFlags(flags, "source").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const carriers = getStringFlags(flags, "carrier").flatMap((value) => value.split(",")).map((value) => value.trim().toUpperCase()).filter(Boolean);
  return {
    originAirport: originAirport.toUpperCase(),
    destinationAirport: destinationAirport.toUpperCase(),
    startDate,
    endDate,
    cabins: cabins.length ? cabins : undefined,
    sources: sources.length ? sources : undefined,
    carriers: carriers.length ? carriers : undefined,
    take: getNumberFlag(flags, "take"),
    skip: getNumberFlag(flags, "skip"),
    includeTrips: flags.has("include-trips"),
    includeFiltered: flags.has("include-filtered"),
    includeZeroSeats: flags.has("include-zero-seats"),
    minSeats: getNumberFlag(flags, "min-seats"),
    onlyDirectFlights: flags.has("direct"),
    orderBy: getStringFlag(flags, "order-by") === "lowest_mileage" ? "lowest_mileage" : "default"
  };
}

function rewardsFlightsAuthInstructions(): string {
  return [
    "Seats.aero API key setup",
    "",
    "1. Log in to your Seats.aero account.",
    "2. Open Settings -> API.",
    "3. Generate or copy your Pro API key (looks like `pro_xxx`).",
    "4. Save it in srch with one of:",
    "   search rewards-flights auth set pro_xxx",
    "   search config set-secret seatsAeroApiKey pro_xxx",
    "   search config set-secret-ref seatsAeroApiKey op 'op://agent-dev/Seats Aero/API Key'",
    "",
    "Then verify with:",
    "  search rewards-flights auth status",
    "",
    "Note: srch cannot fetch the key automatically because Seats.aero exposes it only inside your logged-in account settings."
  ].join("\n");
}

async function getRewardsFlightsAuthStatus() {
  const config = loadConfig();
  const sources = await inspectSecretSources(config);
  const seats = sources.seatsAeroApiKey;
  return {
    configured: seats.configured,
    source: seats.source,
    keyName: seats.keyName ?? null,
    configPath: getConfigPath(),
    instructions: rewardsFlightsAuthInstructions()
  };
}

async function main(): Promise<void> {
  const [, , command, ...argv] = process.argv;
  if (!command || command === "help" || command === "--help") {
    console.log(ROOT_HELP);
    return;
  }

  const { flags, rest } = parseFlags(argv);
  const asJson = flags.has("json");
  const outPath = getStringFlag(flags, "out");
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
        return emitSuccess({
          command: ["config"],
          kind: "config",
          data: { ...data, trace: trace.snapshot() },
          text: getConfigPath()
        }, { asJson, outPath });
      }
      if (sub === "set" && rest[1] === "provider" && rest[2]) {
        const config = await trace.span("config.set", "set provider", async () => setProvider(rest[2]!));
        return emitSuccess({
          command: ["config", "set", "provider"],
          kind: "config",
          data: { path: getConfigPath(), config, trace: trace.snapshot() },
          text: `provider=${config.provider ?? "auto"}`
        }, { asJson, outPath });
      }
      if (sub === "set-secret" && rest[1] && rest[2]) {
        const field = rest[1];
        const value = rest[2];
        const config = await trace.span("config.set-secret", field, async () => setSecret(field, value));
        return emitSuccess({
          command: ["config", "set-secret", field],
          kind: "config",
          data: { path: getConfigPath(), config, trace: trace.snapshot() },
          text: `${field}=[set]`
        }, { asJson, outPath });
      }
      if (sub === "set-secret-ref" && rest[1] && rest[2] && rest[3]) {
        const field = rest[1];
        const source = rest[2];
        const key = rest[3];
        const config = await trace.span("config.set-secret-ref", field, async () => setSecretRef(field, source, key));
        return emitSuccess({
          command: ["config", "set-secret-ref", field],
          kind: "config",
          data: { path: getConfigPath(), config, trace: trace.snapshot() },
          text: `${field}=ref:${source}:${key}`
        }, { asJson, outPath });
      }
      if (sub === "unset" && rest[1]) {
        const field = rest[1];
        const config = await trace.span("config.unset", field, async () => unsetField(field));
        return emitSuccess({
          command: ["config", "unset", field],
          kind: "config",
          data: { path: getConfigPath(), config, trace: trace.snapshot() },
          text: `${field}=unset`
        }, { asJson, outPath });
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
      return emitSuccess({
        command: ["inspect", "tools"],
        kind: "inspect",
        data: { ...result, trace: trace.snapshot() },
        text: JSON.stringify(result, null, 2)
      }, { asJson, outPath });
    }

    if (command === "install") {
      if (flags.has("help")) return void console.log(INSTALL_HELP);
      const target = rest[0];
      if (!isOptionalInstallTarget(target)) {
        if (asJson) exitJsonError(["install"], "Unknown install target. Use `flights` or `all`.");
        console.error(INSTALL_HELP);
        process.exit(1);
      }

      const globalInstall = flags.has("global");
      const dryRun = flags.has("dry-run");
      const plan = buildInstallPlan(target, globalInstall);
      trace.step("install.plan", target, { globalInstall, dryRun, steps: plan.steps.length });

      const installPlanText = renderInstallPlan(plan);
      if (dryRun && !asJson) {
        return emitSuccess({
          command: ["install", target],
          kind: "install",
          data: { dryRun: true, plan, trace: trace.snapshot() },
          text: installPlanText
        }, { asJson, outPath });
      }

      const result = await trace.span("install.execute", target, async () => executeInstallPlan(plan, { dryRun, captureOutput: asJson }));
      return emitSuccess({
        command: ["install", target],
        kind: "install",
        data: { ...result, trace: trace.snapshot() },
        text: dryRun ? installPlanText : "Optional install complete."
      }, { asJson, outPath });
    }

    if (command === "flights") {
      if (flags.has("help")) return void console.log(FLIGHTS_HELP);

      const sub = rest[0];
      const flightsSubcommands = new Set(["search", "resolve"]);
      const flightsSearchMode = !sub || !flightsSubcommands.has(sub);
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
        return emitSuccess({
          command: sub === "search" ? ["flights", "search"] : ["flights"],
          kind: "flights",
          data: { origin, destination, dateFrom, ...data, trace: trace.snapshot() },
          text: formatFlightSearchText(data.result, data.offerSummaries, data.bestOffer)
        }, { asJson, outPath });
      }

      if (sub === "resolve") {
        const query = requireQuery(rest.slice(1), FLIGHTS_HELP, ["flights", "resolve"], asJson);
        trace.step("flights.resolve", "dispatch", { queryChars: query.length });
        const data = await trace.span("flights.resolve", query, async () => resolveFlightLocation(query));
        return emitSuccess({
          command: ["flights", "resolve"],
          kind: "flights",
          data: { ...data, trace: trace.snapshot() },
          text: formatFlightLocationsText(query, data.locations)
        }, { asJson, outPath });
      }

      if (asJson) exitJsonError(["flights"], "Unknown flights command");
      console.error(FLIGHTS_HELP);
      process.exit(1);
    }

    if (command === "rewards-flights") {
      if (flags.has("help")) return void console.log(REWARDS_FLIGHTS_HELP);

      const sub = rest[0];
      const rewardsSubcommands = new Set(["search", "routes", "trips", "auth"]);
      const rewardsSearchMode = !sub || !rewardsSubcommands.has(sub);
      const searchArgs = rewardsSearchMode ? rest : sub === "search" ? rest.slice(1) : [];

      if (rewardsSearchMode || sub === "search") {
        const [originAirport, destinationAirport] = searchArgs;
        if (!originAirport || !destinationAirport) {
          if (asJson) exitJsonError(sub === "search" ? ["rewards-flights", "search"] : ["rewards-flights"], "Usage: search rewards-flights <origin> <destination>");
          console.error(REWARDS_FLIGHTS_HELP);
          process.exit(1);
        }
        const query = parseRewardsFlightSearchOptions(originAirport, destinationAirport, flags);
        trace.step("rewards-flights.search", "dispatch", { originAirport: query.originAirport, destinationAirport: query.destinationAirport, cabins: query.cabins?.join(",") ?? null, sources: query.sources?.join(",") ?? null });
        const data = await trace.span("rewards-flights.search", `${query.originAirport}-${query.destinationAirport}`, async () => searchRewardFlights(query));
        addHistory({ kind: "rewards-flights", input: query, output: data });
        return emitSuccess({
          command: sub === "search" ? ["rewards-flights", "search"] : ["rewards-flights"],
          kind: "rewards-flights",
          data: { ...data, trace: trace.snapshot() },
          text: formatRewardsFlightSearchText(data)
        }, { asJson, outPath });
      }

      if (sub === "routes") {
        const source = rest[1];
        if (!source) {
          if (asJson) exitJsonError(["rewards-flights", "routes"], "Usage: search rewards-flights routes <source>");
          console.error(REWARDS_FLIGHTS_HELP);
          process.exit(1);
        }
        trace.step("rewards-flights.routes", "dispatch", { source });
        const data = await trace.span("rewards-flights.routes", source, async () => getRewardFlightRoutes(source));
        addHistory({ kind: "rewards-flights", input: { source, mode: "routes" }, output: data });
        return emitSuccess({
          command: ["rewards-flights", "routes"],
          kind: "rewards-flights",
          data: { ...data, trace: trace.snapshot() },
          text: formatRewardsRoutesText(data)
        }, { asJson, outPath });
      }

      if (sub === "auth") {
        const authSub = rest[1] ?? "status";

        if (authSub === "status") {
          const data = await trace.span("rewards-flights.auth.status", "status", async () => getRewardsFlightsAuthStatus());
          return emitSuccess({
            command: ["rewards-flights", "auth", "status"],
            kind: "rewards-flights",
            data: { ...data, trace: trace.snapshot() },
            text: [
              `Configured: ${data.configured ? "yes" : "no"}`,
              `Source: ${data.source}`,
              data.keyName ? `Key reference: ${data.keyName}` : null,
              `Config path: ${data.configPath}`,
              "",
              data.instructions
            ].filter(Boolean).join("\n")
          }, { asJson, outPath });
        }

        if (authSub === "instructions") {
          const text = rewardsFlightsAuthInstructions();
          return emitSuccess({
            command: ["rewards-flights", "auth", "instructions"],
            kind: "rewards-flights",
            data: { instructions: text, trace: trace.snapshot() },
            text
          }, { asJson, outPath });
        }

        if (authSub === "set") {
          const key = rest[2] ?? getStringFlag(flags, "key");
          if (!key) {
            if (asJson) exitJsonError(["rewards-flights", "auth", "set"], "Usage: search rewards-flights auth set <pro_key>");
            console.error(REWARDS_FLIGHTS_HELP);
            process.exit(1);
          }
          const config = await trace.span("rewards-flights.auth.set", "set key", async () => setSecret("seatsAeroApiKey", key));
          return emitSuccess({
            command: ["rewards-flights", "auth", "set"],
            kind: "rewards-flights",
            data: { path: getConfigPath(), config, trace: trace.snapshot() },
            text: `seatsAeroApiKey saved to ${getConfigPath()}`
          }, { asJson, outPath });
        }

        if (authSub === "clear") {
          const config = await trace.span("rewards-flights.auth.clear", "clear key", async () => unsetField("seatsAeroApiKey"));
          return emitSuccess({
            command: ["rewards-flights", "auth", "clear"],
            kind: "rewards-flights",
            data: { path: getConfigPath(), config, trace: trace.snapshot() },
            text: `seatsAeroApiKey removed from ${getConfigPath()}`
          }, { asJson, outPath });
        }

        if (asJson) exitJsonError(["rewards-flights", "auth"], "Unknown rewards-flights auth command");
        console.error(REWARDS_FLIGHTS_HELP);
        process.exit(1);
      }

      if (sub === "trips") {
        const availabilityId = rest[1];
        if (!availabilityId) {
          if (asJson) exitJsonError(["rewards-flights", "trips"], "Usage: search rewards-flights trips <availability_id>");
          console.error(REWARDS_FLIGHTS_HELP);
          process.exit(1);
        }
        const includeFiltered = flags.has("include-filtered");
        trace.step("rewards-flights.trips", "dispatch", { availabilityId, includeFiltered });
        const data = await trace.span("rewards-flights.trips", availabilityId, async () => getRewardFlightTrips(availabilityId, includeFiltered));
        addHistory({ kind: "rewards-flights", input: { availabilityId, includeFiltered, mode: "trips" }, output: data });
        return emitSuccess({
          command: ["rewards-flights", "trips"],
          kind: "rewards-flights",
          data: { ...data, trace: trace.snapshot() },
          text: formatRewardsTripsText(data)
        }, { asJson, outPath });
      }

      if (asJson) exitJsonError(["rewards-flights"], "Unknown rewards-flights command");
      console.error(REWARDS_FLIGHTS_HELP);
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
      const webTextLines = [result.answer || "No summary."];
      if (result.results.length > 0) {
        webTextLines.push("", "Sources:");
        for (const [index, item] of result.results.entries()) webTextLines.push(`${index + 1}. ${item.title}\n   ${item.url}`);
      }
      return emitSuccess({
        command: ["web"],
        kind: "web",
        data: { query, requestedProvider: provider, ...result, trace: trace.snapshot() },
        text: webTextLines.join("\n")
      }, { asJson, outPath });
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
        const repoTextLines = result.matches.length === 0
          ? [`No matches in ${result.localPath}`]
          : [
              `${result.matchCount} matches in ${result.localPath}${result.cached ? " (cached)" : ""}${result.truncated ? " (truncated)" : ""}`,
              ...result.matches.map((m) => `  ${m.file}:${m.line}  ${m.text}`)
            ];
        return emitSuccess({
          command: ["code", "repo"],
          kind: "code",
          data: { ...result, trace: trace.snapshot() },
          text: repoTextLines.join("\n")
        }, { asJson, outPath });
      }

      const query = requireQuery(rest, CODE_HELP, ["code"], asJson);
      const maxTokens = Number(flags.get("max-tokens") ?? 5000);
      trace.step("code", "dispatch", { maxTokens, queryChars: query.length });
      const result = await trace.span("code.search", "exa-mcp", async () => codeSearch(query, maxTokens));
      addHistory({ kind: "code", input: { query, maxTokens }, output: result });
      const codeTextLines = [result.text];
      if (result.secondary?.length) {
        for (const src of result.secondary) codeTextLines.push(`\n[secondary: ${src.label}]`);
      }
      return emitSuccess({
        command: ["code"],
        kind: "code",
        data: { ...result, trace: trace.snapshot() },
        text: codeTextLines.join("\n")
      }, { asJson, outPath });
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
          return emitSuccess({
            command: ["docs", "index", "add"],
            kind: "docs",
            data: { path, name, pattern, collections: result, trace: trace.snapshot() },
            text: `${result.length} collections`
          }, { asJson, outPath });
        }
        if (sub === "list") {
          const result = await trace.span("docs.index.list", "qmd collections", async () => docsListCollections());
          return emitSuccess({
            command: ["docs", "index", "list"],
            kind: "docs",
            data: { collections: result, count: result.length, trace: trace.snapshot() },
            text: result.map((item) => `${item.name}\t${item.pwd}\t${item.doc_count}`).join("\n")
          }, { asJson, outPath });
        }
        if (sub === "update") {
          const result = await trace.span("docs.index.update", "qmd update", async () => docsUpdate());
          return emitSuccess({
            command: ["docs", "index", "update"],
            kind: "docs",
            data: { ...result, trace: trace.snapshot() },
            text: `indexed=${result.indexed} updated=${result.updated} unchanged=${result.unchanged} removed=${result.removed}`
          }, { asJson, outPath });
        }
        if (sub === "embed") {
          const result = await trace.span("docs.index.embed", "qmd embed", async () => docsEmbed());
          return emitSuccess({
            command: ["docs", "index", "embed"],
            kind: "docs",
            data: { ...result, trace: trace.snapshot() },
            text: `docs=${result.docsProcessed} chunks=${result.chunksEmbedded} errors=${result.errors}`
          }, { asJson, outPath });
        }
        if (sub === "status") {
          const result = await trace.span("docs.index.status", "qmd status", async () => docsStatus());
          return emitSuccess({
            command: ["docs", "index", "status"],
            kind: "docs",
            data: { ...result, trace: trace.snapshot() },
            text: `docs=${result.status.totalDocuments} collections=${result.collections.length} needsEmbedding=${result.status.needsEmbedding}`
          }, { asJson, outPath });
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
      const docsTextLines = rows.length === 0
        ? ["No results."]
        : rows.flatMap((item, index) => [
            `${index + 1}. ${item.title}`,
            `   ${item.file}`,
            `   score=${item.score.toFixed(3)}`,
            ...(item.snippet ? [`   ${item.snippet}`] : [])
          ]);
      return emitSuccess({
        command: ["docs"],
        kind: "docs",
        data: { ...data, trace: trace.snapshot() },
        text: docsTextLines.join("\n")
      }, { asJson, outPath });
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
        return emitSuccess({
          command: invokedAs.split(" "),
          kind: "social",
          data: { ...result, trace: trace.snapshot() },
          text: typeof result.tweet === "string" ? result.tweet : JSON.stringify(result.tweet, null, 2)
        }, { asJson, outPath });
      }
      if (socialRest[0] === "thread" && socialRest[1]) {
        const id = socialRest[1];
        trace.step("twitter.thread", "dispatch", { id, alias: invokedAs });
        const result = await trace.span("twitter.thread", id, async () => twitterThread(id));
        return emitSuccess({
          command: invokedAs.split(" "),
          kind: "social",
          data: { ...result, trace: trace.snapshot() },
          text: result.tweets.map((tweet) => typeof tweet === "string" ? tweet : JSON.stringify(tweet, null, 2)).join("\n")
        }, { asJson, outPath });
      }
      const query = requireQuery(socialRest, TWITTER_HELP, invokedAs.split(" "), asJson);
      const count = Number(flags.get("count") ?? 10);
      trace.step("twitter.search", "dispatch", { query, count, alias: invokedAs });
      const result = await trace.span("twitter.search", "bird", async () => twitterSearch(query, count));
      addHistory({ kind: "web", input: { query, source: "twitter", alias: invokedAs }, output: result });
      const socialSearchText = result.tweets.length === 0
        ? "No tweets found."
        : result.tweets.map((tweet, index) => `${index + 1}. @${tweet.author}${tweet.createdAt ? " " + tweet.createdAt : ""}\n   ${tweet.text.split("\n")[0]}\n   https://x.com/i/status/${tweet.id}`).join("\n");
      return emitSuccess({
        command: invokedAs.split(" "),
        kind: "social",
        data: { ...result, trace: trace.snapshot() },
        text: socialSearchText
      }, { asJson, outPath });
    }

    if (command === "twitter" || command === "x.com") {
      if (flags.has("help")) return void console.log(TWITTER_HELP);
      const invokedAs = command;
      if (rest[0] === "read" && rest[1]) {
        const id = rest[1];
        trace.step("twitter.read", "dispatch", { id, alias: invokedAs });
        const result = await trace.span("twitter.read", id, async () => twitterRead(id));
        return emitSuccess({
          command: [invokedAs, "read"],
          kind: "social",
          data: { ...result, trace: trace.snapshot() },
          text: typeof result.tweet === "string" ? result.tweet : JSON.stringify(result.tweet, null, 2)
        }, { asJson, outPath });
      }
      if (rest[0] === "thread" && rest[1]) {
        const id = rest[1];
        trace.step("twitter.thread", "dispatch", { id, alias: invokedAs });
        const result = await trace.span("twitter.thread", id, async () => twitterThread(id));
        return emitSuccess({
          command: [invokedAs, "thread"],
          kind: "social",
          data: { ...result, trace: trace.snapshot() },
          text: result.tweets.map((tweet) => typeof tweet === "string" ? tweet : JSON.stringify(tweet, null, 2)).join("\n")
        }, { asJson, outPath });
      }
      const query = requireQuery(rest, TWITTER_HELP, [invokedAs], asJson);
      const count = Number(flags.get("count") ?? 10);
      trace.step("twitter.search", "dispatch", { query, count, alias: invokedAs });
      const result = await trace.span("twitter.search", "bird", async () => twitterSearch(query, count));
      addHistory({ kind: "web", input: { query, source: "twitter", alias: invokedAs }, output: result });
      const twitterSearchText = result.tweets.length === 0
        ? "No tweets found."
        : result.tweets.map((tweet, index) => `${index + 1}. @${tweet.author}${tweet.createdAt ? " " + tweet.createdAt : ""}\n   ${tweet.text.split("\n")[0]}\n   https://x.com/i/status/${tweet.id}`).join("\n");
      return emitSuccess({
        command: [invokedAs],
        kind: "social",
        data: { ...result, trace: trace.snapshot() },
        text: twitterSearchText
      }, { asJson, outPath });
    }

    if (command === "fetch-content" || command === "fetch") {
      if (flags.has("help")) return void console.log(FETCH_HELP);
      const invokedAs = command;
      const url = requireQuery(rest, FETCH_HELP, [invokedAs], asJson);
      trace.step("fetch", "dispatch", { url, alias: invokedAs });
      const result = await trace.span("fetch.content", url, async () => fetchContent(url));
      addHistory({ kind: "fetch", input: { url, alias: invokedAs }, output: result });
      const fetchText = result.error
        ? [`Error: ${result.error}`, ...(result.content ? ["", result.content] : [])].join("\n")
        : `# ${result.title}\n\n${result.content}`;
      return emitSuccess({
        command: [invokedAs],
        kind: "fetch",
        data: { alias: invokedAs, canonicalCommand: "fetch-content", ...result, trace: trace.snapshot() },
        text: fetchText
      }, { asJson, outPath });
    }

    if (command === "history") {
      if (flags.has("help")) return void console.log(HISTORY_HELP);
      const kind = rest[0] as "web" | "code" | "fetch" | "docs" | "flights" | "rewards-flights" | undefined;
      const entries = await trace.span("history", kind ?? "all", async () => listHistory(kind));
      return emitSuccess({
        command: ["history"],
        kind: "history",
        data: { kind: kind ?? null, count: entries.length, entries, trace: trace.snapshot() },
        text: entries.map((entry) => `${entry.createdAt}  ${entry.kind}  ${entry.id}`).join("\n")
      }, { asJson, outPath });
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
    emitFailure(process.argv.slice(2, 3), message, { asJson: true });
  } else {
    emitFailure(process.argv.slice(2, 3), message, { asJson: false });
  }
});
