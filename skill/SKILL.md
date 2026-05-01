---
name: search
description: "SDK-first local research tool. Prefer typed TypeScript via Bun; use CLI only for quick checks/fallback."
---

# search

Local-first research SDK + CLI.

## Default: TypeScript SDK via Bun

Primary path: run TypeScript, not bash pipelines. `createClient()` returns native typed objects, so agents can use `Promise.all`, branches, maps/filters, joins, ranking, and JSON emission without parsing CLI text.

Shortest run forms:

```bash
bun - <<'TS'
import { createClient } from "srch";
const c = createClient();
const r = await c.run({ domain: "web", query: "bun sqlite wasm", numResults: 5 });
console.log(JSON.stringify(r.kind === "success" ? r.evidence.map(e => e.payload.url) : r, null, 2));
TS
```

```bash
# longer/reused scripts
mkdir -p .tmp
bun .tmp/search.ts
```

No `bunx`, `tsx`, or flags needed. Bun runs TS directly. Use inline `bun - <<'TS'` for small scratch searches; `.tmp/search.ts` for >~15 lines or reusable flows.

Use CLI only for quick checks, diagnostics, or shell consumers. Avoid `search ... --json | jq ...` when TS can keep native types.

## Powerful SDK patterns

### Search, fetch top pages, emit evidence bundle

```ts
import { createClient } from "srch";
const c = createClient();
const q = "react compiler memoization best practices";

const web = await c.run({ domain: "web", query: q, numResults: 6 });
if (web.kind !== "success") throw new Error(web.kind === "error" ? web.error.message : web.suggestions[0]);

const pages = await Promise.all(web.evidence.slice(0, 3).map(e =>
  c.run({ domain: "fetch", query: e.payload.url })
));

console.log(JSON.stringify({
  query: q,
  docs: pages.flatMap(p => p.kind === "success" ? p.evidence.map(e => ({
    title: e.payload.title,
    url: e.payload.url,
    excerpt: e.payload.content.slice(0, 1200)
  })) : [])
}, null, 2));
```

### Search multiple domains, rank in TypeScript

```ts
import { createClient } from "srch";
const c = createClient();
const q = "next.js middleware auth redirect";

const [code, docs] = await Promise.all([
  c.run({ domain: "code", query: q, maxTokens: 6000 }),
  c.run({ domain: "docs", query: q, limit: 8 })
]);

const hits = [
  ...(code.kind === "success" ? code.evidence.map(e => ({ type: "code", title: e.payload.title, text: e.payload.text })) : []),
  ...(docs.kind === "success" ? docs.evidence.map(e => ({ type: "docs", title: e.payload.title, file: e.payload.file, score: e.payload.score, text: e.payload.snippet })) : [])
]
  .filter(e => e.text.toLowerCase().includes("middleware"))
  .sort((a, b) => b.text.length - a.text.length);

console.log(JSON.stringify(hits.slice(0, 5), null, 2));
```

### Direct provider/source control

```ts
import { createClient } from "srch";
const c = createClient();
const query = "sqlite vector search wasm";

const [exa, brave] = await Promise.all([
  c.search("exa", { query, mode: "api", numResults: 5, includeContent: true }).catch(() => []),
  c.search("brave", { query, numResults: 5 }).catch(() => [])
]);

const unique = [...new Map([...exa, ...brave].map(e => [e.payload.url, e])).values()];
console.log(unique.map(e => ({ source: e.source, title: e.payload.title, url: e.payload.url })));
```

### Timeout + typed success/empty/error handling

```ts
import { createClient } from "srch";
const c = createClient();
const ac = new AbortController();
const t = setTimeout(() => ac.abort(), 12_000);

try {
  const r = await c.run({ domain: "web", query: "latest bun release notes", hq: true, signal: ac.signal });
  if (r.kind === "success") console.log(r.evidence.map(e => e.payload.url));
  else if (r.kind === "empty") console.log({ empty: true, suggestions: r.suggestions });
  else console.error({ code: r.error.code, message: r.error.message });
} finally {
  clearTimeout(t);
}
```

## Domains / CLI fallback

| Need | SDK | CLI quick check |
|---|---|---|
| Web | `c.run({ domain: "web", query })` | `search web "react compiler" --json` |
| High-quality web | `c.run({ domain: "web", query, hq: true })` | `search web "react compiler" --hq --json` |
| Code/API/repo context | `c.run({ domain: "code", query })` | `search code "next.js middleware" --json` |
| Local docs | `c.run({ domain: "docs", query })` | `search docs "auth flow" --json` |
| Fetch URL content | `c.run({ domain: "fetch", query: url })` | `search fetch https://clig.dev --json` |
| X/Twitter | `c.run({ domain: "social", query })` | `search twitter "bun runtime" --json` |
| Provider exactness | `c.search("exa", { query })` | `search web "q" --provider exa --json` |
| Diagnostics | CLI | `search inspect tools --json` |

## Agent rules

- Default to SDK + Bun for multi-step research.
- Use `bun - <<'TS'` for concise scratch scripts.
- Use `.tmp/search.ts` + `bun .tmp/search.ts` for longer scripts.
- Fetch first, summarize second. Do not invent sources.
- Keep stdout structured JSON if another step will consume it.
- Use CLI only for quick checks, diagnostics, or non-TS consumers.
- Secrets: use runtime secret refs, never plaintext.

```bash
search config set-secret-ref exaApiKey op 'op://agent-dev/exa/API Key'
search config set-secret-ref braveApiKey op 'op://agent-dev/Brave Search/api key'
search config set-secret-ref geminiApiKey op 'op://agent-dev/Gemini API Key/password'
search inspect tools --json
```
