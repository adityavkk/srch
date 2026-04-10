# srch SDK-first redesign

## Summary

Redesign srch as a TypeScript SDK first -- a typed retrieval library that codeact agents import and program against. The domain model (sources, strategies, evidence, domains) is expressed through TypeScript types. Config is code. The CLI is a thin frontend adopting AXI ergonomic principles. The SDK surface IS the agent interface.

Core thesis: domain-boundary artifacts (typed SDK with rich semantics) outperform flat tool lists (MCP-style) for agent retrieval tasks.

## Implementation Status

- [x] Slice 1 -- core types + Source interface + exa tracer bullet
- [ ] Slice 2 -- strategy interface + web-default strategy + empty state handling
- [ ] Slice 3 -- domain + module + config-is-code
- [ ] Slice 4 -- CLI as thin frontend + AXI ergonomics
- [ ] Slice 5 -- flights + rewards-flights domains
- [ ] Slice 6 -- session hooks (generic adapter system)
- [ ] Slice 7 -- agent harness interface

## Domain Model

### Nouns (Types)

Design constraint: make illegal states unrepresentable. Prefer discriminated unions
over optional fields. If two fields are correlated, encode the correlation in the type.

```ts
// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

// Universal retrieval result. Domain-specific via generic payload.
// All fields required -- if you have evidence, you know where it came from.
type Evidence<T = unknown> = {
  source: string;
  domain: string;
  query: string;
  provenance: Provenance;
  payload: T;
};

// Provenance is a discriminated union -- different origins have different
// required fields. No optional grab-bag.
type Provenance =
  | { kind: "web";   url: string;  transport: string; timestamp: number; cached: boolean }
  | { kind: "api";   api: string;  transport: string; timestamp: number; cached: boolean }
  | { kind: "local"; path: string; timestamp: number }
  | { kind: "clone"; repo: string; localPath: string; timestamp: number; cached: boolean };

// ---------------------------------------------------------------------------
// RunResult -- discriminated union, not boolean flag
// ---------------------------------------------------------------------------

// Success: at least one evidence item. Suggestions optional.
type RunSuccess = {
  kind: "success";
  domain: string;
  strategy: string;
  evidence: [Evidence, ...Evidence[]];   // non-empty tuple
  summary: RunSummary;
  trace: TraceEvent[];
  suggestions?: string[];
};

// Empty: zero results. Suggestions required (agent needs guidance).
type RunEmpty = {
  kind: "empty";
  domain: string;
  strategy: string;
  summary: RunSummary;
  trace: TraceEvent[];
  suggestions: [string, ...string[]];    // non-empty, required
};

// Error: strategy-level failure. Suggestions required.
type RunError = {
  kind: "error";
  domain: string;
  strategy: string;
  error: { message: string; code: string };
  trace: TraceEvent[];
  suggestions: [string, ...string[]];
};

type RunResult = RunSuccess | RunEmpty | RunError;

// Pre-computed aggregates. Each provider attempt is fully typed --
// no "providersFailed: number" + "failedProviders?: string[]" mismatch.
type RunSummary = {
  totalEvidence: number;
  sourceBreakdown: Record<string, number>;
  attempts: [ProviderAttempt, ...ProviderAttempt[]]; // non-empty, at least one attempt
  durationMs: number;
};

type ProviderAttempt =
  | { provider: string; status: "success"; transport: string; durationMs: number; evidenceCount: number }
  | { provider: string; status: "skipped"; reason: string }
  | { provider: string; status: "failed";  error: string; durationMs: number };

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

// A retrieval primitive. One concern, possibly multiple transports.
// Capabilities and transports are non-empty -- a source without
// capabilities or transports is incoherent.
type Source<
  TRequest extends SourceRequest = SourceRequest,
  TPayload = unknown
> = {
  name: string;
  domain: string;
  capabilities: [string, ...string[]];   // non-empty
  traits: string[];                       // can be empty (no special traits)
  transports: [string, ...string[]];      // non-empty, at least one
  run: (req: TRequest, ctx: SourceContext) => Promise<Evidence<TPayload>[]>;
};

type SourceRequest = {
  query: string;
  signal?: AbortSignal;
};

// Source-specific options ride on typed request extensions, not Record escape hatches.
// Example: ExaSourceRequest = SourceRequest & { mode: "mcp" | "api"; numResults?: number }.

type SourceContext = {
  secrets: SecretResolver;
  trace: TraceSink;
  http: HttpClient;
};

// ---------------------------------------------------------------------------
// Strategy -- discriminated union
// ---------------------------------------------------------------------------

type StaticStrategy = {
  kind: "static";
  name: string;
  domain: string;
  run: (req: StrategyRequest, ctx: StrategyContext) => Promise<RunResult>;
};

type AgenticStrategy = {
  kind: "agentic";
  name: string;
  domain: string;
  adapter: string;           // which agent adapter to use (e.g. "pi-mono")
  run: (req: StrategyRequest, ctx: AgenticStrategyContext) => Promise<RunResult>;
};

type Strategy = StaticStrategy | AgenticStrategy;

type StrategyRequest = {
  query: string;
  target?: string;           // optional: only some domains use target (code repo, etc.)
  signal?: AbortSignal;
};
// target is optional here because it's domain-dependent.
// Strategies that require target validate at the top of run() and
// return RunError if missing -- not a silent empty result.

type StrategyContext = SourceContext & {
  sources: SourceRegistry;
  strategies: StrategyRegistry;
  search: (source: string, req: SourceRequest) => Promise<Evidence[]>;
  fetch: (url: string) => Promise<Evidence[]>;
  merge: (...results: Evidence[][]) => Evidence[];
};

type AgenticStrategyContext = StrategyContext & {
  agent: AgentAdapter;
};

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

// A retrieval space. All required fields -- a domain without strategies
// or sources is not a domain.
type Domain = {
  name: string;
  defaultStrategy: string;
  strategies: [string, ...string[]];     // non-empty
  sources: [string, ...string[]];        // non-empty
  capabilities: [string, ...string[]];   // non-empty
  subdomains: string[];                  // can be empty (no subdomains)
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

// A distributable bundle. Must provide at least one thing.
// Enforced: sources.length + strategies.length + domains.length > 0
// at defineModule() call time (runtime validation, not type-level,
// because TS can't express "at least one non-empty array among three").
type Module = {
  name: string;
  sources: Source[];       // required array, can be empty if strategies/domains provided
  strategies: Strategy[];  // required array, can be empty
  domains: Domain[];       // required array, can be empty
};
// Invariant enforced by defineModule(): at least one array is non-empty.

// ---------------------------------------------------------------------------
// SrchClient
// ---------------------------------------------------------------------------

type SrchClient = {
  run: (req: RunRequest) => Promise<RunResult>;
  search: (source: string, req: SourceRequest) => Promise<Evidence[]>;
  fetch: (url: string) => Promise<Evidence[]>;
  merge: (...results: Evidence[][]) => Evidence[];
  status: () => Promise<SrchStatus>;
  registry: {
    sources: SourceRegistry;
    strategies: StrategyRegistry;
    domains: DomainRegistry;
  };
};

type RunRequest = {
  domain: string;
  query: string;
  subdomain?: string;      // optional: not all domains have subdomains
  strategy?: string;        // optional: falls back to domain default
  target?: string;          // optional: only for target-aware domains (code repo, etc.)
  signal?: AbortSignal;
};
// RunRequest keeps optional fields because different domains need
// different subsets. Validation happens in the strategy, not the request
// type -- the strategy returns RunError with suggestions if required
// fields are missing.

// ---------------------------------------------------------------------------
// SrchStatus (ambient context)
// ---------------------------------------------------------------------------

type SourceHealth =
  | { name: string; status: "healthy" }
  | { name: string; status: "unavailable"; reason: string };

type SrchStatus = {
  domains: [string, ...string[]];        // non-empty (always have at least web)
  sources: SourceHealth[];
  summary: { healthy: number; total: number };
  recentRuns: RecentRun[];               // empty array if no history, not undefined
};

type RecentRun = {
  domain: string;
  query: string;
  ago: string;
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Config is intentionally permissive -- empty config is valid (use defaults).
// This is the only place where "all optional" is correct: config is additive.
type SrchConfig = {
  sources?: Source[];
  strategies?: Strategy[];
  domains?: Domain[];
  modules?: Module[];
  secrets?: SecretConfig;
  defaults?: {
    domain?: string;
    strategy?: string;
  };
};

// ---------------------------------------------------------------------------
// Hook system
// ---------------------------------------------------------------------------

// Built-in adapter names are literal. Extension adapters use string.
type BuiltinHookAdapter = "claude" | "codex" | "pi";

type HookAdapter = {
  name: BuiltinHookAdapter | (string & {});  // autocomplete built-ins, allow custom
  detect: () => boolean;
  install: (config: HookInstallConfig) => void;
  uninstall: (marker: string) => void;
  isInstalled: (marker: string) => boolean;
};

type HookInstallConfig = {
  marker: string;
  execPath: string;
  timeoutSeconds: number;   // required, no silent default
};
```

### Verbs (Operations)

```ts
// Authoring API -- used by source/strategy authors and agents
defineSource(spec: SourceSpec): Source
defineStrategy(spec: StaticStrategySpec | AgenticStrategySpec): Strategy
defineDomain(spec: DomainSpec): Domain
defineModule(spec: ModuleSpec): Module  // throws if all arrays empty
defineConfig(spec: SrchConfig): SrchConfig

// Consumer API -- used by agents writing codeact
createClient(config?: SrchConfig): SrchClient
client.run(req: RunRequest): Promise<RunResult>     // returns RunSuccess | RunEmpty | RunError
client.search(source, req): Promise<Evidence[]>
client.fetch(url): Promise<Evidence[]>
client.merge(...results): Evidence[]
client.status(): Promise<SrchStatus>

// Operator helpers -- used inside strategies
// These return RunResult, not raw Evidence[], so empty states propagate.
search(source, req): Promise<Evidence[]>
fetch(url): Promise<Evidence[]>
merge(...results): Evidence[]
dedupe(results): Evidence[]
sort(results, comparator): Evidence[]
filter(results, predicate): Evidence[]

// Hook system
installHooks(adapters?: HookAdapter[]): void   // auto-detect + register
uninstallHooks(marker: string): void
```

### Boundaries

**SDK boundary (`@srch/sdk`)**: public API. Types, defineX functions, createClient, operator helpers. This is what agents import.

**Source packages (`@srch/source-exa`, `@srch/source-brave`, etc.)**: each exports a Source via defineSource. Installed as npm deps. v1 ships all sources in the core package.

**CLI boundary (`@srch/cli` or `search` bin)**: imports createClient, parses args, calls client.run(), renders output following AXI principles. Zero retrieval logic.

**Agent harness boundary**: the agent runtime (pi-mono, etc.) generates TypeScript that imports `@srch/sdk`. srch executes it. Harness is pluggable.

**Config boundary**: `srch.config.ts` exports a SrchConfig. Loaded at startup. Optional JSON subset for sharing (no custom run() functions).

**Hook boundary**: generic HookAdapter interface. Adapters for Claude Code, Codex, pi-mono. Auto-detect available runtimes, self-install on first run, self-heal on path changes.

## Design Principles (from AXI + prior art)

Codified from AXI research and LangChain/Haystack/Elasticsearch lessons:

1. **Never silent empty.** Empty evidence is a first-class result, not an empty array. RunResult.empty = true, with tried-sources list and suggestions. (AXI #5, LangChain lesson)
2. **Aggregates eliminate round-trips.** Every RunResult includes source breakdown, attempt/failure count, timing. Agent never needs a follow-up to understand "what happened." (AXI #4)
3. **Truncate with escape hatch.** Text mode truncates long content with char count + `--full` flag. JSON mode returns full payload always. (AXI #3)
4. **Structured errors with suggestions.** Error envelope includes actionable next-step suggestions. Never leak raw API errors. (AXI #6a)
5. **Idempotent mutations.** Config set when already set = no-op, exit 0. Install when already installed = no-op. (AXI #6b)
6. **No interactive prompts.** Every operation completable with flags alone. Missing value = immediate structured error. (AXI #6c)
7. **stdout = data, stderr = debug.** Trace/progress on stderr only. Agent reads stdout only. (AXI #6d)
8. **Content first.** `search` with no args = compact status dashboard + hints, not help dump. (AXI #8)
9. **Contextual disclosure.** Next-step suggestions after results. Parameterized, relevant, not prescriptive. (AXI #9)
10. **Observable transports.** Source results include which transport path was used. Agent/user can see "gemini via browser-cookies" vs "gemini via API key." (Gemini composite source design)
11. **Fail loud on retrieval.** If a strategy's primary source returns nothing, the strategy must surface this explicitly. No silent fallthrough to hallucination-prone empty context.

## Slices

### Slice 1: Core types + Source interface + one real source

Prove the wiring: define core types, implement Source interface, port exa as first real source, create minimal client.

Verify: `createClient().search("exa", { query: "test" })` returns typed Evidence with Provenance.

- `src/sdk/types.ts` -- Evidence, Source, SourceRequest, SourceContext, Provenance, RunResult, RunSummary
- `src/sdk/registry.ts` -- SourceRegistry (register, get, list)
- `src/sdk/client.ts` -- createClient(), client.search(), client.status()
- `src/sdk/define.ts` -- defineSource()
- `src/sdk/sources/exa.ts` -- port existing exa.ts + exa-mcp.ts as defineSource with observable transports
- `src/sdk/config.ts` -- minimal config loading (secrets, http)
- `test/sdk/source-exa.test.ts` -- integration test: returns Evidence[], provenance populated, transport observable

### Slice 2: Strategy interface + web-default strategy + empty state handling

Port web.ts fallback chain as Strategy. Implement RunResult with aggregates and empty state semantics.

Verify: `createClient().run({ domain: "web", query: "bun sqlite" })` returns RunResult with summary, trace, and suggestions. Empty query returns RunResult with `empty: true` and tried-sources list.

- `src/sdk/strategy.ts` -- Strategy type, StrategyRegistry, StrategyContext with search/fetch/merge helpers
- `src/sdk/operators.ts` -- merge(), dedupe(), sort(), filter() as standalone functions
- `src/sdk/define.ts` -- add defineStrategy()
- `src/sdk/strategies/web-default.ts` -- port web.ts fallback chain, emit RunSummary with source breakdown + failure tracking
- `src/sdk/sources/brave.ts` -- port brave.ts
- `src/sdk/sources/gemini.ts` -- port gemini as composite source with observable transports (api / browser-cookies / web-fallback)
- `src/sdk/sources/perplexity.ts` -- port perplexity.ts
- `src/sdk/client.ts` -- add client.run() with strategy dispatch, RunResult assembly
- `test/sdk/strategy-web.test.ts` -- verify fallback chain, verify empty state, verify summary aggregates

### Slice 3: Domain + Module + config-is-code

Register domains. Load modules. Support `srch.config.ts`.

Verify: `defineConfig({ modules: [coreModule] })` registers all built-in domains/sources/strategies. `createClient(config).run({ domain: "code", query: "..." })` works end-to-end.

- `src/sdk/domain.ts` -- Domain type, DomainRegistry, defineDomain()
- `src/sdk/module.ts` -- Module type, defineModule()
- `src/sdk/config.ts` -- defineConfig(), config loading from srch.config.ts
- `src/sdk/modules/core.ts` -- core module bundling all built-in domains/sources/strategies
- `src/sdk/sources/context7.ts`, `deepwiki.ts`, `exa-mcp.ts` -- port remaining sources
- `src/sdk/sources/bird.ts` -- port twitter/bird as defineSource
- `src/sdk/strategies/code-default.ts` -- port code.ts (primary + parallel secondary fan-out)
- `src/sdk/strategies/fetch-default.ts` -- port content.ts (extraction chain)
- `src/sdk/strategies/social-default.ts` -- port bird-backed social strategy
- `src/sdk/domains/web.ts`, `code.ts`, `docs.ts`, `fetch.ts`, `social.ts`
- `test/sdk/module-core.test.ts` -- verify all domains reachable, registry populated

### Slice 4: CLI as thin frontend + AXI ergonomics

Rewrite CLI to import createClient and delegate. Adopt AXI principles: content-first home, contextual disclosure, truncation, structured errors with suggestions, idempotent mutations.

Verify: all existing CLI commands produce identical results. `search` (no args) shows status dashboard. Empty results show definitive message + suggestions. Errors include suggestions array in JSON envelope.

- `src/cli.ts` -- rewrite: parse args -> build RunRequest -> client.run() -> emit
- `src/cli/commands/` -- thin command handlers per domain
- `src/cli/home.ts` -- no-args handler: calls client.status(), renders compact dashboard (AXI #8)
- `src/cli/emit.ts` -- updated: add suggestions to error envelope (AXI #6a), truncation with `--full` (AXI #3)
- `src/cli/suggest.ts` -- contextual disclosure engine: given a RunResult + command, compute next-step hints (AXI #9)
- `src/cli/flags.ts` -- extract flag parsing from current cli.ts
- `test/cli/` -- port existing CLI tests, verify identical output + new behaviors (home, suggestions, truncation, empty states)

### Slice 5: Flights + rewards-flights as retrieval domains

Port flights and rewards-flights into SDK domain model with domain-specific Evidence payloads.

Verify: `client.run({ domain: "flights", query: "JFK DEL 2026-05-15" })` returns Evidence<FlightOffer[]>. CLI `search flights` renders same output as before.

- `src/sdk/sources/fli.ts` -- port fli.ts as defineSource (optional, detect + install hint)
- `src/sdk/sources/seats-aero.ts` -- port seats-aero.ts as defineSource
- `src/sdk/strategies/flights-default.ts`, `rewards-default.ts`
- `src/sdk/domains/flights.ts`, `rewards-flights.ts`
- `src/cli/commands/flights.ts`, `rewards-flights.ts` -- thin CLI handlers
- `test/sdk/domain-flights.test.ts`

### Slice 6: Session hooks (generic adapter system)

Implement HookAdapter interface with adapters for Claude Code, Codex, and pi-mono. Auto-detect available runtimes. Self-install on first run, self-heal on path changes.

Verify: `search install hooks` detects available runtimes and registers. Claude session starts with srch status. Pi session starts with srch status via extension.

- `src/sdk/hooks/types.ts` -- HookAdapter interface, HookInstallConfig
- `src/sdk/hooks/claude.ts` -- Claude Code adapter (writes ~/.claude/settings.json SessionStart)
- `src/sdk/hooks/codex.ts` -- Codex adapter (writes ~/.codex/hooks.json)
- `src/sdk/hooks/pi.ts` -- pi-mono adapter (generates ~/.pi/agent/extensions/srch.ts that imports SDK, calls status() on session_start)
- `src/sdk/hooks/install.ts` -- auto-detect + install all, self-heal logic, idempotent
- `src/cli/commands/hooks.ts` -- `search install hooks`, `search uninstall hooks`
- `src/cli/commands/ambient.ts` -- `search --ambient-context` (compact status output for shell-based hooks)
- `test/sdk/hooks.test.ts` -- verify detect/install/uninstall/idempotent for each adapter

### Slice 7: Agent harness interface

Define the agent adapter boundary. Implement a default harness using pi-mono (or stub).

Verify: an agentic strategy can be defined that delegates to an agent adapter. The agent can call srch SDK functions within the harness.

- `src/sdk/agent.ts` -- AgentAdapter interface, AgentContext, harness registration
- `src/sdk/adapters/pi-mono.ts` -- default adapter (stub or real depending on pi-mono availability)
- `src/sdk/strategies/agentic.ts` -- defineAgenticStrategy helper
- `test/sdk/agent-harness.test.ts`

## Risks & Mitigations

- Risk: over-engineering before users exist | Mitigation: v1 has zero manifest infra, zero plan IR. Just types + functions + config. Existing CLI works after slice 4.
- Risk: Evidence<T> generic too loose | Mitigation: domain-specific evidence helpers (webEvidence, codeEvidence, flightEvidence) narrow the type. Provenance is a discriminated union -- no invalid states. RunResult is success|empty|error -- no boolean + array mismatch.
- Risk: agent harness scope creep | Mitigation: slice 7 is interface + stub. Real harness implementation is separate.
- Risk: breaking CLI behavior during migration | Mitigation: slice 4 has explicit "identical output" test criterion. New behaviors (home, suggestions, truncation) are additive.
- Risk: source package distribution unclear | Mitigation: v1 ships all sources in core. Separate packages later.
- Risk: hook self-install feels invasive | Mitigation: `search install hooks` is explicit. Auto-install only on first interactive CLI run, not on SDK import. Uninstall is clean.
- Risk: AXI ergonomics add scope to CLI slice | Mitigation: suggestions engine and truncation are small. Home view reuses client.status(). Don't boil the ocean on contextual disclosure -- start with 2-3 suggestions per command.

## Open Questions

- [ ] pi-mono integration: is pi-mono ready to be imported as a library, or does it only work as a CLI/agent harness? This affects slice 7.
- [ ] Package name: `@srch/sdk`? `srch`? `search-sdk`? Needs npm namespace check.
- [ ] Should the core module include flights/rewards, or should those be separate optional modules (mirroring current `search install flights`)?
- [ ] Hook auto-install: on first CLI run only, or also on `npm install`? Former is less invasive.

## Out of Scope

- Manifest language (YAML/JSON) -- future, not v1
- Plan IR / reified plan objects -- future, not v1
- Agentic evaluation/revision loop -- interface only in v1, implementation later
- Plugin registry / discovery -- future
- Evals framework -- future (but noted as critical validation of the thesis; AXI bench harness is the template)
- Policy system -- future
- TOON output format -- future, pending jq-compatibility assessment
