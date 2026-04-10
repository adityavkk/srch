# srch

Local-first retrieval SDK for agents. CLI thin frontend.

<p align="center">
  <img src="demo.gif" alt="srch demo" width="800">
</p>

## Install

```bash
git clone https://github.com/adityavkk/srch.git
cd srch
npm install
npm run build
ln -s $(pwd)/dist/cli.js ~/bin/search
```

### Optional flights domain

`search flights` is intentionally optional so the base install stays lean.

Install it through `srch` directly:

```bash
search install flights
search install all
```

Manual fallback:

```bash
python3 -m pip install flights
```

`srch` integrates with the Python `fli` SDK package (`flights`) for Google Flights-style search.

## What it does

`srch` is an agent-first programmable retrieval engine.

Core idea:
- search should be a domain, not a flat bag of tools
- agents should program against typed retrieval nouns and verbs
- CLI should be a thin frontend over the same model

The SDK owns the retrieval model:
- `domain`: stable retrieval space like `web`, `code`, `docs`, `fetch`, `social`
- `source`: one retrieval primitive or provider
- `strategy`: retrieval program over sources
- `evidence`: grounded result with provenance
- `hooks`: ambient session context for agent runtimes

For agents, this gives a better interface than a tool list:
- fewer tool-selection mistakes
- typed requests/results
- stable domain vocabulary
- code-is-config and code-is-plan
- same retrieval model in CLI and SDK

## SDK

Install as a package:

```bash
npm install search-tool
```

Import from the package root:

```ts
import { createClient } from "search-tool";

const client = createClient();

const web = await client.run({
  domain: "web",
  query: "bun sqlite"
});

if (web.kind === "success") {
  console.log(web.evidence[0].payload);
}
```

This is the main agent surface.

An agent does not need to pick from a long list of ad hoc tools. It can stay inside the search domain:

```ts
import { createClient } from "search-tool";

const client = createClient();

const web = await client.run({
  domain: "web",
  query: "best bun sqlite docs"
});

const code = await client.run({
  domain: "code",
  query: "bun sqlite transactions"
});

const page = await client.run({
  domain: "fetch",
  query: "https://bun.sh/docs/runtime/sqlite"
});
```

Low-level source access is available when the agent wants to control routing directly:

```ts
import { createClient, exaSource } from "search-tool";

const client = createClient();
const evidence = await client.search(exaSource, {
  query: "bun sqlite",
  mode: "mcp"
});
```

Config is code:

```ts
// srch.config.ts
import { defineConfig, coreModule, flightsModule } from "search-tool";

export default defineConfig({
  modules: [coreModule, flightsModule],
  defaults: {
    domain: "web"
  }
});
```

Agent-specific pieces:
- `createClient()` for execution
- `defineSource()` for retrieval adapters
- `defineStrategy()` / `defineAgenticStrategy()` for retrieval programs
- `defineModule()` for bundling domains, sources, and strategies
- `search hooks install` for session-start ambient context

## Output and persistence

Default output is concise human-readable text.

Use `--json` for a stable automation envelope.

Use `--out <path>` to persist the final rendered output to a file:
- without `--json`, saves the same text shown in the terminal
- with `--json`, saves the same JSON envelope shown in the terminal

Examples:

```bash
search web "bun sqlite wasm" --out results.txt
search code repo facebook/react "useEffect cleanup" --json --out react-search.json
search flights GDN BER 2026-03-03 --out fares.txt
```

## Commands

```
search web <query>                    web retrieval
search code <query>                   code/docs context
search code repo <target> <query>     deep repo search
search docs <query>                   local doc search
search flights <origin> <dest> <date> optional flight search via Fli
search rewards-flights <o> <d>        award flights via Seats.aero
search install <target>               install optional domains
search social <query>                 social retrieval
search social x <query>               X/Twitter subdomain
search fetch <url>                    readable page extraction
search ask <task>                     cross-domain retrieval
search history                        prior runs
search inspect tools                  backend diagnostics
search config                         safe config management
```

## Search as a domain

`srch` is built around a domain-first grammar:

```text
search <domain> [subdomain] [strategy] [target] <query-or-task>
```

Same idea in the SDK:

```ts
await client.run({ domain: "web", query: "bun sqlite" });
await client.run({ domain: "code", query: "bun sqlite transactions" });
await client.run({ domain: "docs", query: "auth middleware" });
```

Examples:

```bash
search web "bun sqlite"
search code repo facebook/react "useEffect cleanup"
search flights LHR BCN 2026-06-15
search rewards-flights JFK CDG --date 2026-07-01 --cabin business
search social x thread https://x.com/.../status/123
search ask compare "best state management for a docs-heavy react app"
```

Concepts:
- `domain`: retrieval space like `web`, `code`, `docs`, `social`, `ask`
- `subdomain`: optional narrower space like `x`, `reddit`, `github`
- `strategy`: static or agentic retrieval behavior like `repo`, `research`, `verify`, `compare`

This is the main design goal: give agents the best possible access to search as a coherent domain model instead of forcing them to juggle unrelated tools.

## Web search

Fallback chain (free-first):
1. Exa free MCP (no key needed)
2. Brave (free tier credits)
3. Gemini browser cookies (free)
4. Gemini API (uses key credits)
5. Perplexity (uses key credits)

Use `--hq` for Exa paid API (answer synthesis, highlights, uses credits).

```bash
search web bun sqlite wasm
search web react compiler --hq --json
search web react compiler --provider brave --json
search web sqlite wasm --provider gemini --json
```

## Code search

Primary: Exa Context API. Secondary: Context7 (free library docs) + DeepWiki (public repos).

All available secondary sources are always included when they return meaningful results.

```bash
search code "react suspense cache"
search code "facebook/react hooks" --json
search code "sqlite wal checkpoint" --max-tokens 8000
```

Deep search: clone (or reuse cached clone) and search locally.

```bash
search code repo facebook/react "useEffect cleanup"
search code repo . "auth middleware" --json
search code repo ~/dev/myproject "database connection"
```

## Local docs

Backed by QMD SDK. Index your own collections.

```bash
search docs index add ./docs --name project-docs
search docs index update
search docs auth flow --json
```

## Flights

Backed by the optional Python `fli` SDK package (`flights`).

`srch` exposes:
- fare search
- route / airport resolution
- normalized result output inside `srch`

Install:

```bash
search install flights
search install flights --dry-run --json
search install all
```

Manual fallback:

```bash
python3 -m pip install flights
```

Examples:

```bash
search flights JFK DEL 2026-05-15 --cabin C --sort price
search flights search LON BCN 2026-04-01 --return 2026-04-08 --sort price --json
search flights resolve "berlin"
```

Notes:
- Fli is a Python SDK/CLI for Google Flights-style search
- `search install flights` installs the Python package `flights`
- `resolve` matches against Fli's bundled airport data
- `srch` currently exposes search and airport lookup, not booking

## Rewards flights

Backed by the official Seats.aero API.

`srch` exposes award-search workflows directly:
- cached award availability by route
- loyalty program filtering
- trip-level detail lookup
- monitored route browsing by mileage program

Setup:

```bash
search rewards-flights auth instructions
search rewards-flights auth set pro_xxx
search config set-secret-ref seatsAeroApiKey op 'op://agent-dev/Seats Aero/API Key'
```

Manual fallback:

```bash
export SEATS_AERO_API_KEY=pro_xxx
```

Examples:

```bash
search rewards-flights auth status
search rewards-flights JFK CDG --date 2026-07-01 --cabin business --source flyingblue
search rewards-flights search SFO HND --start-date 2026-10-01 --end-date 2026-10-10 --cabin first --direct --json
search rewards-flights routes aeroplan
search rewards-flights trips avail_123 --json
```

Notes:
- Seats.aero cached search can lag live airline inventory
- `srch` uses Seats.aero cached endpoints, not the commercial-only Live Search API
- always verify award space before transferring points or miles

## Travel workflow

See `docs/travel.md` for the dedicated end-to-end travel workflow.

Recommended user journey:

1. Research destinations, hotels, and itinerary ideas in `srch`

```bash
search web "best boutique hotels in barcelona near sagrada familia"
search web "3 day barcelona itinerary for first time visitors"
search fetch https://example.com/barcelona-neighborhood-guide
```

2. Search fares in `srch`

```bash
search flights JFK BCN 2026-06-12 --return 2026-06-19 --sort price
search flights resolve "barcelona"
search rewards-flights JFK BCN --start-date 2026-06-12 --end-date 2026-06-19 --cabin business --source flyingblue
```

3. Take action in your booking channel

Use `srch` to compare live fares, then complete the booking in your preferred airline, OTA, or future booking integration.

## Fetch content

Handles HTML, GitHub repos, PDFs, JS-rendered pages.

Fallback chain: HTTP + Readability -> RSC -> Jina Reader -> Gemini URL Context

```bash
search fetch https://clig.dev
search fetch https://github.com/tobi/qmd --json
search fetch https://arxiv.org/pdf/1706.03762.pdf --json
```

## Social / X

Search social sources, read individual posts, fetch threads.

Today:

```bash
search twitter "bun runtime"
search twitter read https://x.com/i/status/123456
search twitter thread https://x.com/i/status/123456 --json
search x.com "react compiler" --count 20
```

Direction:

```bash
search social x "bun runtime"
search social x thread https://x.com/i/status/123456
search social reddit "react compiler"
```

## Output

**Default**: short, readable, low-token.

**`--json`**: stable envelope for automation.

**`--out <path>`**: persist the final rendered output to a file.

```json
{
  "ok": true,
  "command": ["web"],
  "data": {
    "answer": "...",
    "results": [...],
    "provider": "exa",
    "native": { ... }
  }
}
```

**`--verbose`**: trace view on stderr showing routing, timing, and backend selection.

Examples:

```bash
search web react compiler --out web.txt
search web react compiler --json --out web.json
```

## Hooks and ambient context

Install session hooks for supported runtimes:

```bash
search hooks install
search hooks status --json
search hooks uninstall
```

Alias:

```bash
search install hooks
```

Emit the compact session-start dashboard directly:

```bash
search ambient-context
```

Current adapters:
- Claude Code
- Codex
- pi

## Safe config

Runtime secret resolution from 1Password or fnox. No plaintext writes needed.

```bash
search config set-secret-ref exaApiKey op 'op://vault/exa/API Key'
search config set-secret-ref braveApiKey op 'op://vault/brave/api key'
search config set-secret-ref geminiApiKey op 'op://vault/gemini/password'
search config --json
search inspect tools --json
```

Resolution order: env vars -> config refs -> fnox fallback.

For SDK config loading, `srch` searches upward for:
- `srch.config.ts`
- `srch.config.mts`
- `srch.config.js`
- `srch.config.mjs`

## Progressive disclosure

```bash
search --help
search web --help
search code --help
search docs --help
search twitter --help
search config --help
```

## Backends

| Capability | Backends |
|-----------|----------|
| Web search | Exa, Brave, Perplexity, Gemini API, Gemini Web (cookie fallback) |
| Code search | Exa Context API, Exa MCP, Context7, DeepWiki |
| Local docs | QMD SDK (BM25 + vector + reranking) |
| Flights | Fli Python SDK (`flights`) |
| Page fetch | Readability, Jina Reader, Gemini URL Context, RSC parser |
| GitHub | Clone + API fallback via `gh` |
| PDF | Text extraction via unpdf |
| Twitter | Bird SDK (cookie auth from Chrome/Safari) |

## Roadmap

### Programmable retrieval engine

Evolve `srch` from a set of built-in commands into a programmable retrieval engine with first-class extension points.

Core concepts:
- sources: retrieval adapters/providers
- strategies: retrieval programs over sources
- static strategies: fixed recipes
- agentic strategies: adaptive recipes with evaluation/revision
- domains/subdomains: stable user-facing retrieval spaces

### Extension point: sources

Implement new sources or install them from a registry/list.

Examples:
- `@srch/reddit`
- `@srch/hn`
- `@srch/arxiv`
- `@srch/slack`
- `@srch/gitlab`

A source should do one thing well and return normalized evidence while preserving native payloads.

### Extension point: strategies

Extend existing domains declaratively or implement your own strategies.

Examples:
- add `web research`
- add `code investigate`
- add `social reddit research`
- add a custom `docs compare`
- add a new domain or subdomain with its own strategy set

The goal is for common retrieval behavior to be configurable as data:
- source selection
- fallback order
- fetch/rerank steps
- stop conditions
- synthesis prompts

### Extension point: domains and subdomains

Add durable retrieval spaces without polluting the root CLI.

Examples:
- `search social reddit ...`
- `search code github ...`
- `search docs npm ...`

### Extension point: agentic strategies

Plug in an SDK-backed retrieval agent and host it as an agentic strategy inside a domain.

Examples:
- implement `ask compare` using a Claude SDK policy
- implement `code investigate` using a pi-mono-style planner/evaluator loop
- implement `web research` with a custom retrieval policy and synthesis stack

Longer-term shape:
- source SDK for retrieval adapters
- strategy SDK for static and agentic strategies
- agent SDK integration for retrieval-specialized planners/evaluators
- stable JSON/trace outputs for all layers

## License

MIT
