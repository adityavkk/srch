# srch

A TypeScript SDK that gives agents structured access to search as a domain.

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
import { createClient } from "srch";

const client = createClient();

const result = await client.run({ domain: "web", query: "bun sqlite" });
// result.kind === "success" | "empty" | "error"
// result.evidence[0].payload.title, .url, .snippet, ...
```

---

## Quick start

### As a TypeScript SDK

```bash
npm install srch
```

```ts
import { createClient } from "srch";

const client = createClient();

// web search with automatic fallback across providers
const web = await client.run({ domain: "web", query: "react server components" });

// code context for a library or API
const code = await client.run({ domain: "code", query: "drizzle orm migrations" });

// extract readable content from a URL
const page = await client.run({ domain: "fetch", query: "https://bun.sh/docs/runtime/sqlite" });

// search tweets
const social = await client.run({ domain: "social", query: "bun 1.2 release" });
```

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

Automatic fallback chain, free-first:

```ts
// uses Exa MCP -> Brave -> Gemini -> Perplexity (first that works)
await client.run({ domain: "web", query: "bun sqlite wasm" });

// pin a specific provider
await client.run({ domain: "web", query: "bun sqlite", provider: "brave" });
```

```bash
search web "bun sqlite wasm"
search web "react compiler" --provider brave --json
```

### Code

Library docs, public repos, local codebases:

```ts
await client.run({ domain: "code", query: "react suspense cache" });
```

```bash
search code "react suspense cache"
search code repo facebook/react "useEffect cleanup"    # deep repo search
search code repo . "auth middleware"                    # local codebase
```

### Fetch

Turn any URL into clean, readable content:

```ts
await client.run({ domain: "fetch", query: "https://clig.dev" });
```

```bash
search fetch https://clig.dev
search fetch https://github.com/tobi/qmd --json
search fetch https://arxiv.org/pdf/1706.03762.pdf
```

### Flights (optional)

Powered by the Python `fli` SDK. Install separately:

```bash
search install flights
```

```ts
import { createClient, defineConfig, flightsModule } from "srch";

const client = createClient({ config: defineConfig({ modules: [flightsModule] }) });

const result = await client.run({
  domain: "flights",
  query: "JFK HNL 2026-04-20",
  options: { adults: 4, cabinClass: "C", maxStopovers: 0, sort: "price" }
});
```

```bash
search flights JFK HNL 2026-04-20 --cabin C --adults 4 --sort price --json
```

---

## How it works

```
agent code / CLI args
       |
       v
  client.run({ domain, query, ... })
       |
       v
  strategy (source selection, fallback, retry)
       |
       v
  source adapters (exa, brave, gemini, fli, ...)
       |
       v
  Evidence<T>[] -- typed, grounded, with provenance
       |
       v
  RunResult = RunSuccess | RunEmpty | RunError
```

**Sources** are retrieval adapters. Each source does one thing: call a provider and return typed evidence.

**Strategies** are retrieval programs over sources. The default web strategy is a fallback chain. You can write your own.

**Domains** bind sources and strategies into a stable retrieval space with typed evidence payloads.

**Evidence** is a grounded result pointer. Every piece of evidence carries a source name, provenance, and domain-specific payload. No hallucinated citations.

**RunResult** is a discriminated union. Your code always knows if retrieval succeeded, returned empty, or failed. No silent failures.

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
