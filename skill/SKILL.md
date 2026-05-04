---
name: search
description: "SDK-first research tool. Default to typed TypeScript via Bun; compose domains in one control-flow graph. CLI only for quick checks/diagnostics."
---

# search

Use `srch` as a TypeScript SDK first. Treat the CLI as a fallback.

## Decision rule

- Multi-step research, ranking, branching, joins, retries, or reusable output: **SDK**.
- One-off human check, diagnostics, or shell-only consumer: CLI.
- Avoid CLI/MCP sprawl: no `search ... --json | jq ...` when TS can keep typed objects.

## SDK bootstrap

`search` on `$PATH` does not mean `import "srch"` works. Per repo, verify/install local SDK:

```bash
bun - <<'TS' >/dev/null 2>&1 || bun add srch@file:/Users/auk000v/dev/search-tool
await import("srch");
TS
```

If package mutation is not OK, create `.tmp/srch-run/`, install there, and `process.chdir(targetRepo)` before `createClient()`.

## Run pattern

Bun runs TypeScript directly. No `bunx`, `tsx`, flags, or `jq`.

```bash
bun - <<'TS'
import { createClient } from "srch";
const c = createClient();
const r = await c.run({ domain: "web", query: "bun sqlite wasm", numResults: 5 });
console.log(JSON.stringify(r.kind === "success" ? r.evidence.map(e => e.payload.url) : r, null, 2));
TS
```

Longer flow: `.tmp/search.ts` then `bun .tmp/search.ts`.

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
| Code/API/repo | `c.run({ domain: "code", query })` | `search code "q" --json` |
| Local docs | `c.run({ domain: "docs", query })` | `search docs "q" --json` |
| Fetch URL | `c.run({ domain: "fetch", query: url })` | `search fetch <url> --json` |
| Flights | `c.run({ domain: "flights", query: "SFO LAS 2026-11-29" })` | `search flights SFO LAS 2026-11-29 --json` |
| Social/X | `c.run({ domain: "social", query })` | `search twitter "q" --json` |
| Provider exactness | `c.search("exa", { query })` | `search web "q" --provider exa --json` |
| Diagnostics | CLI | `search inspect tools --json` |

## Agent rules

- SDK is default interface for agent work.
- Lead with the user journey and desired decision object.
- Compose domains in TypeScript, not bash.
- Fetch first, summarize second. Never invent sources.
- Emit structured JSON for downstream steps.
- Secrets: runtime refs only, never plaintext.
