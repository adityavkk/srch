# CLI taxonomy

`srch` should expose a stable, domain-first CLI grammar.

## Core rule

```text
search <domain> [subdomain] [strategy] [target] <query-or-task>
```

Where:
- `domain` = retrieval space
- `subdomain` = optional narrower retrieval space
- `strategy` = named static or agentic retrieval program
- `target` = optional scope object like repo slug/path/url/corpus
- `query-or-task` = the user request

## Design decisions

### 1. Domain-first

Top-level commands should represent retrieval spaces users already think in.

Examples:
- `web`
- `code`
- `docs`
- `social`
- `fetch`
- `ask`

`ask` is not a special top-level mode outside the taxonomy. It is just another domain, intended for cross-domain or mixed-domain retrieval tasks.

### 2. Strategies are second-level

Strategies are the unit of retrieval behavior.
They can be:
- static
- agentic

Examples:
- `repo`
- `research`
- `verify`
- `investigate`
- `compare`
- `thread`
- `read`

### 3. Optional subdomains

Subdomains create room for domain-specific ecosystems without polluting the top level.

Examples:
- `search social reddit "react compiler"`
- `search social x "bun runtime"`
- `search social hn "sqlite wasm"`
- `search docs npm "react query invalidation"`
- `search code github facebook/react "useEffect cleanup"`

Subdomains should represent durable, understandable retrieval spaces, not backend implementation details.

Good subdomains:
- `reddit`
- `x`
- `hn`
- `github`
- `local`
- `npm`

Bad subdomains:
- `exa`
- `provider-a`
- `agent-a`
- `balanced`

Those belong in source selection, policy, or config.

## Public grammar

### Default strategy

```bash
search web "bun sqlite"
search code "react suspense cache"
search docs "nextauth callbacks"
search social "bun runtime"
search ask "compare bun vs node for cli tooling"
```

Interpretation:
- domain selected
- default strategy implied
- policy default applied

### Named strategy

```bash
search web research "best auth for next.js"
search web verify "is react compiler production ready"
search code investigate "How does React Suspense caching work?"
search code repo facebook/react "useEffect cleanup"
search ask compare "best state management approach for docs-heavy react app"
```

Interpretation:
- domain selected
- specific strategy selected
- strategy may be static or agentic

### Subdomain + strategy

```bash
search social reddit "react compiler"
search social x thread https://x.com/.../status/123
search social reddit research "best recent posts about bun"
search code github repo facebook/react "useEffect cleanup"
```

Interpretation:
- domain selected
- optional subdomain narrows retrieval space
- optional strategy selects behavior

## Taxonomy

### Domains

- `web`
- `code`
- `docs`
- `social`
- `fetch`
- `ask`

### Candidate subdomains

#### social
- `reddit`
- `x`
- `hn`
- maybe `youtube`
- maybe `tiktok`

#### code
- `github`
- `local`
- maybe `gitlab`

#### docs
- `npm`
- `local`
- maybe `vendor`

#### ask
- none required initially
- possible future mixed scopes or profiles if they become durable

### Strategies

#### web
- implicit default
- `research`
- `verify`
- `compare`

#### code
- implicit default
- `repo`
- `investigate`
- `verify`

#### docs
- implicit default
- `research`
- `compare`

#### social
- implicit default
- `read`
- `thread`
- `research`
- `scan`

#### ask
- implicit default
- `compare`
- `research`
- `verify`
- `investigate`

## Naming rules

### Use nouns for domains and subdomains

Examples:
- `code`
- `social`
- `reddit`
- `github`

### Use behavior names for strategies

Examples:
- `repo`
- `research`
- `verify`
- `investigate`
- `compare`

### Keep providers mostly hidden

Provider names should generally stay out of positional command grammar.
Use flags/config instead:

```bash
search web "bun sqlite" --provider brave
search web "bun sqlite" --policy free-first
```

### Avoid positional internal names

Avoid names like:
- `agent-a`
- `provider-a`
- `exa`
- `balanced`

These are implementation/config concerns, not core user grammar.

## Recommended interpretation model

For users:
- `domain` answers: what world am I searching?
- `subdomain` answers: what narrower space inside that world?
- `strategy` answers: how should retrieval behave?

For the engine:
- domain/subdomain help shape query compilation
- strategy selects a static or agentic retrieval program
- policy and provider selection remain separate concerns

## Examples

### Deterministic

```bash
search web "bun sqlite"
search code "react suspense cache"
search docs "nextauth callbacks"
search fetch https://clig.dev
```

### Specialized static

```bash
search code repo facebook/react "useEffect cleanup"
search social x thread https://x.com/.../status/123
```

### Agentic by domain

```bash
search web research "best auth for next.js app router"
search web verify "does bun support sqlite in production"
search code investigate "How does React Suspense caching work?"
search ask compare "best state management for a docs-heavy react app"
```

### Subdomain-oriented

```bash
search social reddit "react compiler"
search social hn "sqlite wasm"
search code github repo facebook/react "useEffect cleanup"
```

## Summary

Recommended CLI model:

```text
search <domain>                # default strategy
search <domain> <strategy>     # named strategy
search <domain> <subdomain>    # narrowed retrieval space
search <domain> <subdomain> <strategy>
```

This keeps `srch`:
- domain-first
- extensible
- progressive
- agent-friendly
- compatible with static and agentic strategies
