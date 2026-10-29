---
name: search
description: >-
  Runs SDK-first research with the `srch` TypeScript SDK across web, fetch,
  code, docs, social, flights, and provider-specific search. Use when the user
  asks for external research, source-backed answers, multi-step lookup,
  source comparison, or typed retrieval feeding later decisions. SDK is primary
  for non-trivial queries; CLI is only for quick checks and diagnostics.
sample-prompts:
  - "research this with sources"
  - "compare official docs and recent web results"
  - "fetch these pages and summarize the evidence"
  - "price flights for this event and recommend go/no-go"
  - "triage whether this CVE affects our repo"
---

# search

Use `srch` as a TypeScript SDK first. For any non-trivial query, the SDK is the primary interface. Treat the CLI as a quick-check/diagnostic fallback only.

## Decision rule

Default to the SDK for agent work. Use the CLI only when the query is truly trivial or diagnostic.

- Non-trivial research, ranking, branching, joins, retries, source comparison, reusable output, or anything feeding a later step: **SDK**.
- One-off human check, install/health diagnostics, or shell-only consumer: CLI.
- Avoid CLI/MCP sprawl: no `search ... --json | jq ...` when TS can keep typed objects.

## SDK bootstrap

`search` on `$PATH` does not mean `import "srch"` works. Per repo, verify/install local SDK:

```bash
bun --no-install - <<'TS' >/dev/null 2>&1 || bun add srch@file:/Users/auk000v/dev/search-tool
const { createClient } = await import("srch");
if (typeof createClient !== "function") throw new Error("not the local srch SDK");
TS
```

Trap: without `--no-install`, Bun auto-installs the unrelated npm package `srch` in a folder with no `node_modules`, so a bare import passes while the local SDK is missing.

If package mutation is not OK, install in `.tmp/srch-run/` and `process.chdir(targetRepo)` before `createClient()`. Give that folder its own `package.json` first; otherwise `bun add` walks up and edits the repo's `package.json`.

Use a subshell for temp SDK setup. Do not `cd .tmp/srch-run` and then write later files with relative paths like `.tmp/srch-run/foo.ts`; that resolves under the changed cwd.

```bash
mkdir -p .tmp/srch-run
(
  cd .tmp/srch-run || exit 1
  [ -f package.json ] || echo '{ "private": true }' > package.json
  bun --no-install - <<'TS' >/dev/null 2>&1 || bun add srch@file:/Users/auk000v/dev/search-tool
const { createClient } = await import("srch");
if (typeof createClient !== "function") throw new Error("not the local srch SDK");
TS
)
```

After that, write scripts from the repo root and run them in a subshell:

```bash
cat > .tmp/srch-run/research.ts <<'TS'
import { createClient } from "srch";

process.chdir("../..");
const c = createClient();
const r = await c.run({ domain: "web", query: "bun sqlite wasm", numResults: 5 });
console.log(JSON.stringify(r, null, 2));
TS

(cd .tmp/srch-run && bun --no-install research.ts)
```

## Run pattern

Bun runs TypeScript directly. Always pass `--no-install` (same trap as above). No `bunx`, `tsx`, or `jq`.

```bash
bun --no-install - <<'TS'
import { createClient } from "srch";
const c = createClient();
const r = await c.run({ domain: "web", query: "bun sqlite wasm", numResults: 5 });
console.log(JSON.stringify(r.kind === "success" ? r.evidence.map(e => e.payload.url) : r, null, 2));
TS
```

Longer flow: `.tmp/search.ts` then `bun --no-install .tmp/search.ts`.

## Fetch extraction

For fetched documents, prefer `payload.content`; some payloads may expose `payload.text`. Do not assume `text` is the only field. Avoid `any`; use `unknown` plus a small extractor, or inspect one raw result before writing downstream logic.

```ts
function documentText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Partial<Record<"content" | "text", unknown>>;
  if (typeof p.content === "string") return p.content;
  if (typeof p.text === "string") return p.text;
  return "";
}

const r = await c.run({ domain: "fetch", query: url });
const doc = r.kind === "success" ? r.evidence[0]?.payload : undefined;
const text = documentText(doc);
```

## High-value SDK shape

Use real user journeys, not a bag of tools.

```
sequential discovery -> control flow -> parallel retrieval -> typed scoring -> JSON decision
```

Why SDK beats CLI/MCP for these: payloads stay typed, source provenance stays attached, later queries can depend on earlier results, and normal TS handles branching/errors.

## Example journeys

### Travel decision brief

Ask: "Can I send someone from SFO to AWS re:Invent? Verify dates, price flights, recommend go/no-go."

Flow:

| Step | Domain | Use |
|---|---|---|
| 1 | `web` | find official event page |
| 2 | `fetch` | extract dates/location |
| 3 | `flights` | price route/date options |
| 4 | TS | score fare = price + stop penalty |

Requires flights backend:

```bash
search install flights
```

Result shape to show:

```json
{
  "verifiedEvent": { "title": "AWS re:Invent 2026", "source": "https://aws.amazon.com/reinvent/" },
  "flightShortlist": [{ "price": 499, "summary": "SFO -> LAS | economy | 0 stops", "score": 499 }],
  "recommendation": "Go: official event found, route priced."
}
```

### CVE triage brief

Ask: "A CVE dropped for lodash. Are we affected and should we patch today?"

Flow:

| Step | Domain/TS | Use |
|---|---|---|
| 1 | `web` | find authoritative advisory |
| 2 | `fetch` | extract affected/fixed versions |
| 3 | TS/local files or `code` | search lockfiles/imports for affected version |
| 4 | TS | branch: patch/no-op/escalate |

Result shape to show:

```json
{
  "package": "lodash",
  "installedVersion": "4.17.20",
  "advisory": { "url": "https://github.com/advisories/..." },
  "repoEvidence": [{ "file": "package-lock.json", "currentVersionFound": true }],
  "decision": "patch today",
  "nextSteps": ["bump dependency", "regenerate lockfile", "run tests", "ship patch"]
}
```

## Domain map

| Need | SDK | CLI fallback |
|---|---|---|
| Web | `c.run({ domain: "web", query })` | `search web "q" --json` |
| HQ web | `c.run({ domain: "web", query, hq: true })` | `search web "q" --hq --json` |
| Steer Exa | `c.run({ domain: "web", query, objective: "facts to pull out" })` | `search web "q" --objective "..." --json` |
| Code/API/repo | `c.run({ domain: "code", query })` | `search code "q" --json` |
| Local docs | `c.run({ domain: "docs", query })` | `search docs "q" --json` |
| Fetch URL | `c.run({ domain: "fetch", query: url })` | `search fetch <url> --json` |
| Fetch + images | `c.run({ domain: "fetch", query: url, downloadImagesDir: ".tmp/img", describeImages: true })` | `search fetch <url> --download-images .tmp/img --describe-images --json` |
| Flights | `c.run({ domain: "flights", query: "SFO LAS 2026-11-29" })` | `search flights SFO LAS 2026-11-29 --json` |
| Social/X | `c.run({ domain: "social", query })` | `search twitter "q" --json` |
| Provider exactness | `c.search("exa", { query })` | `search web "q" --provider exa --json` |
| Diagnostics | CLI | `search inspect tools --json`, `search inspect exa` |

## Agent rules

- SDK is the primary interface for all non-trivial agent work.
- Lead with the user journey and desired decision object.
- Compose domains in TypeScript, not bash.
- Fetch first, summarize second. Never invent sources.
- Fetch preserves GFM tables and `images[]`; use `downloadImagesDir` for durable image links and `describeImages` for diagrams.
- Web hits carry a `snippet` and inline `content` (Exa highlights). Fetch retries through Exa when a page blocks plain HTTP; `source` is then `exa-fetch`.
- Emit structured JSON for downstream steps.
- Secrets: runtime refs only, never plaintext.
