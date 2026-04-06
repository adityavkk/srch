# search

Local-first CLI for web research, code context, doc search, and content fetch.

Designed for humans and LLM agents:
- terse default output
- stable `--json`
- progressive `--help`
- optional `--verbose` trace on stderr
- runtime secret resolution from 1Password / fnox refs

## Install

```bash
npm install
npm run build
```

Local install:

```bash
npm link
# or if npm link is restricted, symlink dist/cli.js into a PATH dir
```

Then:

```bash
search --help
```

## Capabilities

### 1. Web search

Search the web with normalized output plus native backend payloads.

Fallback chain:
- Exa
- Brave Search
- Perplexity
- Gemini

```bash
search web bun sqlite wasm
search web bun sqlite wasm --json
search web react server components --provider exa
search web privacy search api --provider brave
search web ai evals --provider perplexity --json
search web sqlite wasm --provider gemini --json
```

Good for:
- fast research
- cited sources
- agent-friendly JSON
- backend-native payload preservation

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

Fallback chain for hard pages:
- direct HTTP + Readability
- Next.js RSC extraction
- Jina Reader
- Gemini URL Context

GitHub URLs are handled specially:
- repo root -> tree + README + local clone path
- tree URL -> directory listing
- blob URL -> actual file contents

```bash
search fetch https://clig.dev
search fetch https://clig.dev --json
search fetch https://github.com/tobi/qmd --json
```

PDFs are handled specially too:
- downloads bytes
- extracts text to markdown
- saves markdown to `~/Downloads`

```bash
search fetch https://arxiv.org/pdf/1706.03762.pdf --json
```

### 5. Inspect / debug

Read-only diagnostics.

```bash
search inspect tools
search inspect tools --json
search inspect tools --verbose
# includes redacted secret sources + Gemini browser profile diagnostics + GitHub CLI availability
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
search config --help
```

Subcommand level:

```bash
search docs index status --json
search docs index add ./docs --name docs
```

## Safe config

Inspect config safely:

```bash
search config
search config --json
search config --help
```

Set provider:

```bash
search config set provider exa
```

Preferred: runtime secret refs, not plaintext values.

1Password refs:

```bash
search config set-secret-ref exaApiKey op 'op://agent-dev/exa/API Key'
search config set-secret-ref braveApiKey op 'op://agent-dev/Brave Search/api key'
search config set-secret-ref geminiApiKey op 'op://agent-dev/Gemini API Key/password'
```

fnox refs:

```bash
search config set-secret-ref exaApiKey fnox EXA_API_KEY
search config set-secret-ref perplexityApiKey fnox PERPLEXITY_API_KEY
```

Unset fields:

```bash
search config unset exaApiKey
search config unset braveApiKey
search config unset provider
```

Resolution order:
- env vars
- plaintext config values if present
- config secret refs
- implicit fnox fallback by conventional env key name

Notes:
- never prints secret values
- inspect shows redacted source only
- prefer `op` / `fnox` refs over plaintext config

## Notes

- web JSON preserves native Exa / Brave / Perplexity / Gemini payloads
- `search web --provider brave` and `--provider gemini` are supported explicitly
- code JSON preserves native Exa MCP payloads and optional DeepWiki payloads
- docs JSON preserves native QMD SDK results
- fetch-content has GitHub-aware handling and stronger page fallbacks
- Gemini can use API or logged-in browser-cookie fallback
- `--verbose` writes trace output to stderr; stdout remains stable
