---
name: search
description: "Local-first research CLI for agents and humans. Gather grounded information with low-token defaults and stable machine-readable output."
---

# search

Local-first research CLI for agents and humans. Use it to gather grounded information with low-token defaults and stable machine-readable output.

## When to use

Use `search` when you need to:
- answer an internet research question with cited sources
- understand a library, framework, API, or public repo faster than browsing
- search your own local markdown/docs corpus
- turn a URL into readable extracted content
- search or read tweets/threads on X (Twitter)
- inspect prior runs or diagnose search/config state

Prefer `--json` for agent flows. Add `--verbose` only when you need routing/timing traces. Add `--out <path>` when you want to persist the final rendered result for later use.

## Quick start

```bash
search web bun sqlite wasm
search code "react suspense cache"
search docs auth flow
search fetch https://clig.dev
search twitter "bun runtime"
search inspect tools --json
```

## Capability map

| Problem | Command | Example |
|---------|---------|---------|
| Need web answers with citations | `search web` | `search web react compiler --json` |
| Need higher quality web answers | `search web --hq` | `search web react compiler --hq --json` |
| Need code context for a library/API/repo | `search code` | `search code "facebook/react hooks" --json` |
| Need up-to-date library docs | `search code` | `search code "next.js middleware" --json` |
| Need to deep search inside a repo | `search code repo` | `search code repo facebook/react "useEffect" --json` |
| Need to deep search a local codebase | `search code repo` | `search code repo . "auth middleware" --json` |
| Need to search local docs/notes | `search docs` | `search docs auth flow --json` |
| Need readable content from a known URL | `search fetch` | `search fetch https://clig.dev --json` |
| Need repo-aware content from GitHub URL | `search fetch` | `search fetch https://github.com/tobi/qmd --json` |
| Need to search tweets on X | `search twitter` | `search twitter "bun runtime" --json` |
| Need to read a specific tweet or thread | `search twitter` | `search twitter read https://x.com/i/status/123 --json` |
| Need diagnostics / secret resolution status | `search inspect tools` | `search inspect tools --json` |
| Need prior results | `search history` | `search history docs --json` |

## Common patterns

### Internet research

```bash
search web next.js caching
search web privacy search api --provider brave
search web react compiler --hq --json
search web sqlite wasm --provider gemini --json
```

### Library / repo understanding

```bash
search code "react suspense cache"
search code "vercel/next.js app router internals" --json
search code repo facebook/react "useEffect cleanup"
search code repo . "auth middleware"
```

### Local knowledge base

```bash
search docs index add ./docs --name project-docs
search docs index update
search docs deployment checklist --json
```

### Twitter / X

```bash
search twitter "bun runtime"
search twitter "from:toaborevol" --count 20 --json
search twitter read https://x.com/toaborevol/status/123456
search twitter thread https://x.com/toaborevol/status/123456 --json
search x.com "react compiler"
```

### Read and extract a page

```bash
search fetch https://clig.dev --json
search fetch https://github.com/tobi/qmd --json

Canonical note for skills/docs references:
- prefer the short alias `search fetch` in normal use
- refer to the canonical command name `search fetch-content` when you need exact command-path naming
```

## Output modes

- `--json` -- stable envelope: `{ ok, command, data|error }`
- `--verbose` -- concise stderr trace; stdout stays clean
- `--out <path>` -- persist final output to a file
  - default mode saves human-readable text
  - `--json` saves the stable JSON envelope

## Agent guidelines

### Pick the narrowest command

- `web` for open-web questions
- `code` for API/library/repo understanding
- `docs` for local indexed docs
- `twitter` / `x.com` for tweet search/read/threads
- `fetch` when you already have the URL

### Fetch first, summarize second

Do not invent sources. Run `search`, then summarize only returned content.

### Prefer JSON for multi-step flows

Use `--json` whenever another step will parse, rank, filter, or merge the result.

### Progressive disclosure

Start broad, then drill down:

```bash
search --help
search web --help
search code --help
search docs --help
search twitter --help
search config --help
```

### Secrets

Use runtime secret refs, not plaintext values.

```bash
search config set-secret-ref exaApiKey op 'op://agent-dev/exa/API Key'
search config set-secret-ref braveApiKey op 'op://agent-dev/Brave Search/api key'
search config set-secret-ref geminiApiKey op 'op://agent-dev/Gemini API Key/password'
search inspect tools --json
search web bun sqlite wasm --json --out web.json
```
