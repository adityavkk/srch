# srch architecture

`srch` is a programmable retrieval engine for developers and agents.

Design center:
- domain-first CLI
- sources as retrieval primitives
- strategies as retrieval programs
- static and agentic strategies as siblings
- manifest language and typed SDK as first-class authoring surfaces
- inspectable plans, runs, evidence, and traces

This document consolidates the current architecture, CLI taxonomy, and SDK/manifest proposal.

## Product thesis

`srch` should evolve from a local-first retrieval CLI into a programmable retrieval engine:
- stable CLI for direct use
- extensible retrieval runtime underneath
- declarative specs for composition and ops
- typed functional SDK for elegant programming
- optional agentic behavior inside strategies

Not goals:
- generic workflow engine
- generic multi-agent platform
- mandatory LLM planning for simple retrieval

## Core principles

### Explicit over magical

These should stay boring:

```bash
search web "query"
search code "query"
search code repo owner/repo "query"
search docs "query"
search fetch https://example.com
search ask "compare bun vs node for cli tooling"
```

### Domain-first grammar

```text
search <domain> [subdomain] [strategy] [target] <query-or-task>
```

Where:
- `domain` = retrieval space
- `subdomain` = optional narrower retrieval space
- `strategy` = named static or agentic retrieval program
- `target` = optional scope object
- `query-or-task` = user request

Examples:

```bash
search web "bun sqlite"
search code repo facebook/react "useEffect cleanup"
search flights LHR BCN 2026-06-15
search rewards-flights JFK CDG --date 2026-07-01 --cabin business
search social reddit "react compiler"
search social x thread https://x.com/.../status/123
search ask compare "best state management for a docs-heavy react app"
```

`ask` is not a special-case mode. It is a cross-domain retrieval domain.

### Declarative first

Common behavior should be configurable as data:
- source registration
- source selection
- fallback order
- strategy steps
- policies
- evaluators
- stop conditions

### Functional composition

The engine should compose like pipelines:

```text
query
  |> select sources
  |> run retrieval
  |> normalize evidence
  |> merge / rerank / filter
  |> fetch follow-up content
  |> synthesize (optional)
```

### Inspectability always

Every layer should be inspectable:
- catalog
- query
- plan
- run
- evidence
- trace

## Runtime nouns

### Public nouns
- domain
- subdomain
- source
- strategy
- policy
- evidence
- run

### Engine nouns
- query
- plan
- operator
- catalog

### Extension units
- module
- evaluator
- agent-adapter

## Layered model

```text
query/task
  -> domain/subdomain routing
  -> strategy selection
  -> plan compilation
  -> operators over sources
  -> run
  -> evidence
  -> optional synthesis
```

## Domains, subdomains, strategies

### Domains

Top-level retrieval spaces.

Examples:
- `web`
- `code`
- `docs`
- `flights`
- `rewards-flights`
- `social`
- `fetch`
- `ask`

`flights` is a provider-backed domain powered by the optional Fli Python SDK.

Current product posture for `flights`:
- `srch` owns research and fare discovery
- external booking channels own the checkout and post-booking workflow
- the Fli dependency stays optional so the base install remains lean

### Subdomains

Durable narrower retrieval spaces.

Examples:
- `social reddit`
- `social x`
- `social hn`
- `code github`
- `code local`
- `docs npm`

Subdomains should be durable retrieval spaces, not backend names.

Good:
- `reddit`
- `x`
- `hn`
- `github`
- `local`
- `npm`

Bad:
- `exa`
- `provider-a`
- `agent-a`
- `balanced`

### Strategies

Strategies are the unit of retrieval behavior.

Examples:
- `repo`
- `research`
- `verify`
- `investigate`
- `compare`
- `thread`
- `read`

Examples:

```bash
search web research "best auth for next.js"
search code repo facebook/react "useEffect cleanup"
search social x thread https://x.com/.../status/123
search ask compare "best state management for a docs-heavy react app"
```

## Static and agentic strategies

A strategy is a retrieval program over sources.

### Static strategy

Fixed recipe. Little or no runtime adaptation.

Examples:
- `web-default`
- `code-default`
- `repo-deep-search`
- `docs-default`

### Agentic strategy

Adaptive recipe with evaluation and revision.

Examples:
- `research-deep`
- `cross-verify`
- `code-investigate`
- `ask-compare`

Agentic should not mean “uses an LLM.”

Better definition:
- static = no runtime plan revision
- agentic = runtime plan revision allowed

Agentic strategies should still operate over `srch` plans/evidence and respect policies.

## Sources

A source is the narrowest useful retrieval primitive.

Examples:
- exa-mcp
- exa-context
- brave
- gemini-web
- gemini-api
- perplexity
- context7
- deepwiki
- qmd
- bird
- github-clone
- repo-local-search
- jina-reader
- readability
- pdf-extractor
- fli-sdk

Optional sources are valid when they unlock a distinct domain but would otherwise bloat the default install. The runtime should detect them explicitly and return actionable install hints instead of failing mysteriously.

Sources should do one thing well and not own the full plan.

## Manifest language

The manifest language is a first-class authoring surface.

It should support:
- domains
- subdomains
- sources
- strategies
- policies
- evaluators
- modules

Prefer YAML/JSON/TOML.

### Module manifest

```yaml
kind: srch.module
name: "@srch/core"
version: "0.1"

domains:
  - ref: web
  - ref: code
  - ref: docs
  - ref: social
  - ref: ask

sources:
  - ref: exa-mcp
  - ref: brave
  - ref: context7
  - ref: deepwiki

strategies:
  - ref: web-default
  - ref: code-default
  - ref: repo-deep-search
  - ref: ask-compare

policies:
  - ref: free-first
  - ref: balanced
  - ref: code-authoritative
```

### Domain manifest

```yaml
kind: srch.domain
name: code
description: Code retrieval across remote and local sources

subdomains:
  - github
  - local

defaultStrategy: code-default

strategies:
  - code-default
  - repo-deep-search
  - code-investigate
  - code-verify

accepts:
  query: true
  target: optional

capabilities:
  - code
  - repo
  - docs
```

### Ask domain manifest

```yaml
kind: srch.domain
name: ask
description: Cross-domain retrieval tasks

defaultStrategy: ask-default

strategies:
  - ask-default
  - ask-compare
  - ask-research
  - ask-verify

capabilities:
  - web
  - code
  - docs
  - social
```

### Subdomain manifest

```yaml
kind: srch.subdomain
name: reddit
domain: social
description: Reddit retrieval space

defaultStrategy: social-default

capabilities:
  - social
  - web

sources:
  - reddit-api
  - reddit-fetch
```

### Source manifest

```yaml
kind: srch.source
name: brave
description: Brave web search

capabilities:
  - web

traits:
  - fast
  - keyword

cost:
  tier: free
  budgetImpact: low

auth:
  type: secretRef
  fields:
    - braveApiKey

transport:
  type: http

inputs:
  query: string
  limit: number

outputs:
  evidence:
    kind: web_result
```

Traits matter because capabilities are not enough.

Useful traits:
- authoritative
- semantic
- keyword
- local
- remote
- code-native
- primary
- low-signal
- fast

### Static strategy manifest

```yaml
kind: srch.strategy
name: code-default
strategyType: static
domain: code
description: Primary code retrieval with secondary doc augmentation

inputs:
  query: string

steps:
  - op: search
    source: exa-context
    query: "{query}"
    as: primary

  - op: search
    source: context7
    query: "{query}"
    as: docs
    optional: true

  - op: search
    source: deepwiki
    query: "{query}"
    as: repoContext
    optional: true

  - op: merge
    from: [primary, docs, repoContext]
    as: merged

  - op: emit
    from: merged
```

### Agentic strategy manifest

```yaml
kind: srch.strategy
name: ask-compare
strategyType: agentic
domain: ask
description: Compare options across sources and synthesize recommendation

inputs:
  task: string

seed:
  strategy: web-default

policy: balanced

loop:
  maxSteps: 4

  evaluate:
    - kind: sourceDiversity
      minSources: 3
    - kind: evidenceCount
      minItems: 5
    - kind: disagreement
      action: verify

  revise:
    - if: insufficientPrimaryEvidence
      then:
        - op: fetchTopN
          n: 3
    - if: disagreementDetected
      then:
        - op: runStrategy
          strategy: web-verify
    - if: taskLooksCodeHeavy
      then:
        - op: runStrategy
          strategy: code-default

output:
  mode: answer
  citations: true
```

### Policy manifest

```yaml
kind: srch.policy
name: code-authoritative

selection:
  preferTraits:
    - authoritative
    - code-native
    - local
  avoidTraits:
    - low-signal
  allowPaid: false

execution:
  maxSteps: 4
  fetchTopN: 2
  requireSourceDiversity: 2

stopping:
  minEvidence: 4
  requirePrimaryEvidence: true

synthesis:
  citeSources: true
  answerStyle: concise
```

### Evaluator manifest

```yaml
kind: srch.evaluator
name: sufficiency-basic

input:
  - query
  - evidence

output:
  - sufficient
  - reason
  - nextAction

prompt: |
  Determine whether the evidence is sufficient to answer the query.
  Prefer authoritative and diverse sources.
```

## Typed functional SDK

The SDK is also a first-class authoring surface.

It should be:
- typed
- tiny
- composable
- pleasant to read
- data-first
- inspectable

The SDK is not just a manifest generator.
It is a native programming surface for `srch`.

### Core authoring API

```ts
defineSource(...)
defineStrategy(...)
defineDomain(...)
definePolicy(...)
defineModule(...)
defineEvaluator(...)
defineAgentAdapter(...)
```

### Core operator builders

```ts
search(...)
fetch(...)
merge(...)
rerank(...)
when(...)
emit(...)
runStrategy(...)
evaluate(...)
revise(...)
```

### Source example

```ts
import { defineSource } from "@srch/sdk";

export default defineSource({
  name: "reddit",
  capabilities: ["social", "web"],
  traits: ["community", "discussion"],
  cost: { tier: "free" },

  async run(req, ctx) {
    const results = await ctx.http.get("/reddit/search", { q: req.query });
    return ctx.evidence.webResults(
      results.items.map(item => ({
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        native: item
      }))
    );
  }
});
```

### Static strategy example

```ts
import { defineStrategy, search, merge, emit } from "@srch/sdk";

export default defineStrategy({
  name: "code-default",
  type: "static",
  domain: "code",
  input: ["query"],

  plan: [
    search("exa-context", { query: "$query" }).as("primary"),
    search("context7", { query: "$query" }).optional().as("docs"),
    search("deepwiki", { query: "$query" }).optional().as("repo"),
    merge("primary", "docs", "repo").as("merged"),
    emit("merged")
  ]
});
```

### Agentic strategy example

```ts
import {
  defineStrategy,
  runStrategy,
  fetchTopN,
  evaluate,
  stopIf,
  emitAnswer
} from "@srch/sdk";

export default defineStrategy({
  name: "ask-compare",
  type: "agentic",
  domain: "ask",
  policy: "balanced",

  seed: runStrategy("web-default", { query: "$task" }).as("initial"),

  loop: {
    maxSteps: 4,
    evaluate: evaluate("sufficiency-basic"),

    revise({ state, signals }) {
      if (signals.disagreementDetected) {
        return runStrategy("web-verify", { query: state.task });
      }
      if (signals.insufficientEvidence) {
        return fetchTopN("initial", 3);
      }
      if (signals.codeHeavy) {
        return runStrategy("code-default", { query: state.task });
      }
      return stopIf("sufficient");
    }
  },

  output: emitAnswer({ citations: true })
});
```

Desired shape:
- declarative shell
- elegant programmable hooks

### Domain example

```ts
import { defineDomain } from "@srch/sdk";

export default defineDomain({
  name: "social",
  subdomains: ["x", "reddit", "hn"],
  defaultStrategy: "social-default",
  strategies: ["social-default", "social-scan", "social-thread"],
  capabilities: ["social", "web"]
});
```

### Module example

```ts
import { defineModule } from "@srch/sdk";
import reddit from "./sources/reddit";
import social from "./domains/social";
import socialResearch from "./strategies/social-research";

export default defineModule({
  name: "@srch/reddit",
  sources: [reddit],
  domains: [social],
  strategies: [socialResearch]
});
```

## Consumer SDK

`srch` should also be usable as a library.

### Object form

```ts
import { createClient } from "@srch/sdk";

const srch = createClient();

const result = await srch.run({
  domain: "code",
  strategy: "repo",
  target: "facebook/react",
  query: "useEffect cleanup"
});
```

### Fluent form

```ts
import { createClient } from "@srch/sdk";

const srch = createClient();

const result = await srch
  .domain("code")
  .strategy("repo")
  .target("facebook/react")
  .query("useEffect cleanup")
  .run();
```

### Agentic fluent form

```ts
const answer = await srch
  .domain("ask")
  .strategy("compare")
  .task("best state management for a docs-heavy React app")
  .policy("balanced")
  .mode("answer")
  .run();
```

Keep plain object API even if fluent API exists.

## External agent SDK integration

Support external agent SDKs via a clean adapter boundary.

Targets may include:
- Claude SDK
- pi-mono / pi-coding-agent style SDKs
- other retrieval-specialized planners/evaluators

### Agent adapter interface

```ts
interface AgentAdapter {
  name: string;
  plan(task: AgentTask, ctx: AgentContext): Promise<AgentPlan>;
  evaluate(state: AgentState, ctx: AgentContext): Promise<Evaluation>;
  synthesize(state: AgentState, ctx: AgentContext): Promise<AgentOutput>;
}
```

### Agentic strategy using adapter

```ts
defineStrategy({
  name: "ask-claude-compare",
  type: "agentic",
  domain: "ask",
  agent: claudeAdapter({ model: "claude-sonnet-4" })
});
```

```ts
defineStrategy({
  name: "code-investigate-pi",
  type: "agentic",
  domain: "code",
  agent: piMonoAdapter({ model: "gemini-2.5-flash" }),
  policy: "code-authoritative"
});
```

The adapter should operate over `srch` plans/evidence, not replace the `srch` runtime model.

## Compilation model

Both manifests and SDK-authored objects should compile into the same internal graph:

```text
module
  -> catalog registration
  -> query model
  -> strategy compilation
  -> plan
  -> operators
  -> run
  -> evidence
```

That shared compilation model is what makes both first-class.

## Output architecture and persisted artifacts

A retrieval run should not write directly to stdout from the strategy or source layer.

Instead, the runtime should separate:
- execution
- normalization
- rendering
- sinks

Target shape:

```text
query/task
  -> plan
  -> run
  -> evidence
  -> result
  -> render
  -> sinks
```

Where:
- `result` = normalized command/run outcome
- `render` = transform result into human text or stable JSON envelope
- `sinks` = terminal, file artifact, history, later maybe db/http/clipboard

### Current CLI migration target

The current CLI has useful domain modules already, but `src/cli.ts` still mixes:
- routing
- execution
- formatting
- stdout/stderr writes
- history side effects

The next architecture step should introduce a normalized post-execution object at the CLI boundary.

Example shape:

```ts
interface CliSuccessResult {
  command: string[];
  kind: string;
  data: unknown;
  text: string;
}
```

This is intentionally simple:
- `data` preserves structured machine output
- `text` preserves concise human output
- `command` preserves stable envelope identity
- `kind` leaves room for history and artifact conventions

### Output emitters and sinks

The CLI should centralize output in a shared emitter layer.

Responsibilities:
- render JSON envelopes for `--json`
- render human text by default
- write to stdout/stderr
- persist artifacts when requested
- later fan out to additional sinks without touching domain logic

Near-term sink set:
- terminal sink
- file sink via `--out <path>`
- history sink

Longer-term sink set:
- artifact directory sink
- sqlite/db sink
- remote run sink
- clipboard sink

### Persisted artifact semantics

For the near term, `--out <path>` should persist the final rendered representation:
- with `--json`, save the exact stable JSON envelope
- without `--json`, save the exact human-readable text output

This keeps behavior boring and predictable:
- terminal output and file output match
- scripts can opt into JSON explicitly
- humans can save readable reports without extra format flags

Later, the engine may add separate concepts such as:
- rendered artifact output
- normalized run/evidence export
- trace export
- plan export

But the first step should stay simple.

### Why this matters for the engine

This output boundary is not just CLI cleanup. It is part of the programmable retrieval model.

A programmable retrieval engine should treat outputs as first-class runtime products:
- result
- evidence
- trace
- artifact

That means strategies and sources focus on retrieval, while emitters/sinks own delivery.

In practice this enables:
- reusable consumer SDK responses
- stable automation envelopes
- explicit persistence of search results to files
- future multi-sink execution without duplicating command logic

## Example value by layer

### Explicit deterministic retrieval

```bash
search web "bun sqlite wasm"
search code "react suspense cache"
search fetch https://clig.dev
```

Value:
- fast
- cheap
- stable
- scriptable

### Strategy-level retrieval

```bash
search web research "best auth patterns for next.js"
search code repo . "auth middleware"
```

Value:
- less manual orchestration
- richer evidence gathering
- still inspectable

### Agentic retrieval

```bash
search ask compare "best state management approach for a docs-heavy react app"
```

Value:
- adaptive retrieval behavior
- strategy revision when evidence is weak
- evidence-backed synthesis

### SDK-level embedding

```ts
const result = await srch.run({
  domain: "code",
  strategy: "repo",
  target: ".",
  query: "database connection"
});
```

Value:
- use `srch` as substrate inside another tool or agent

## Recommended implementation phases

### Phase 1
- source registry
- strategy registry
- module loading
- static strategy execution
- stable evidence/run schema

### Phase 2
- domain/subdomain registry
- policy system
- manifest validation
- plan inspection / dry-run

### Phase 3
- agentic strategies
- evaluators
- plan revision loop
- external agent adapters

### Phase 4
- richer consumer SDK
- package ecosystem
- registry/discovery story

## Recommendation

Treat both surfaces as native:
- manifest language for portability, config, validation, sharing, and ops
- typed functional SDK for elegance, abstraction, and custom logic

The heart of the system should be:

> strategies compile into plans made of operators

From that:
- declarative strategies are data specs
- programmable strategies emit or revise plans
- agentic strategies are strategies with evaluation/revision loops
- sources are execution targets for operators

That is the cleanest path to an elegant, extensible, first-class programmable retrieval engine.
