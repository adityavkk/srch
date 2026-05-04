---
name: search
description: "SDK-first local research tool. Prefer typed TypeScript via Bun; compose domains in one TS flow; CLI only for quick checks/fallback."
---

# search

Local-first research SDK + CLI.

## Default: TypeScript SDK via Bun

Primary path: run TypeScript, not bash pipelines. `createClient()` returns native typed objects, so agents can use `Promise.all`, branching, maps/filters, joins, ranking, and JSON output without parsing CLI text.

Shortest run form:

```bash
bun - <<'TS'
import { createClient } from "srch";
const c = createClient();
const r = await c.run({ domain: "web", query: "bun sqlite wasm", numResults: 5 });
console.log(JSON.stringify(r.kind === "success" ? r.evidence.map(e => e.payload.url) : r, null, 2));
TS
```

No `bunx`, `tsx`, flags, or `jq` needed. Bun runs TS directly. Use `.tmp/search.ts` + `bun .tmp/search.ts` for longer scripts.

Use CLI only for quick checks, diagnostics, or shell consumers.

## Sellable pattern: one user journey, many domains

Do not present `search` as a bag of tools. Show it as a typed workflow engine for retrieval-heavy decisions.

Example ask:

> Can I send someone from SFO to AWS re:Invent 2026? Verify official dates, price flights, and make a go/no-go recommendation.

Journey:

| Step | Domain | Result |
|---|---|---|
| 1 | `web` | find official event page |
| 2 | `fetch` | extract event facts from source page |
| 3 | `flights` | price route/date options |
| 4 | TypeScript | rank fares, emit decision brief |

Why this is compelling: separate tools require prompt glue, shell parsing, provider-specific schemas, and manual error handling. `srch` keeps everything as typed objects in one program.

Requires optional flights backend:

```bash
search install flights
```

Concise Bun sketch:

```bash
bun - <<'TS'
import { createClient, coreModule, defineConfig, flightsModule } from "srch";
const c = createClient({ config: defineConfig({ modules: [coreModule, flightsModule] }) });
const trip = { event: "AWS re:Invent 2026", origin: "SFO", destination: "LAS", depart: "2026-11-29", return: "2026-12-04" };

const web = await c.run({ domain: "web", query: `${trip.event} official dates venue airport`, numResults: 5 });
if (web.kind !== "success") throw new Error(web.kind === "error" ? web.error.message : web.suggestions[0]);
const official = web.evidence.find(e => /aws|amazon|reinvent/i.test(e.payload.url)) ?? web.evidence[0];

const [eventPage, flights] = await Promise.all([
  c.run({ domain: "fetch", query: official.payload.url }),
  c.run({ domain: "flights", query: `${trip.origin} ${trip.destination} ${trip.depart}`,
    options: { returnDate: trip.return, adults: 1, cabinClass: "M", maxStopovers: 1, sort: "price", limit: 5 } })
]);

const page = eventPage.kind === "success" ? eventPage.evidence[0].payload : null;
const fares = flights.kind === "success" ? flights.evidence.map(e => ({
  price: e.payload.offer.price,
  summary: e.payload.summary,
  bookingUrl: e.payload.offer.booking_url,
  score: e.payload.offer.price + e.payload.offer.outbound.stopovers * 150
})).sort((a, b) => a.score - b.score) : [];
const best = fares[0] ?? null;

console.log(JSON.stringify({
  ask: `Can I attend ${trip.event} from ${trip.origin}?`,
  verifiedEvent: { title: page?.title ?? official.payload.title, source: page?.url ?? official.payload.url, excerpt: page?.content.slice(0, 400) ?? official.payload.snippet },
  trip,
  flightShortlist: fares.slice(0, 3),
  recommendation: best ? `Go: official event found, route priced, best option is ${best.summary}.` : "Wait: no flight offer returned."
}, null, 2));
TS
```

Result shape to show users:

```json
{
  "ask": "Can I attend AWS re:Invent 2026 from SFO?",
  "verifiedEvent": {
    "title": "AWS re:Invent 2026  | Nov 30-Dec 4, 2026",
    "source": "https://aws.amazon.com/reinvent/",
    "excerpt": "Save the date\n\nNovember 30 - December 4, 2026 | Las Vegas, NV..."
  },
  "flightShortlist": [
    { "price": 499, "summary": "USD 499.00 | SFO -> LAS | economy | 9h00m | 0 stop(s)", "score": 499 }
  ],
  "recommendation": "Go: official event found, route priced..."
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
| Flights | `c.run({ domain: "flights", query: "SFO LAS 2026-11-29" })` | `search flights SFO LAS 2026-11-29 --json` |
| X/Twitter | `c.run({ domain: "social", query })` | `search twitter "bun runtime" --json` |
| Provider exactness | `c.search("exa", { query })` | `search web "q" --provider exa --json` |
| Diagnostics | CLI | `search inspect tools --json` |

## Agent rules

- Default to SDK + Bun for multi-step research.
- Lead with a user journey, not a wall of code.
- Use `bun - <<'TS'` for concise scratch scripts.
- Use `.tmp/search.ts` + `bun .tmp/search.ts` for longer scripts.
- Fetch first, summarize second. Do not invent sources.
- Keep stdout structured JSON if another step will consume it.
- Use CLI only for quick checks, diagnostics, or non-TS consumers.
- Secrets: runtime secret refs only, never plaintext.
