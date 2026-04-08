# srch

Local-first research CLI for agents and humans. One command, many backends.

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

Install the companion JS SDK only if you want flight search + booking:

```bash
npm install letsfg
```

LetsFG's local search runtime also needs Python + Playwright:

```bash
pip install letsfg
playwright install chromium
```

If `search` is installed globally, install the companion package globally too:

```bash
npm install -g letsfg
```

`srch` only brings in LetsFG's search surface. Booking and account workflows stay in the native `letsfg` tool.

## What it does

`search` is a single CLI that routes queries to the right backend and returns grounded, cited results. Designed for LLM agents and humans who want answers fast with minimal tokens.

## Commands

```
search web <query>                    web retrieval
search code <query>                   code/docs context
search code repo <target> <query>     deep repo search
search docs <query>                   local doc search
search flights <origin> <dest> <date> optional flights via LetsFG
search social <query>                 social retrieval
search social x <query>               X/Twitter subdomain
search fetch <url>                    readable page extraction
search ask <task>                     cross-domain retrieval
search history                        prior runs
search inspect tools                  backend diagnostics
search config                         safe config management
```

## Command taxonomy

`srch` is moving toward a domain-first grammar:

```text
search <domain> [subdomain] [strategy] [target] <query-or-task>
```

Examples:

```bash
search web "bun sqlite"
search code repo facebook/react "useEffect cleanup"
search flights LHR BCN 2026-06-15
search social x thread https://x.com/.../status/123
search ask compare "best state management for a docs-heavy react app"
```

Concepts:
- `domain`: retrieval space like `web`, `code`, `docs`, `social`, `ask`
- `subdomain`: optional narrower space like `x`, `reddit`, `github`
- `strategy`: static or agentic retrieval behavior like `repo`, `research`, `verify`, `compare`

`ask` is not a special case. It is a cross-domain retrieval domain.

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

Backed by the optional LetsFG TypeScript SDK.

`srch` exposes the research side only:
- flight offer search
- route / airport resolution
- handoff guidance into native `letsfg`

Default search maps to LetsFG's `search` flow:

```bash
search flights GDN BER 2026-03-03
search flights search LON BCN 2026-04-01 --return 2026-04-08 --sort price --json
```

Location resolution:

```bash
search flights resolve "berlin"
```

Notes:
- `search` and `resolve` use LetsFG's local Python runtime
- `srch` intentionally stops at search/research and does not book flights
- after finding an offer in `srch`, switch to native `letsfg` for action workflows

Native `letsfg` capabilities you use after handoff:

```bash
letsfg register --name srch-agent --email me@example.com
letsfg link-github your-github-user
letsfg unlock off_xxx
letsfg setup-payment
letsfg book off_xxx --passenger '{"id":"pas_xxx","given_name":"John","family_name":"Doe","born_on":"1990-01-15"}' --email john@example.com
letsfg me
letsfg system-info
```

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
```

3. Take action in native tools

```bash
letsfg unlock off_xxx
letsfg setup-payment
letsfg book off_xxx --passenger '{"id":"pas_xxx",...}' --email you@example.com
```

This keeps `srch` as the unified research surface and uses purpose-built tools like `letsfg` when you are ready to transact.

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
| Flights | Optional LetsFG TypeScript SDK + LetsFG local Python runtime |
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
