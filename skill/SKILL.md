# search

Local-first research CLI for agents and humans. Use for web research, code context, local docs, readable URL fetch, and lightweight diagnostics.

## When to use

Use `search` when you need:
- web search with citations
- code/docs context from Exa MCP
- optional DeepWiki context for public repos
- local markdown/doc search via QMD
- readable page extraction from a URL
- machine-readable JSON for downstream agent steps

Prefer `--json` for agent flows. Add `--verbose` for trace logs on stderr.

## Quick start

```bash
search web bun sqlite wasm
search code "react suspense cache"
search docs auth flow
search fetch-content https://clig.dev
search inspect tools --json
```

## Capabilities

| Command | What it does | Notes |
|---------|--------------|-------|
| `search web` | Web research with citations | Explicit providers: exa, brave, perplexity, gemini. Fallbacks: Exa -> Brave -> Perplexity -> Gemini |
| `search code` | Code/docs context | Primary: Exa MCP. Secondary: DeepWiki when meaningful |
| `search docs` | Local docs search | Uses QMD SDK; index your own collections |
| `search fetch-content` | Readable URL extraction | Good for docs/articles/pages |
| `search history` | Prior runs | Useful for reuse / inspection |
| `search inspect tools` | Diagnostics | Shows backends + redacted secret source |
| `search config` | Safe config | Set provider, secret refs, inspect config |

## Common patterns

### Web research

```bash
search web react compiler
search web privacy search api --provider brave
search web ai evals --json
search web next.js caching --verbose
```

### Code context

```bash
search code "sqlite wal checkpoint"
search code "facebook/react hooks" --json
```

### Local docs

```bash
search docs index add ./docs --name project-docs
search docs index update
search docs auth flow --json
```

### Read a page

```bash
search fetch-content https://clig.dev --json
```

## Output modes

- `--json` -- stable JSON envelope: `{ ok, command, data|error }`
- `--verbose` -- concise trace view on stderr; stdout remains clean

JSON preserves native backend payloads where useful:
- web: native Exa / Brave / Perplexity payloads
- code: native Exa MCP payloads + optional DeepWiki payloads
- docs: native QMD SDK results

## Secrets

Prefer runtime secret refs, not plaintext values.

Examples:

```bash
search config set-secret-ref exaApiKey op 'op://agent-dev/exa/API Key'
search config set-secret-ref braveApiKey op 'op://agent-dev/Brave Search/api key'
search config set-secret-ref exaApiKey fnox EXA_API_KEY
```

Inspect redacted resolution:

```bash
search inspect tools --json
```

## Agent guidelines

### Use JSON for automation

Prefer `--json` whenever output will be parsed, transformed, or passed to another step.

### Fetch first, summarize second

Do not invent sources. Run `search` first, then summarize only returned data.

### Pick the narrowest command

- use `web` for internet research
- use `code` for API/library/codebase questions
- use `docs` for local indexed markdown/docs
- use `fetch-content` when you already have a URL

### Progressive disclosure

Start broad, then drill in:

```bash
search --help
search web --help
search docs --help
search config --help
```

### Trace only when needed

Use `--verbose` for debugging routing, timing, or backend selection. Avoid it for routine low-token runs.
