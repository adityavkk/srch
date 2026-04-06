# srch architecture

`ssearch` today is a local-first retrieval CLI.

`ssearch` tomorrow can become an extensible, agentic retrieval harness:
- stable CLI surface
- declarative source + strategy composition
- optional agentic planning layer
- strong defaults
- unix-like pipes, narrow commands, inspectable intermediate results

This doc proposes the concrete direction.

## Goals

- keep `search` usable as a simple CLI
- make retrieval backends pluggable
- make search behavior declarative and inspectable
- support both deterministic and agentic workflows
- preserve low-token defaults and stable JSON
- follow unix philosophy:
  - small composable parts
  - text/json in, text/json out
  - explicit modes
  - inspectable traces

## Non-goals

- replace general coding agents
- bury simple commands under mandatory LLM planning
- force a giant framework onto plugin authors

## Design principles

### 1. Explicit over magical

These should continue to work and stay boring:

```bash
search web "query"
search code "query"
search code repo owner/repo "query"
search docs "query"
search fetch https://example.com
```

Agentic behavior should be additive, not mandatory.

### 2. Declarative first

Sources, fallback order, strategy steps, prompts, and thresholds should be configurable as data.

### 3. Functional composition

Sources and strategies should compose like pure transforms where possible:
- query -> source results
- source results -> fetched content
- fetched content -> ranked evidence
- evidence -> synthesis

### 4. Preserve native payloads

Every adapter normalizes output, but the native provider payload remains available under `native`.

### 5. Free-first by default

Default plans should prefer free or already-paid-for paths before premium paths.

## Layered model

srch should expose 4 layers.

```text
query/task
  -> agent layer (optional planner)
  -> strategy layer (recipes/pipelines)
  -> source layer (providers/connectors)
  -> transport layer (HTTP, MCP, CLI, local fs, clone, sqlite, browser cookies)
```

## Layer 1: source plugins

A source is the smallest useful retrieval primitive.

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
- jina-reader
- readability
- pdf-extractor

### Source interface

```ts
export type SourceCapability =
  | "web"
  | "code"
  | "repo"
  | "docs"
  | "social"
  | "fetch"
  | "pdf";

export type CostTier = "free" | "credits" | "paid";

export interface SourceRequest {
  capability: SourceCapability;
  query?: string;
  target?: string;
  urls?: string[];
  limit?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  options?: Record<string, unknown>;
}

export interface SourceResult<TNative = unknown> {
  source: string;
  capability: SourceCapability;
  ok: boolean;
  text?: string;
  items?: unknown[];
  native?: TNative;
  costTier: CostTier;
  latencyMs?: number;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface SourcePlugin {
  name: string;
  description: string;
  capabilities: SourceCapability[];
  costTier: CostTier;
  priority?: number;
  isAvailable(ctx: RuntimeContext): Promise<boolean>;
  run(req: SourceRequest, ctx: RuntimeContext): Promise<SourceResult>;
}
```

### Why sources stay narrow

A source should answer one question well:
- “search the web”
- “query versioned library docs”
- “search inside local repo clone”
- “fetch readable page content”

It should not decide the full search plan.

## Layer 2: strategy plugins

A strategy is a recipe for combining sources.

Examples:
- `web-default`
- `web-high-quality`
- `code-default`
- `repo-deep-search`
- `docs-default`
- `research-deep`
- `cross-verify`
- `social-scan`

### Strategy interface

```ts
export interface StrategyInput {
  query?: string;
  target?: string;
  args?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface StrategyStepResult {
  name: string;
  result: SourceResult | StrategyResult;
}

export interface StrategyResult<TNative = unknown> {
  strategy: string;
  ok: boolean;
  text?: string;
  items?: unknown[];
  steps: StrategyStepResult[];
  native?: TNative;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface StrategyPlugin {
  name: string;
  description: string;
  capabilities: string[];
  run(input: StrategyInput, ctx: StrategyContext): Promise<StrategyResult>;
}
```

### Strategy context

```ts
export interface StrategyContext {
  source(name: string, req: SourceRequest): Promise<SourceResult>;
  sourcesByCapability(capability: SourceCapability): SourcePlugin[];
  choose(req: SourceRequest, policy?: SelectionPolicy): Promise<SourcePlugin[]>;
  fetch(url: string): Promise<SourceResult>;
  fetchMany(urls: string[]): Promise<SourceResult[]>;
  merge(results: Array<SourceResult | StrategyResult>): StrategyResult;
  trace: TraceSink;
  config: SrxhConfig;
  llm?: LlmFacade;
}
```

## Declarative strategies

Strategies should be expressible as data first.

### Example: web default

```json
{
  "name": "web-default",
  "capability": "web",
  "select": {
    "order": ["exa-mcp", "brave", "gemini-web", "gemini-api", "perplexity"],
    "stopOnFirstSuccess": true
  },
  "steps": [
    {
      "type": "search",
      "capability": "web",
      "query": "{query}",
      "limit": 5
    }
  ]
}
```

### Example: code default

```json
{
  "name": "code-default",
  "capability": "code",
  "steps": [
    {
      "type": "search",
      "source": "exa-context",
      "query": "{query}",
      "maxTokens": 5000,
      "required": false
    },
    {
      "type": "search",
      "source": "context7",
      "query": "{query}",
      "mode": "secondary",
      "required": false
    },
    {
      "type": "search",
      "source": "deepwiki",
      "query": "{query}",
      "mode": "secondary",
      "required": false,
      "when": "repoRefPresent"
    }
  ],
  "combine": {
    "appendSecondary": true
  }
}
```

### Example: repo deep search

```json
{
  "name": "repo-deep-search",
  "capability": "repo",
  "steps": [
    {
      "type": "prepare",
      "source": "github-clone",
      "target": "{target}"
    },
    {
      "type": "search",
      "source": "repo-local-search",
      "target": "{prepared.localPath}",
      "query": "{query}"
    }
  ]
}
```

## Declarative core + imperative escape hatch

Data should cover 80% of use cases.

When a strategy needs dynamic logic, it can provide a custom reducer or planner:

```ts
export interface DeclarativeStrategyPlugin extends StrategyPlugin {
  spec?: StrategySpec;
  customize?: (input: StrategyInput, ctx: StrategyContext, partial: StrategyResult) => Promise<StrategyResult>;
}
```

This keeps the happy path elegant while preserving power.

## Layer 3: agent layer

This is optional.

The agent layer should sit on top of strategies, not raw sources.

### Why

- sources are too low-level for planning
- strategies encode domain knowledge
- agents should choose among good recipes, not reinvent them every run

### Agent interface

```ts
export interface AgentTask {
  prompt: string;
  objective?: string;
  constraints?: string[];
  maxSteps?: number;
}

export interface AgentResult {
  ok: boolean;
  answer: string;
  plan: PlanStep[];
  evidence: Array<SourceResult | StrategyResult>;
  error?: string;
}
```

### CLI shape

```bash
search ask "Find the best React state management approach for a docs-heavy app"
search ask "Compare Bun vs Node startup/runtime tradeoffs and cite sources" --json
search ask "How does React implement Suspense caching internally?" --verbose
```

### Agent execution model

1. classify task
2. choose strategy or compose one
3. execute strategy steps
4. evaluate if evidence is sufficient
5. if not sufficient, refine query / widen source set / fetch more
6. synthesize answer

This yields agentic retrieval without losing inspectability.

## Layer 4: transport adapters

Keep transport concerns separate from retrieval semantics.

Examples:
- HTTP REST
- MCP over Streamable HTTP
- local CLI subprocess
- browser cookie extraction
- local clone / filesystem traversal
- sqlite/local index

This prevents source plugins from coupling search semantics to transport details.

## Runtime config

```json
{
  "plugins": [
    "@srch/context7",
    "@srch/deepwiki",
    "@srch/reddit"
  ],
  "sources": {
    "exa-mcp": { "enabled": true, "priority": 1 },
    "brave": { "enabled": true, "priority": 2 },
    "gemini-web": { "enabled": true, "priority": 3 },
    "gemini-api": { "enabled": true, "priority": 4 },
    "perplexity": { "enabled": true, "priority": 5 }
  },
  "strategies": {
    "web-default": { "enabled": true },
    "code-default": { "enabled": true },
    "repo-deep-search": { "enabled": true },
    "research-deep": { "enabled": false }
  },
  "agent": {
    "enabled": true,
    "model": "gemini-2.5-flash",
    "maxSteps": 4,
    "systemPrompt": "You are a retrieval specialist..."
  }
}
```

## Functional composition model

Think in pipelines:

```text
query
  |> select sources
  |> run retrieval
  |> normalize results
  |> merge evidence
  |> rank/filter
  |> fetch follow-up content
  |> synthesize (optional)
```

### Useful combinators

```ts
select(capability, policy)
mapResults(fn)
filterResults(fn)
mergeResults(policy)
fetchTopN(n)
rerank(model)
appendSecondary()
summarize(prompt)
```

This keeps the engine elegant while preserving power.

## Unix philosophy mapping

### Do one thing well

Each source plugin does one thing well.
Each strategy does one recipe well.
The agent layer plans, but does not replace the lower layers.

### Text streams and JSON

- human mode: concise text
- automation mode: stable JSON
- verbose mode: stderr traces

### Inspect intermediate artifacts

- source results visible in JSON
- strategy steps visible in JSON
- traces visible in `--verbose`
- native payloads preserved

### Pipeability

```bash
search web "react compiler" --json | jq '.data.results[] | .url'
search code repo . "auth middleware" --json | jq '.data.matches[]'
```

## Example plugin shapes

### Source plugin example: Reddit

```ts
export default defineSource({
  name: "reddit",
  capabilities: ["social", "web"],
  costTier: "free",
  async isAvailable() { return true; },
  async run(req, ctx) {
    // fetch reddit search
    return {
      source: "reddit",
      capability: "social",
      ok: true,
      items: [...],
      native: {...},
      costTier: "free"
    };
  }
});
```

### Strategy plugin example: cross verification

```ts
export default defineStrategy({
  name: "cross-verify",
  description: "Compare multiple sources and surface disagreements",
  capabilities: ["research"],
  async run(input, ctx) {
    const [web, social, docs] = await Promise.all([
      ctx.source("exa-mcp", { capability: "web", query: input.query }),
      ctx.source("reddit", { capability: "social", query: input.query }),
      ctx.source("qmd", { capability: "docs", query: input.query })
    ]);
    return ctx.merge([web, social, docs]);
  }
});
```

## Example user value

### 1. explicit, deterministic

```bash
search web "bun sqlite wasm"
search code "react suspense cache"
search fetch https://clig.dev
```

Value:
- fast
- cheap
- stable
- composable in scripts

### 2. strategy-level

```bash
search research "best auth patterns for next.js app router"
search verify "does bun support sqlite in wasm in production"
```

Value:
- richer retrieval
- less manual orchestration
- still inspectable

### 3. deep code understanding

```bash
search code repo facebook/react "useEffect cleanup"
search code repo . "database connection"
```

Value:
- actual code, not summaries about code
- clone/cache/local deep search
- better grounding for agent work

### 4. agentic search

```bash
search ask "What is the best state management approach for a docs-heavy React app and why?"
```

Value:
- strategy selection delegated to specialist harness
- iterative retrieval under the hood
- final synthesis with evidence

## Why this architecture is worth it

This gives srch:
- explicit commands for power users
- declarative strategies for maintainability
- plugin extensibility for new sources
- agentic planning for higher-order problems
- a clean path to become a reusable search substrate for pi, claude, opencode, and others

## Suggested implementation phases

### Phase 1: source registry
- define source interface
- adapt current backends into source modules
- add runtime source discovery

### Phase 2: strategy registry
- define declarative strategy spec
- move current `web`, `code`, `repo`, `fetch` behaviors into named strategies
- preserve current CLI surface

### Phase 3: plugin loading
- npm/local plugin discovery
- config-driven enable/disable
- source + strategy registration

### Phase 4: agent mode
- add `search ask`
- planner chooses or composes strategies
- evidence-first synthesis

### Phase 5: adapters
- thin pi extension
- optional MCP server for srch itself

## Recommendation

Use a hybrid model:
- declarative specs for defaults and common cases
- imperative hooks for hard cases
- stable CLI on top
- agent layer last

That keeps srch elegant, hackable, and unix-like while still enabling the long-term vision:

**srch as the extensible agentic retrieval harness that combines the best retrieval and RAG techniques with agentic exploration over them.**
