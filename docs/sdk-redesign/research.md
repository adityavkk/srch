# srch SDK-first redesign: research

## What exists today

### Code shape (~4500 LOC)
- `src/cli.ts` (500 LOC): monolithic router + formatter + side effects
- `src/lib/search/web.ts`: fallback chain orchestration (exa -> brave -> gemini-web -> gemini-api -> perplexity)
- `src/lib/search/code.ts`: primary/secondary source fan-out (exa-context + deepwiki + context7)
- `src/lib/upstream/*`: 8 provider adapters (exa, brave, gemini-api, gemini-web, perplexity, bird, exa-mcp, context7/deepwiki)
- `src/lib/fetch/*`: content extraction chain (readability -> rsc -> jina -> gemini-url-context)
- `src/lib/flights/fli.ts`, `src/lib/rewards-flights/seats-aero.ts`: domain-specific adapters
- `src/lib/trace.ts`: tracing infra
- `src/lib/cli/emit.ts` + `result.ts`: normalized output boundary
- `src/sdk.ts`: stub, only re-exports flights types

### Implicit patterns already working
- `web.ts` = static strategy (ordered fallback chain over sources)
- `code.ts` = static strategy (primary + parallel secondary fan-out + merge)
- `fetch/content.ts` = static strategy (extraction chain with type-aware routing)
- Provider adapters in `upstream/` = source-shaped (one API, one concern)
- `trace.ts` = span-based instrumentation
- `emit.ts` = execution/rendering separation

## Prior art research

### Provider/driver patterns (infrastructure)

**Go database/sql** -- the canonical pluggable backend pattern. Key insight: split user-facing type (DB struct with connection pooling, retries) from backend interface (driver.Driver). The user never touches the driver directly. Adding user-facing capabilities doesn't break driver implementations. Backend-specific features can be selectively utilized without exposing them to the user. Registration via init() + sql.Register("sqlite3", &SQLiteDriver{}).

**Vercel AI SDK ProviderV3** -- typed provider interface for LLM backends. ProviderV3 is a factory (`languageModel(id) -> LanguageModelV3`). Each provider implements doGenerate/doStream. Community providers are separate npm packages. Clean separation: framework owns orchestration, providers own transport. Directly analogous to srch's source model.

**Grafana DataSource plugins** -- pluggable query backends with a shared query model. Each datasource implements a query interface, the framework handles visualization/alerting/dashboarding. The query abstraction varies per datasource type. Relevant: Grafana doesn't force all datasources into one query shape; the interface is generic.

**OpenTelemetry TracerProvider/SpanExporter** -- pluggable export backends behind a fixed trace model. The SDK owns the trace lifecycle; exporters are swappable. Relevant: observability as a first-class framework concern, not an afterthought.

**Terraform Provider model** -- pluggable infrastructure backends behind a declarative config language. Started config-first (HCL), community wanted code (CDK for Terraform, Pulumi). Lesson: config languages grow features until they're bad programming languages. Code-first with config-as-subset avoids this.

### Retrieval frameworks (direct competitors/inspirations)

**LangChain** -- composition via LCEL (LangChain Expression Language). Chains are pipes. Strength: massive ecosystem, integrations for everything. Weakness: silent failures in chains (empty retrieval -> hallucinated answer with no warning). Default behavior when upstream fails is to carry on. Lesson: srch must make failure observable and explicit.

**LlamaIndex** -- node-centric model (chunks carry metadata through pipeline). SentenceWindowNodeParser, reranking postprocessors. Strength: deep document processing. Weakness: multiple ways to do everything, unclear which is canonical. Lesson: srch should have one obvious way to do each thing.

**Haystack** -- pipeline component model. Components are typed (inputs/outputs declared). Pipelines are DAGs validated at construction time. Strength: explicit, inspectable pipelines. Weakness: heavier abstraction for simple cases. Lesson: pipelines are valuable when they're optional, not mandatory.

**Elasticsearch retrievers** -- composable retriever tree (standard, knn, rrf, text_similarity_reranker). Retrievers can nest arbitrarily. Framework handles execution planning, shard routing. Key insight: retrievers are the composition unit, not queries. Directly maps to srch's strategy concept.

**DSPy** -- programming model for LLM pipelines. Signatures define I/O. Modules compose. ReAct built in. Tools are just functions. Strength: declarative optimization of LLM programs. Lesson: the "tool" abstraction should be as simple as a typed function.

### Agent-computer interfaces (ACI)

**SWE-agent ACI** -- custom tool set designed for the agent, not the human. Key finding: "good ACI design leads to much better results." Custom file viewer (100 lines at a time), linter that blocks bad edits, concise search output. Lesson: the interface you give the agent matters more than the model. This is srch's core bet.

**CodeAct (ICML 2024)** -- replaces tool-call-as-atom with code-block-as-atom. Agent writes Python that calls multiple tools, processes results, applies control flow. 50 servers? One asyncio.gather, not 50 round-trips. Anthropic productized this as Programmatic Tool Calling. Key insight: "the model is being used as an orchestrator for work that doesn't require language model reasoning at each step." Code is the right abstraction for deterministic control flow over messy data. This is exactly srch's codeact-primary model.

**tool2agent protocol** -- structured feedback from tools to agents. Rich error types, suggestions, domain constraints expressed as guardrails in code rather than prompt context. Lesson: tools should communicate rich structured feedback, not just string results. srch's Evidence type serves this role.

### AXI: Agent eXperience Interface (kunchenguid/axi)

**What it is**: 10 design principles for building agent-ergonomic CLI tools. Reference implementations: `gh-axi` (GitHub), `chrome-devtools-axi` (browser). Ships a TypeScript SDK (`axi-sdk-js`) for building AXI-compliant CLIs.

**Benchmark results**: gh-axi vs alternatives on 17 GitHub agent tasks (425 runs, Claude Sonnet 4.6):
- gh-axi: 100% success, $0.050 avg cost, 15.7s, 3 turns
- gh CLI: 86% success, $0.054, 17.4s, 3 turns
- GitHub MCP: 87% success, $0.148, 34.2s, 6 turns
- GitHub MCP + ToolSearch: 82% success, $0.147, 41.1s, 8 turns

**All 10 AXI principles mapped to srch**:

**1. Token-efficient output.** TOON format gives ~40% savings over JSON. *srch decision: TOON breaks jq piping. Keep `--json` as JSON. Default text mode stays concise. Could add `--toon` later if proven valuable at srch's output sizes.*

**2. Minimal default schemas.** 3-4 fields per list item, not 10. Default limits high enough to cover common cases in one call. Long-form content belongs in detail views.
*srch application:* Evidence text output should show source, title/URL, and a snippet. Full content via `--full` or `--json`. Web results already do this. Code results dump full text -- should truncate by default with size hint.

**3. Content truncation with size hints.** Truncate large text fields by default. Show total size. Suggest `--full` escape hatch.
```
source: exa
snippet: First 500 chars of the result...
  ... (truncated, 4832 chars total)
help: Run `search web "query" --full` to see complete content
```
*srch application:* Code search returns full exa-context responses (often 5000+ tokens). Should truncate in text mode with char count + `--full` flag. JSON mode always returns full payload. Fetch command should truncate long pages similarly.

**4. Pre-computed aggregates.** Include total counts and derived status that eliminate follow-up calls.
```
results: 5 of 23 total (showing top 5 by relevance)
sources: exa (3), brave (2)
providers: 2 attempted, 1 failed (gemini: no API key)
```
*srch application:* Every RunResult should include: total evidence count, source breakdown, provider attempt/failure summary, timing. The agent shouldn't need a second call to know "how many results" or "which sources contributed."

**5. Definitive empty states.** Explicit "0 results" with context, not ambiguous empty output.
```
web: 0 results for "obscure query" (tried: exa, brave, gemini)
help: Try broader terms or `search web --hq "query"` for paid API
```
*srch application:* CRITICAL. LangChain's #1 production failure is silent empty retrieval -> hallucinated answer. srch must never return empty evidence without explicit zero-result message. Strategies must propagate "no results" as a first-class state, not empty array.

**6. Structured errors, idempotent mutations, no interactive prompts.**

*6a. Structured errors on stdout:* Errors in same format as data, with actionable suggestions. srch already does this via JSON envelope (`{ ok: false, error: { message } }`). Add `suggestions` array to error envelope.
```json
{ "ok": false, "command": ["web"], "error": { "message": "No provider available", "suggestions": ["Run search config set-secret-ref exaApiKey ...", "Run search inspect tools --json"] } }
```

*6b. Idempotent mutations:* `search config set-secret-ref exaApiKey ...` when already set = success (no-op), not error. `search install flights` when already installed = success. Exit 0.

*6c. No interactive prompts:* Every operation completable with flags alone. Never prompt for input. Missing required value = immediate structured error with usage hint. *srch already does this but should be explicit design principle.*

*6d. Output channels:* stdout = structured data/text the agent consumes. stderr = trace/debug (`--verbose`). Exit codes: 0 = success (including no-ops), 1 = error, 2 = usage error. *srch already does this correctly.*

**7. Ambient context via session hooks.** Self-install into agent session lifecycle. Detailed above in hook adapter section.

**8. Content first (no-args = live data).** Running with no args shows the most relevant live content, not help text.
*srch decision:* `search` with no args is ambiguous -- no single "home view" like a task list. Resolution: `search` with no args shows a compact status dashboard (like ambient context output) + help hints. Not full help text, not empty.
```
srch: 5 domains, 8 sources (6/6 healthy)
domains: web, code, docs, flights, social
recent: web "bun sqlite" (2m ago), code repo ./src "auth" (1h ago)
help: search <domain> <query> | search --help for full reference
```

**9. Contextual disclosure.** Include next-step suggestions after each output. Relevant, actionable, parameterized.
*srch application:* After web search results:
```
help: Run `search fetch <url>` to read a source in full
      Run `search web --hq "query"` for higher quality results
```
After empty code search:
```
help: Run `search code repo <target> "query"` for deep repo search
      Run `search web "query"` for broader results
```
Rules: only suggest when next step isn't obvious. Parameterize with `<url>`, `<target>`. Carry forward flags from current invocation.

**10. Consistent help with bin/description header.** Top-level home view identifies the tool: absolute path (collapsed `~`), one-sentence description. Every subcommand supports `--help` with concise reference.
*srch application:* Already has `--help` per subcommand. Add bin/description header to no-args output (see #8). Collapse home dir in paths.

**AXI SDK architecture patterns** (`axi-sdk-js`):
- `runAxiCli()` -- main entry point. Takes description, commands map, home handler, hooks config.
- `AxiCliCommand<TContext>` -- typed command handler `(args, context) => AxiRenderable`
- Auto-installs session hooks into `~/.claude/settings.json` and `~/.codex/hooks.json`
- `renderOutput()` -- converts structured objects to output format at the boundary
- `errorOutput()` + `renderError()` -- structured error rendering with suggestions
- Self-healing hook installation (detects path changes, re-registers)

**What srch can learn from AXI**:
- Session hooks for ambient context injection (domain availability, source status)
- Structured errors with next-step suggestions (already partially there)
- Token-efficient default output (already there in text mode)
- Definitive empty states (must be a design principle)
- The benchmark methodology: compare domain-specific interface vs MCP vs raw CLI on identical tasks with LLM judge. *This is exactly the eval framework srch needs to validate the thesis.*

**Session hooks -- generic adapter model for srch**:

| Runtime | Mechanism | Registration |
|---|---|---|
| Claude Code | `~/.claude/settings.json` SessionStart hook (shell cmd -> stdout) | JSON config, command path |
| Codex | `~/.codex/hooks.json` session_start (shell cmd -> stdout) | JSON config, command path |
| pi-mono | `~/.pi/agent/extensions/srch.ts` (TS extension, `session_start` event) | Generated .ts file that imports srch SDK |

srch defines a `HookAdapter` interface:
```ts
interface HookAdapter {
  name: string;           // "claude" | "codex" | "pi"
  detect(): boolean;      // is this runtime installed?
  install(config): void;  // write hook config/extension
  uninstall(marker): void;
}
```

All adapters register the same ambient context output:
```
srch: 5 domains, 8 sources (6/6 healthy)
domains: web, code, docs, flights, social
help: Run `search web "query"` or import { createClient } from "@srch/sdk"
```

Claude/Codex: `search --ambient-context` command (stdout captured).
pi-mono: generated extension calls `createClient().status()` on `session_start` and injects via `pi.appendEntry()`.

**Where srch goes beyond AXI**:
- AXI is CLI-first (agents call shell commands). srch is SDK-first (agents import TypeScript).
- AXI defines output ergonomics. srch defines a domain model (sources, strategies, evidence).
- AXI optimizes individual tool calls. srch optimizes retrieval workflows (composition, fallback, merge).
- AXI is tool-level. srch is domain-level. They're complementary -- srch could adopt AXI principles for its CLI surface while the SDK goes deeper.

**TOON format decision**: TOON saves tokens but breaks `jq` piping. For srch:
- `--json` stays JSON (machine-readable, jq-compatible, automation)
- Default text mode stays concise human-readable (current behavior)
- Could add `--toon` later if agent token efficiency is proven to matter at srch's output sizes
- Don't adopt TOON as default -- the jq pipeline tax is real for scripting users

### MCP limitations (why srch is needed)

**"MCP Is Not Enough" (Scola, 2026)** -- MCP solved tool integration. But: no agent identity, no capability manifests as contracts, no discovery without central registry, no policy enforcement. "Tools are not agents." The gaps are above the transport layer. srch addresses this by providing domain semantics, policies, and observable execution on top of the transport.

**Tool proliferation problem** -- "Tool-to-Agent Retrieval" (PwC, 2025). Agent-first pipelines match against coarse agent descriptions, hiding relevant tools. Tool-only retrieval ignores complementary benefits of tool bundles. Their solution: embed tools and agents in shared vector space. 19.4% Recall@5 improvement. srch's domain model is the structural equivalent: domains group related sources, strategies compose them.

**"Stop Dumping Tools Into Context"** -- flat tool lists don't scale. Context window fills with tool descriptions the model never calls. Hierarchical organization (domains > sources) reduces the selection space. srch's domain-first grammar is this hierarchy made concrete.

## Core thesis (refined)

srch is a **TypeScript SDK** that provides **domain-boundary artifacts** for codeact agents.

Instead of flat tool lists (MCP), srch gives agents:
- **Typed domains** with semantic retrieval capabilities
- **Composable functions** (search, fetch, merge) as vocabulary
- **Observable execution** (trace, evidence provenance)
- **Structured evidence** (not strings) with domain-specific payloads

The agent writes TypeScript that imports `@srch/sdk`. The code IS the plan. Static strategies are pre-written functions. Agentic strategies are agent-authored code using the same SDK.

The bet: this outperforms flat tool lists for retrieval tasks because:
1. Fewer routing decisions (domain intent vs tool selection)
2. Rich structured feedback (Evidence<T> vs string)
3. Composability (merge, dedupe, sort as library functions vs manual orchestration)
4. Observability (trace + provenance vs opaque tool calls)
5. Context efficiency (domain-level intent vs N tool descriptions)

### Prior art alignment

| Pattern | srch equivalent | What we learn |
|---------|----------------|---------------|
| Go database/sql driver | Source interface | User-facing type hides backend complexity |
| Vercel AI SDK Provider | Source with transports | Community packages, typed contracts |
| Elasticsearch retrievers | Strategy composition | Retrievers as composition unit, nestable |
| CodeAct | Codeact-primary agent model | Code > tool calls for orchestration |
| SWE-agent ACI | Domain model as agent interface | Interface design > model capability |
| AXI principles | CLI output ergonomics | Token-efficient, definitive empty states, session hooks |
| AXI benchmarks | Eval methodology for srch | Domain interface vs MCP vs CLI, LLM-judged |
| tool2agent | Evidence with structured feedback | Rich tool responses, not strings |
| Terraform -> Pulumi | Code-is-config model | Config languages grow into bad PLs |
| LangChain silent failures | Observable execution + trace | Never silently swallow empty results |

## Risks

- Over-engineering before users exist
- Evidence<T> generic too loose without domain-specific helpers
- Agent harness scope creep (interface only in v1)
- Breaking existing CLI during migration
- Framework adoption barrier vs MCP simplicity

## Open questions (resolved)

1. ~~Who is the target user?~~ General purpose framework for agent developers.
2. ~~Manifest language v1?~~ No. Code-is-config. Optional JSON subset later.
3. ~~Flights as retrieval?~~ Yes. Evidence = grounded result pointer, domain-specific payload.
4. ~~Plan IR?~~ No. Code is the plan (codeact-primary).
5. ~~Composite sources?~~ One source, multiple transports, observable.
6. ~~Agent loop ownership?~~ Agent writes code using srch SDK. Harness is pluggable (pi-mono default).
7. ~~Just refactor or build framework?~~ Build the interface. This is about establishing a paradigm.
