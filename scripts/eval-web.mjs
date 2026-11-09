#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const help = `Usage: node scripts/eval-web.mjs [--cases path] [--out path] [--costs path]
       node scripts/eval-web.mjs --live [--provider exa|brave|gemini|perplexity|auto] [--hq] [--timeout-ms 10000] [--out path]

Default: deterministic synthetic replay, without network or credentials.
--live queries providers. Default Exa MCP uses no API key; --hq and other providers may consume credits.
--costs accepts a JSON object of case IDs to total request costs in USD. Unknown costs remain null.
Run npm run build before using this script. Source matching is a proxy, not a human relevance judgment.`;

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (["--live", "--hq", "--help"].includes(flag)) options[flag] = true;
    else if (["--cases", "--out", "--costs", "--provider", "--timeout-ms"].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      options[flag] = value;
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  if (options["--help"]) return console.log(help);
  if (!options["--live"] && ["--provider", "--hq", "--timeout-ms"].some((flag) => flag in options)) {
    throw new Error("Provider and timeout options require --live");
  }
  const provider = options["--provider"] ?? "exa";
  if (!["auto", "exa", "brave", "gemini", "perplexity"].includes(provider)) throw new Error("Invalid provider");
  const timeoutMs = Number(options["--timeout-ms"] ?? 10000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error("timeout-ms must be an integer from 1 to 60000");
  const { scoreWebEvaluation } = await import("../dist/lib/eval/web.js").catch(() => {
    throw new Error("Evaluation build is unavailable. Run npm run build first.");
  });
  const dataset = JSON.parse(await readFile(options["--cases"] ?? new URL("../eval/web-cases.json", import.meta.url), "utf8"));
  if (dataset.schemaVersion !== 1) throw new Error("Unsupported evaluation dataset version");
  // Validate the cases and replay before any live request or credential lookup.
  scoreWebEvaluation(dataset.cases, dataset.replay);
  const costs = options["--costs"] ? JSON.parse(await readFile(options["--costs"], "utf8")) : {};
  if (!costs || Array.isArray(costs) || typeof costs !== "object"
    || Object.entries(costs).some(([id, cost]) => !dataset.cases.some((item) => item.id === id) || !Number.isFinite(cost) || cost < 0)) {
    throw new Error("Costs must map known case IDs to nonnegative USD amounts");
  }
  let runs = dataset.replay;
  if (options["--live"]) {
    const { createClient } = await import("../dist/sdk.js");
    const client = createClient();
    runs = [];
    for (const item of dataset.cases) {
      const start = performance.now();
      try {
        const result = await client.run({ domain: "web", query: item.query, provider, hq: !!options["--hq"], numResults: 5, domainFilter: item.domainFilter, timeoutMs });
        runs.push({
          caseId: item.id, status: result.kind, durationMs: Math.round(performance.now() - start),
          results: result.kind === "success" ? result.evidence.map(({ payload }) => ({ url: payload.url, snippet: payload.snippet })) : [],
          attempts: result.summary?.attempts.map(({ provider, transport, status }) => ({ provider, transport, status })) ?? [],
          ...(result.kind === "error" ? { errorCode: result.error.code } : {})
        });
      } catch {
        runs.push({ caseId: item.id, status: "error", errorCode: "request_failed", durationMs: Math.round(performance.now() - start), results: [] });
      }
    }
  }
  runs = runs.map((run) => ({ ...run, costUsd: costs[run.caseId] ?? run.costUsd ?? null }));
  const report = {
    schemaVersion: 1,
    datasetDescription: dataset.description ?? null,
    mode: options["--live"] ? "live" : "synthetic-replay",
    ...(options["--live"] ? { generatedAt: new Date().toISOString(), provider, hq: !!options["--hq"] } : {}),
    note: options["--live"] ? "Small expected-source evaluation; inspect per-query evidence before judging quality." : "Synthetic responses test evaluation behavior. These scores do not measure live provider quality or speed.",
    ...scoreWebEvaluation(dataset.cases, runs)
  };
  const output = JSON.stringify(report, null, 2) + "\n";
  if (options["--out"]) {
    const path = resolve(options["--out"]);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, output);
  }
  process.stdout.write(output);
  if (options["--live"] && report.summary.error > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Evaluation failed"); process.exitCode = 1; });
