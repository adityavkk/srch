# search

Local-first CLI for web research, code context, doc search, and content fetch.

Designed for humans and LLM agents:
- terse default output
- stable `--json`
- progressive `--help`
- optional `--verbose` trace on stderr

## Install

```bash
npm install
npm run build
npm link
```

Then:

```bash
search --help
```

## Capabilities

### 1. Web search

Search the web with normalized output plus native backend payloads.

```bash
search web bun sqlite wasm
search web bun sqlite wasm --json
search web react server components --provider exa
search web ai evals --provider perplexity --json
```

Good for:
- fast research
- cited sources
- agent-friendly JSON

### 2. Code search

Primary source: Exa code context.

Optional secondary source: DeepWiki for public repos when the query clearly references `owner/repo` and DeepWiki has meaningful indexed info.

```bash
search code "react suspense cache"
search code "facebook/react hooks" --json
search code "vercel/next.js app router internals"
search code "sqlite wal checkpoint" --max-tokens 8000 --json
```

JSON includes:
- normalized result text
- native Exa MCP payload
- optional `secondary.deepwiki`

### 3. Local docs search

Backed by QMD SDK.

Add collections:

```bash
search docs index add ./docs --name project-docs
search docs index add ~/notes --name notes --pattern "**/*.md"
```

Build / inspect index:

```bash
search docs index update
search docs index embed
search docs index status --json
search docs index list
```

Search:

```bash
search docs auth flow
search docs deployment checklist --json
```

### 4. Fetch page content

Fetch readable content from a URL.

```bash
search fetch-content https://clig.dev
search fetch-content https://clig.dev --json
```

### 5. Inspect / debug

Read-only diagnostics.

```bash
search inspect tools
search inspect tools --json
search inspect tools --verbose
```

### 6. History

Review prior runs.

```bash
search history
search history docs --json
search history web
```

## Output modes

### Default

Short, readable, low-token.

### `--json`

Stable envelope:

```json
{
  "ok": true,
  "command": ["web"],
  "data": {}
}
```

Errors:

```json
{
  "ok": false,
  "command": ["code"],
  "error": { "message": "..." }
}
```

### `--verbose`

Shows a trace view on stderr.
Useful for timing, routing, and debugging without polluting stdout.

```bash
search web sqlite wasm --json --verbose
```

## Progressive disclosure

Top level:

```bash
search --help
```

Command level:

```bash
search web --help
search code --help
search docs --help
search inspect --help
```

Subcommand level:

```bash
search docs index status --json
search docs index add ./docs --name docs
```

## Notes

- web JSON preserves native Exa / Perplexity payloads
- code JSON preserves native Exa MCP payloads and optional DeepWiki payloads
- docs JSON preserves native QMD SDK results
- `--verbose` writes trace output to stderr; stdout remains stable
