# srch

Typed retrieval workflows for agents, without tool sprawl.

The CLI binary is `search`. The SDK is `srch`.

<p align="center">
  <img src="demo.gif" alt="srch demo" width="800">
</p>

---

## Why srch

Most agent tools treat search as a grab bag: one tool per provider, no shared types, no fallback logic, no structure. The agent has to pick the right tool, parse ad hoc output, and handle failures itself.

`srch` flips this. Search is a **typed domain** with a stable vocabulary. The agent says _what_ it wants (web results, code context, a page, flight fares) and the SDK handles _how_ (source selection, fallback chains, retries, evidence aggregation).

One interface. Many backends. Typed results. No tool sprawl.

```ts
import { createClient, type RunResult, type WebEvidencePayload } from "srch";

const client = createClient();

// result: RunResult<WebEvidencePayload>  -- inferred from { domain: "web" }
const result = await client.run({ domain: "web", query: "bun sqlite" });

if (result.kind === "success") {
  // result:   RunSuccess<WebEvidencePayload>
  // evidence: NonEmptyArray<Evidence<WebEvidencePayload>>
  // payload:  WebEvidencePayload  -- no cast needed
  const hit = result.evidence[0].payload;
  hit.title;   // string
  hit.url;     // string
  hit.snippet; // string
  hit.content; // { kind: "inline"; text: string } | { kind: "none" }
}

if (result.kind === "empty") {
  // result:      RunEmpty
  // suggestions: NonEmptyArray<string>  -- always present
  console.log(result.suggestions);
}
```

---

## Quick start

### As a TypeScript SDK

Install the SDK in the project before importing it:

```bash
bun add srch@file:/Users/auk000v/dev/search-tool
```

Then use the SDK from Bun/TypeScript:

```bash
bun - <<'TS'
import { createClient } from "srch";
const c = createClient();
const r = await c.run({ domain: "web", query: "bun sqlite", numResults: 3 });
console.log(JSON.stringify(r, null, 2));
TS
```

Bun runs TypeScript directly. No `bunx`, `tsx`, flags, or bash parsing.

> Note: avoid `npm install srch` until the package name is published/verified. The public npm package name may resolve to an unrelated package.

### User journey 1: conference travel brief

A manager asks:

> Can I send someone from SFO to AWS re:Invent 2026? Verify the official dates, find a reasonable flight, and give me a go/no-go recommendation.

This is awkward with CLI or MCP tool sprawl because each step returns a separate blob and the agent has to copy state between calls.

| CLI / MCP shape | SDK shape |
|---|---|
| `search web ... --json` -> parse URL -> `search fetch ...` -> `search flights ...` -> separate ranking script | one typed program: discover -> fetch -> price -> score -> recommend |
| provider schemas leak into prompts | payload types stay in TypeScript |
| errors are string handling | `RunResult` forces success/empty/error handling |

Install the optional flight backend once:

```bash
search install flights
```

Then run the journey:

```bash
bun - <<'TS'
import { createClient, coreModule, defineConfig, flightsModule, type RunResult } from "srch";

const c = createClient({ config: defineConfig({ modules: [coreModule, flightsModule] }) });

const trip = {
  event: "AWS re:Invent 2026",
  origin: "SFO",
  destination: "LAS",
  depart: "2026-11-29",
  return: "2026-12-04"
};

function evidence<T>(result: RunResult<T>, label: string) {
  if (result.kind === "success") return result.evidence;
  const detail = result.kind === "error" ? result.error.message : result.suggestions[0];
  throw new Error(`${label}: ${detail}`);
}

function bestOfficial<T extends { url: string }>(items: Array<{ payload: T }>, pattern: RegExp) {
  return items.find(e => pattern.test(e.payload.url)) ?? items[0];
}

function fareScore(e: { payload: { offer: { price: number; outbound: { stopovers: number }; booking_url: string }; summary: string } }) {
  return {
    price: e.payload.offer.price,
    summary: e.payload.summary,
    bookingUrl: e.payload.offer.booking_url,
    score: e.payload.offer.price + e.payload.offer.outbound.stopovers * 150
  };
}

const eventHits = evidence(await c.run({
  domain: "web",
  query: `${trip.event} official dates venue airport`,
  numResults: 5
}), "event search");

const official = bestOfficial(eventHits, /aws|amazon|reinvent/i);

const [eventPage, flightSearch] = await Promise.all([
  c.run({ domain: "fetch", query: official.payload.url }),
  c.run({
    domain: "flights",
    query: `${trip.origin} ${trip.destination} ${trip.depart}`,
    options: { returnDate: trip.return, adults: 1, cabinClass: "M", maxStopovers: 1, sort: "price", limit: 5 }
  })
]);

const page = evidence(eventPage, "event page")[0].payload;
const fares = evidence(flightSearch, "flight search").map(fareScore).sort((a, b) => a.score - b.score);
const best = fares[0];

console.log(JSON.stringify({
  ask: `Can I attend ${trip.event} from ${trip.origin}?`,
  verifiedEvent: { title: page.title, source: page.url, excerpt: page.content.slice(0, 220) },
  flightShortlist: fares.slice(0, 3),
  recommendation: `Go: official event found, route priced, best option is ${best.summary}.`
}, null, 2));
TS
```

Result, trimmed:

```json
{
  "ask": "Can I attend AWS re:Invent 2026 from SFO?",
  "verifiedEvent": {
    "title": "AWS re:Invent 2026  | Nov 30-Dec 4, 2026",
    "source": "https://aws.amazon.com/reinvent/",
    "excerpt": "Save the date\n\nNovember 30 - December 4, 2026 | Las Vegas, NV..."
  },
  "flightShortlist": [
    { "price": 499, "summary": "USD 499.00 | AI | SFO -> LAS | economy | 9h00m | 0 stop(s)", "score": 499 },
    { "price": 650, "summary": "USD 650.00 | UA | SFO -> LAS | economy | 10h30m | 0 stop(s)", "score": 650 }
  ],
  "recommendation": "Go: official event found, route priced, best option is USD 499.00 | AI | SFO -> LAS | economy | 9h00m | 0 stop(s)."
}
```

### User journey 2: CVE triage brief

An engineering lead asks:

> A CVE dropped for lodash. Are we affected, where is it used, and should we patch today?

This is where SDK composition beats a tool list: the advisory text determines what the repo scan should look for, and the repo findings determine the decision.

| CLI / MCP shape | SDK shape |
|---|---|
| web tool -> fetch tool -> grep tool -> hand-merge evidence in prompt | advisory -> derived searches -> local scan -> decision object |
| easy to lose provenance | advisory URL and file hits stay attached |
| hard to branch | normal `if` statements decide patch/no-op/escalate |

```bash
bun - <<'TS'
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type RunResult } from "srch";

const c = createClient();
const dep = { name: "lodash", current: "4.17.20", root: "." };

function evidence<T>(result: RunResult<T>, label: string) {
  if (result.kind === "success") return result.evidence;
  const detail = result.kind === "error" ? result.error.message : result.suggestions[0];
  throw new Error(`${label}: ${detail}`);
}

async function projectFiles(dir: string): Promise<Array<{ path: string; text: string }>> {
  const ignored = new Set([".git", "node_modules", "dist", ".tmp"]);
  const out: Array<{ path: string; text: string }> = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !ignored.has(entry.name)) out.push(...await projectFiles(path));
    if (entry.isFile() && /(?:package.*\.json|lock|\.[cm]?[jt]sx?)$/.test(entry.name)) {
      const text = await readFile(path, "utf8").catch(() => "");
      if (text.includes(dep.name)) out.push({ path, text });
    }
  }
  return out;
}

function summarizeUsage(files: Array<{ path: string; text: string }>) {
  return files.map(f => ({
    file: f.path,
    currentVersionFound: f.text.includes(dep.current),
    importCount: (f.text.match(new RegExp(dep.name, "g")) ?? []).length
  }));
}

const advisoryHits = evidence(await c.run({
  domain: "web",
  query: `${dep.name} CVE advisory affected versions fixed version`,
  numResults: 5
}), "advisory search");

const advisoryUrl = advisoryHits.find(e => /github\.com\/advisories|nvd\.nist|snyk|osv/i.test(e.payload.url))?.payload.url
  ?? advisoryHits[0].payload.url;

const [advisory, files] = await Promise.all([
  c.run({ domain: "fetch", query: advisoryUrl }),
  projectFiles(dep.root)
]);

const page = evidence(advisory, "advisory page")[0].payload;
const usage = summarizeUsage(files);
const affected = usage.some(u => u.currentVersionFound) || page.content.includes(dep.current);

console.log(JSON.stringify({
  package: dep.name,
  installedVersion: dep.current,
  advisory: { title: page.title, url: page.url },
  repoEvidence: usage.slice(0, 10),
  decision: affected ? "patch today" : "no affected version found",
  nextSteps: affected ? ["bump dependency", "regenerate lockfile", "run tests", "ship patch"] : ["record advisory as not affected"]
}, null, 2));
TS
```

Result shape:

```json
{
  "package": "lodash",
  "installedVersion": "4.17.20",
  "advisory": { "title": "Security advisory", "url": "https://github.com/advisories/..." },
  "repoEvidence": [
    { "file": "package-lock.json", "currentVersionFound": true, "importCount": 3 },
    { "file": "src/reporting.ts", "currentVersionFound": false, "importCount": 1 }
  ],
  "decision": "patch today",
  "nextSteps": ["bump dependency", "regenerate lockfile", "run tests", "ship patch"]
}
```

Longer scripts can live in `.tmp/search.ts` and run with `bun .tmp/search.ts`.

```ts
import { createClient } from "srch";

const client = createClient();

// web: RunResult<WebEvidencePayload>
const web = await client.run({ domain: "web", query: "react server components" });
if (web.kind === "success") {
  const hit = web.evidence[0].payload;
  hit.title;   // string
  hit.url;     // string
  hit.snippet; // string
  hit.content; // { kind: "inline"; text: string } | { kind: "none" }
}

// code: RunResult<CodeTextEvidencePayload>
const code = await client.run({ domain: "code", query: "drizzle orm migrations" });
if (code.kind === "success") {
  const hit = code.evidence[0].payload;
  hit.kind;  // "text"
  hit.title; // string
  hit.text;  // string -- full extracted text
}

// fetch: RunResult<FetchEvidencePayload>
const page = await client.run({ domain: "fetch", query: "https://bun.sh/docs/runtime/sqlite" });
if (page.kind === "success") {
  const hit = page.evidence[0].payload;
  hit.kind;    // "document"
  hit.url;     // string
  hit.title;   // string
  hit.content; // string -- extracted readable text
}

// social: RunResult<BirdEvidencePayload>
const social = await client.run({ domain: "social", query: "bun 1.2 release" });
if (social.kind === "success") {
  const hit = social.evidence[0].payload;
  hit.kind;   // "tweet"
  hit.author; // string
  hit.text;   // string
  hit.url;    // string
}
```

Every `client.run()` call returns a `RunResult<T>` typed to the domain. No casts. No `as`. The payload type flows from the domain string.

### As a CLI

```bash
git clone https://github.com/adityavkk/srch.git && cd srch
npm install && npm run build
ln -s $(pwd)/dist/cli.js ~/bin/search
```

```bash
search web "react server components"
search code "drizzle orm migrations"
search fetch https://bun.sh/docs/runtime/sqlite
search social "bun 1.2 release"
search flights JFK HNL 2026-04-20 --cabin C --sort price --json
```

The `search` CLI is a thin frontend over the `srch` SDK. Same domains, same strategies, same output.

---

## Domains

Retrieval is organized into **domains**: stable, typed retrieval spaces. Each domain has sources, a default strategy, and domain-specific evidence payloads.

| Domain | What it does | Backends |
|--------|-------------|----------|
| `web` | General web search | Exa, Brave, Perplexity, Gemini |
| `code` | Code/library/API context | Exa Context, Context7, DeepWiki |
| `docs` | Local indexed docs | QMD (BM25 + vector + reranking) |
| `fetch` | Readable page extraction | Readability, Jina, Gemini URL |
| `social` | Social/Twitter search | Bird (cookie auth) |
| `flights` | Flight fares (optional) | Fli (Google Flights) |
| `rewards-flights` | Award availability (optional) | Seats.aero |

### Web

Automatic fallback chain, free-first.

```ts
// result: RunResult<WebEvidencePayload>
const result = await client.run({ domain: "web", query: "bun sqlite wasm" });

if (result.kind === "success") {
  // result:   RunSuccess<WebEvidencePayload>
  // evidence: NonEmptyArray<Evidence<WebEvidencePayload>>
  for (const e of result.evidence) {
    e.payload.kind;    // "search-result"  (literal type)
    e.payload.title;   // string
    e.payload.url;     // string
    e.payload.snippet; // string
    e.payload.content; // { kind: "inline"; text: string } | { kind: "none" }
    e.source;          // string  -- which backend produced this
    e.provenance;      // Provenance  -- web | api | local | clone
  }
}

// pin a provider
await client.run({ domain: "web", query: "bun sqlite", provider: "brave" });
```

```bash
search web "bun sqlite wasm"
search web "react compiler" --provider brave --json
```

### Code

Library docs, public repos, local codebases.

```ts
// result: RunResult<CodeTextEvidencePayload>
const result = await client.run({ domain: "code", query: "react suspense cache" });

if (result.kind === "success") {
  const hit = result.evidence[0].payload;
  hit.kind;  // "text"  (literal type)
  hit.title; // string
  hit.text;  // string -- full extracted text
  hit.native; // unknown -- raw provider response
}
```

```bash
search code "react suspense cache"
search code repo facebook/react "useEffect cleanup"    # deep repo search
search code repo . "auth middleware"                    # local codebase
```

### Fetch

Turn any URL into clean, readable content.

```ts
// result: RunResult<FetchEvidencePayload>
const result = await client.run({ domain: "fetch", query: "https://clig.dev" });

if (result.kind === "success") {
  const hit = result.evidence[0].payload;
  hit.kind;    // "document"  (literal type)
  hit.url;     // string
  hit.title;   // string
  hit.content; // string -- extracted readable text
}
```

```bash
search fetch https://clig.dev
search fetch https://github.com/tobi/qmd --json
search fetch https://arxiv.org/pdf/1706.03762.pdf
```

### Flights (optional)

Powered by the Python `fli` SDK. Evidence payload: `FliEvidencePayload`.

```bash
search install flights
```

```ts
import { createClient, defineConfig, flightsModule } from "srch";

const client = createClient({ config: defineConfig({ modules: [flightsModule] }) });

// result: RunResult<FliEvidencePayload>
const result = await client.run({
  domain: "flights",
  query: "JFK HNL 2026-04-20",
  options: { adults: 4, cabinClass: "C", maxStopovers: 0, sort: "price" }
});

if (result.kind === "success") {
  // result:   RunSuccess<FliEvidencePayload>
  // evidence: NonEmptyArray<Evidence<FliEvidencePayload>>
  for (const e of result.evidence) {
    e.payload.kind;                   // "flight-offer"  (literal type)
    e.payload.offer.price;            // number
    e.payload.offer.currency;         // string
    e.payload.offer.outbound.segments; // FlightSegment[]
    e.payload.summary;                // string -- human-readable one-liner
  }
}
```

```bash
search flights JFK HNL 2026-04-20 --cabin C --adults 4 --sort price --json
```

---

## How it works

Domains expose types and functions. You write code over those types and functions. The SDK makes the types flow.

```
client.run({ domain: "web", query })
       |                        |
       v                        v
  domain: "web"           RunResult<WebEvidencePayload>
       |                        |
       v                        v
  strategy selects          evidence[0].payload.title  -- string
  sources, runs them        evidence[0].payload.url    -- string
       |                   evidence[0].payload.snippet -- string
       v
  Evidence<WebEvidencePayload>[]
```

The domain string is a type-level discriminant. When you write `{ domain: "web" }`, TypeScript infers the request shape, the evidence payload type, and the result type. No imports of payload types needed. No casts.

This is the core design: **domains are typed retrieval interfaces, not string labels**.

| You write | TypeScript infers |
|-----------|------------------|
| `{ domain: "web" }` | `RunResult<WebEvidencePayload>` |
| `{ domain: "code" }` | `RunResult<CodeTextEvidencePayload>` |
| `{ domain: "docs" }` | `RunResult<DocsEvidencePayload>` |
| `{ domain: "fetch" }` | `RunResult<FetchEvidencePayload>` |
| `{ domain: "social" }` | `RunResult<BirdEvidencePayload>` |
| `{ domain: "flights" }` | `RunResult<FliEvidencePayload>` |
| `{ domain: "rewards-flights" }` | `RunResult<SeatsAeroEvidencePayload>` |

**Sources** are retrieval adapters. Each source does one thing: call a provider and return typed evidence.

**Strategies** are retrieval programs over sources. The default web strategy is a fallback chain. You can write your own.

**Domains** bind sources and strategies into a stable retrieval space with typed evidence payloads.

**Evidence** is a grounded result pointer. Every piece of evidence carries a source name, provenance, and a domain-specific typed payload. No hallucinated citations.

Evidence payloads per domain:

| Domain | Payload type | Key fields |
|--------|-------------|------------|
| `web` | `WebEvidencePayload` | `title`, `url`, `snippet`, `content` |
| `code` | `CodeTextEvidencePayload` | `title`, `text`, `native` |
| `docs` | `DocsEvidencePayload` | `title`, `content`, `collection` |
| `fetch` | `FetchEvidencePayload` | `url`, `title`, `content` |
| `social` | `BirdEvidencePayload` | `text`, `author`, `metrics` |
| `flights` | `FliEvidencePayload` | `offer.price`, `offer.outbound`, `summary` |
| `rewards-flights` | `SeatsAeroEvidencePayload` | `route`, `source`, `availability` |

**RunResult** is a discriminated union. Your code always knows if retrieval succeeded, returned empty, or failed:

```ts
type RunResult<T> = RunSuccess<T> | RunEmpty | RunError;

// RunSuccess.evidence is NonEmptyArray<Evidence<T>> -- always at least one
// RunEmpty.suggestions is NonEmptyArray<string> -- always actionable
// RunError.suggestions is NonEmptyArray<string> -- always actionable
```

No silent failures. No `if (result.data && result.data.length > 0)` guards.

---

## Extend it

### Custom source

```ts
import { defineSource } from "srch";

const mySource = defineSource({
  name: "my-api",
  domain: "web",
  capabilities: ["search"],
  transports: ["api"],
  async search(req) {
    const res = await fetch(`https://my-api.com/search?q=${req.query}`);
    const data = await res.json();
    return data.results.map(r => ({
      source: "my-api",
      provenance: { kind: "api", url: r.url },
      summary: r.snippet,
      payload: r
    }));
  }
});
```

### Custom strategy

```ts
import { defineStrategy } from "srch";

const myStrategy = defineStrategy({
  name: "web/parallel",
  domain: "web",
  async execute(req, ctx) {
    const [exa, brave] = await Promise.all([
      ctx.search("exa", req),
      ctx.search("brave", req)
    ]);
    return { kind: "success", evidence: [...exa, ...brave], /* ... */ };
  }
});
```

### Custom module

```ts
import { defineModule } from "srch";

const myModule = defineModule({
  name: "my-module",
  sources: [mySource],
  strategies: [myStrategy],
  domains: [{ name: "web", defaultStrategy: "web/parallel" }]
});
```

### Config is code

```ts
// srch.config.ts
import { defineConfig, coreModule, flightsModule } from "srch";

export default defineConfig({
  modules: [coreModule, flightsModule, myModule],
  defaults: { domain: "web" }
});
```

No YAML. No manifest language. Your config is a TypeScript file with full type checking and autocomplete.

---

## Agent hooks

`srch` injects ambient context at session start for supported agent runtimes. This gives the agent awareness of available retrieval domains without tool enumeration.

```bash
search hooks install       # auto-detects Claude Code, Codex, pi
search hooks status --json
search hooks uninstall
```

Supported runtimes:
- **Claude Code** -- patches `~/.claude/settings.json`
- **Codex** -- patches `~/.codex/hooks.json`
- **pi** -- installs extension at `~/.pi/agent/extensions/srch.ts`

You can also emit the context directly:

```bash
search ambient-context
```

---

## Output

Human-readable text by default. Stable JSON envelope with `--json`.

```bash
search web "react compiler"                          # human text
search web "react compiler" --json                   # JSON envelope
search web "react compiler" --json --out results.json # save to file
search web --json "react compiler"                   # flags may precede the query
```

```json
{
  "ok": true,
  "command": ["web"],
  "data": {
    "kind": "success",
    "evidence": [{ "source": "exa", "payload": { "title": "...", "url": "..." } }],
    "summary": "...",
    "totalEvidence": 5,
    "sourceBreakdown": { "exa": 5 }
  }
}
```

Empty results are explicit, not silent:

```json
{
  "ok": true,
  "data": {
    "kind": "empty",
    "summary": "No results found",
    "suggestions": ["Try broadening your query", "Try a different domain"]
  }
}
```

---

## CLI reference

```
search web <query>                     web search
search code <query>                    code/library context
search code repo <target> <query>      deep repo search
search docs <query>                    local doc search
search fetch <url>                     readable page extraction
search social <query>                  social/Twitter search
search flights <origin> <dest> <date>  flight fares (optional)
search rewards-flights <o> <d>         award flights (optional)
search ask <task>                      cross-domain retrieval
search hooks install|uninstall|status  agent session hooks
search install <target>                install optional domains
search config                          config management
search inspect tools                   backend diagnostics
search history                         prior runs
search ambient-context                 emit session context
```

With no arguments, `search` shows a compact status dashboard.

---

## Backends

| Capability | Providers |
|-----------|-----------|
| Web search | Exa (free MCP + paid API), Brave (free tier), Gemini (API + cookie fallback), Perplexity |
| Code search | Exa Context API, Context7 (free), DeepWiki (free) |
| Local docs | QMD SDK (BM25 + vector + reranking) |
| Page extraction | Readability, Jina Reader, Gemini URL Context |
| Social | Bird SDK (Chrome/Safari cookie auth) |
| Flights | Fli Python SDK (Google Flights) |
| Rewards flights | Seats.aero API |
| GitHub repos | Clone + `gh` API fallback |
| PDF | Text extraction via unpdf |

### Secret management

Runtime secret resolution from 1Password or fnox. No plaintext on disk.

```bash
search config set-secret-ref exaApiKey op 'op://vault/exa/API Key'
search config set-secret-ref braveApiKey op 'op://vault/brave/api key'
search inspect tools --json   # verify resolution
```

---

## FAQ

### How is this different from MCP?

MCP gives you a flat list of tools. The agent has to pick the right one, handle failures, and parse untyped output. `srch` gives the agent a typed domain model: one interface for retrieval, automatic fallback across providers, discriminated union results, and grounded evidence with provenance. Fewer decisions for the agent, better results. The `search` CLI exposes the same model for shell workflows.

### Why TypeScript?

Codeact-style agents write and execute code. TypeScript gives them type safety, autocomplete, and a stable API contract. The SDK is the agent interface. The CLI is just a convenience wrapper.

### Do I need API keys?

Not to start. The default web strategy uses free providers first (Exa MCP, Brave free tier, Gemini cookie fallback). Add keys for higher quality or rate limits.

### Can I add my own retrieval sources?

Yes. `defineSource()` creates a typed source adapter. Bundle it into a module with `defineModule()` and load it through `srch.config.ts`. No forking needed.

### How does config work?

Config is code. Drop a `srch.config.ts` in your project root. It exports a `defineConfig(...)` call with full TypeScript checking. No YAML, no JSON schema, no manifest language.

### What about flights?

Flights is an optional domain backed by a Python SDK (`fli`). Run `search install flights` to set it up. It stays out of the base install so the core package is lean.

### Is it just for agents?

No. The `search` CLI works great for humans and shell scripts. But the `srch` SDK is designed agent-first: typed requests and results, explicit empty states, structured error suggestions, and session hooks for ambient context injection.

### What agent runtimes are supported?

Session hooks work with Claude Code, Codex, and pi today. The hook adapter model is generic, so adding new runtimes is straightforward.

---

## License

MIT
