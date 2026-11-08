---
name: search
description: "Researches web, code, documents and flight prices through srch. Use for source retrieval, travel fare comparisons, and search-backend diagnostics. Prefers the typed TypeScript SDK for workflows; CLI for one-off checks or explicit CLI requests."
---

# search

Use `srch` as a TypeScript SDK first. Treat the CLI as a fallback.

## Decision rule

- Multi-step research, ranking, branching, joins, retries, or reusable output: **SDK**.
- One-off human check, diagnostics, shell-only consumer, or explicit user request for the CLI: **CLI**.
- Flights: start with this tool, not browser automation. Read [flight workflow and limitations](../docs/travel.md) before pricing; use browser/airline handoff when the exact party cannot be priced.
- Avoid CLI/MCP sprawl: no `search ... --json | jq ...` when TS can keep typed objects.

## SDK bootstrap

`search` on `$PATH` does not prove `import "srch"` resolves to this project. Verify provenance and the `createClient` export, not merely import success. An unrelated cached package can share the name.

On this machine, use the same built checkout as the CLI:

```bash
bun - <<'TS'
const sdkPath = `${process.env.HOME}/dev/search-tool/dist/sdk.js`;
const sdk = await import(sdkPath);
if (typeof sdk.createClient !== "function") throw new Error("Expected srch.createClient export");
console.log("Verified srch SDK exports");
TS
```

Elsewhere, use a verified project-local dependency from `github:adityavkk/srch`. Do not silently mutate a project's dependencies. If installation is needed, request permission or use an approved isolated `.tmp/srch-run/`; preserve the intended working directory before `createClient()`.

## Run pattern

Verify the SDK first and use that same module path throughout. Bun runs TypeScript directly. No `bunx`, `tsx`, or `jq` needed. If Bun reports an unsupported Node builtin, verify runtime compatibility and use the supported Node entry point; do not rewrite the provider to fix an import failure.

```bash
bun - <<'TS'
const { createClient } = await import(`${process.env.HOME}/dev/search-tool/dist/sdk.js`);
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

## Diagnostic discipline

- Separate installation, import, transport, parsing, and genuine empty-result failures. HTTP 200 and exit 0 do not prove a successful search.
- Unexpected emptiness: run a simple live control on a common route with a future date, one adult and economy. Airport lookup only tests bundled data. Stop blind retries after three failures; inspect the failing layer.
- Before declaring an upstream broken or proposing a replacement, compare the installed version, package-registry release, GitHub releases, current source, and merged fixes. Read how an issue was closed, not just its older comments.
- Prefer an existing upstream fix. Test an immutable revision in isolation, then use the tool's managed installer. Do not replace its pin with an unqualified package install.
- Verify the installed CLI and the SDK path used by the task. Mock tests do not prove live retrieval. Report exactly what passed and what remains blocked.

## Flight quote safeguards

- Preserve dates, airports, cabin, stop limits, currency and the exact adult/child/lap-infant mix. Never silently substitute adults or omit infant charges.
- Inspect `status`, `warnings`, and `unpriced_itineraries`, not only `offers.length`. SDK `flight_pricing_unavailable` is not an empty availability result. Open `search_url` for the exact-party handoff.
- Distinguish departure-list leads, selected round-trip discovery totals, displayed booking offers, and checkout-confirmed prices. A generated `booking_url` is not booking verification.
- Use the selected return-row total, not the outbound minimum; do not add the two prices. Verify return direction and dates. No selected return price means no complete quote.
- Record observation time, passenger basis, currency, source link and verification stage. `--top-n` limits search breadth; say "lowest returned," not "cheapest available." Never relabel an old quote as current.

## Agent rules

- SDK is default interface for agent work.
- Lead with the user journey and desired decision object.
- Compose domains in TypeScript, not bash.
- Fetch first, summarize second. Never invent sources.
- Emit structured JSON for downstream steps.
- Secrets: runtime refs only, never plaintext.
