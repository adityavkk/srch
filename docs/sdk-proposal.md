# SDK and manifest proposal

`srch` should make both of these first-class:
- a declarative manifest language
- a typed, functional programming SDK

Neither is enough alone.

If `srch` only has manifests:
- easy to inspect
- easy to share
- awkward at the edges

If `srch` only has code:
- powerful
- elegant for experts
- harder to inspect, validate, diff, and compose declaratively

The right model is:

> declarative core model + elegant programmable facade

## Goal

Make `srch` feel like:
- SQL/dbt/Terraform for retrieval configuration
- a modern typed TypeScript SDK for retrieval programming
- unix tools for inspectability and composability

## Design principles

### 1. Both layers first-class

The manifest language is not a toy wrapper around the SDK.
The SDK is not a clumsy escape hatch for the manifest language.

Both should be native authoring surfaces.

### 2. Same runtime model underneath

Whether authored via manifest or SDK, everything should compile into the same internal model:
- catalog
- query
- plan
- operators
- run
- evidence

### 3. Strategy as the center

Sources are the primitive retrievers.
Strategies are the unit of retrieval behavior.

Strategies may be:
- static
- agentic

### 4. Data-first, code-second

Common behavior should be declarative.
Complex behavior should have elegant code hooks.

### 5. Inspectability always

Every source, strategy, policy, evaluator, and domain should be inspectable, serializable, and explainable.

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

## First-class layer 1: manifest language

The manifest language should support:
- domains
- subdomains
- sources
- strategies
- policies
- evaluators
- modules

Prefer YAML/JSON/TOML. YAML examples below for readability.

## Top-level module manifest

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

A module is the unit of packaging and registration.
A module can contribute one or more domains, subdomains, sources, strategies, policies, and evaluators.

## Domain manifest

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

## Cross-domain `ask` domain manifest

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

This keeps `ask` structurally normal.

## Subdomain manifest

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

```yaml
kind: srch.subdomain
name: github
domain: code
description: GitHub-backed code retrieval

strategies:
  - repo-deep-search
  - repo-investigate

sources:
  - github-clone
  - repo-local-search
  - deepwiki
```

## Source manifest

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

```yaml
kind: srch.source
name: context7
description: Versioned library docs context

capabilities:
  - code
  - docs

traits:
  - authoritative
  - library-specific

transport:
  type: mcp
```

### Why traits matter

Capabilities are not enough.
Policies and planners also need higher-order selectors like:
- authoritative
- semantic
- keyword
- local
- remote
- code-native
- primary
- low-signal
- fast

## Static strategy manifest

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

## Static repo strategy manifest

```yaml
kind: srch.strategy
name: repo-deep-search
strategyType: static
domain: code
subdomain: github

inputs:
  target: string
  query: string

steps:
  - op: prepareRepo
    target: "{target}"
    as: repo

  - op: searchRepo
    repo: "{repo.localPath}"
    query: "{query}"
    as: matches

  - op: emit
    from: matches
```

## Agentic strategy manifest

Agentic strategies should still be declarative at the edges.

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

## Policy manifest

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

## Evaluator manifest

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

Evaluators may be backed by:
- simple rules
- LLMs
- hybrid logic

Do not bake provider identity into the noun.

## First-class layer 2: typed functional SDK

The SDK should be:
- typed
- tiny
- composable
- data-first
- pleasant to read
- easy to inspect

The SDK is not just a manifest generator.
It is a native programming surface for `srch`.

## Core authoring API

```ts
defineSource(...)
defineStrategy(...)
defineDomain(...)
definePolicy(...)
defineModule(...)
defineEvaluator(...)
defineAgentAdapter(...)
```

## Core operator builders

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

## Source example

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

## Static strategy example

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

## Agentic strategy example

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

This is the desired hybrid:
- declarative shell
- elegant programmable hooks

## Domain example

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

## Module example

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

`srch` should also be usable as a library, not just an extension host.

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

Fluent APIs should not be the only API. Always keep the plain object form.

## External agent SDK integration

`srch` should support external agent SDKs via a clean adapter boundary.

Targets may include:
- Claude SDK
- pi-mono / pi-coding-agent style SDKs
- other retrieval-specialized planners/evaluators

## Agent adapter interface

```ts
interface AgentAdapter {
  name: string;
  plan(task: AgentTask, ctx: AgentContext): Promise<AgentPlan>;
  evaluate(state: AgentState, ctx: AgentContext): Promise<Evaluation>;
  synthesize(state: AgentState, ctx: AgentContext): Promise<AgentOutput>;
}
```

## Agentic strategy using adapter

```ts
defineStrategy({
  name: "ask-claude-compare",
  type: "agentic",
  domain: "ask",
  agent: claudeAdapter({
    model: "claude-sonnet-4"
  })
});
```

```ts
defineStrategy({
  name: "code-investigate-pi",
  type: "agentic",
  domain: "code",
  agent: piMonoAdapter({
    model: "gemini-2.5-flash"
  }),
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

This shared compilation model is what makes both first-class.

## Recommendation: v1 scope

Do not build the full cathedral first.

### v1 manifest
- source
- strategy
- policy
- module

### v1 SDK
- `defineSource`
- `defineStrategy`
- `definePolicy`
- `defineModule`
- operators:
  - `search`
  - `merge`
  - `emit`
  - maybe `fetch`

### v1 runtime
- load modules
- register catalog
- execute static strategies
- emit evidence + run metadata

### v2
- domains and subdomains
- agentic strategies
- evaluators
- agent adapters
- richer consumer client

## Final recommendation

Treat both surfaces as native:
- manifest language for portability, config, validation, sharing, and ops
- SDK for authoring elegance, abstraction, and custom logic

The heart of the system should be:

> strategies compile into plans made of operators

From that:
- declarative strategies are data specs
- programmable strategies emit or revise plans
- agentic strategies are strategies with evaluation/revision loops
- sources are the execution targets for operators

That is the cleanest path to an elegant, extensible, first-class programmable retrieval engine.
