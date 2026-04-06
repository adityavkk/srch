export const ROOT_HELP = `search — programmable retrieval engine

Domain-first grammar:
  search <domain> [subdomain] [strategy] [target] <query-or-task>

Domains:
  web            web retrieval
  code           code retrieval
  docs           local docs retrieval
  social         social retrieval spaces
  fetch          readable URL fetch
  ask            cross-domain retrieval
  twitter        legacy X/Twitter command
  x.com          alias for twitter
  history        inspect prior runs
  inspect        inspect backends/config
  config         safe config management
  help           show help

Examples:
  search web bun sqlite wasm
  search code repo facebook/react "useEffect cleanup"
  search social x "bun runtime"
  search ask compare "best state management for a docs-heavy react app"
  search fetch https://clig.dev
  search inspect tools --json

Output:
  --json      stable structured output
  --verbose   trace view on stderr

Next help:
  search web --help
  search code --help
  search docs --help
  search social --help
  search config --help
`;

export const WEB_HELP = `search web — web research

What it does:
  searches web backends, returns answer + sources

Fallbacks (auto, free-first):
  1. Exa free MCP (no key needed)
  2. Brave (free tier credits)
  3. Gemini browser cookies (free)
  4. Gemini API (uses key credits)
  5. Perplexity (uses key credits)

Usage:
  search web <query...> [--provider auto|exa|brave|perplexity|gemini] [--hq] [--json] [--verbose]

Flags:
  --hq    use Exa paid API for higher quality (answer synthesis, highlights)

Examples:
  search web bun sqlite wasm
  search web ai evals --provider brave
  search web react compiler --hq --json
  search web sqlite wasm --provider gemini --json

JSON:
  - answer
  - results[]
  - provider
  - requestedProvider
  - native backend payload
`;

export const CODE_HELP = `search code — code context search

What it does:
  remote: gets code context from Exa Context API + Context7 + DeepWiki
  repo:   deep search inside a repo or local directory

Usage:
  search code <query...> [--max-tokens N] [--json] [--verbose]
  search code repo <owner/repo|path> <query> [--json] [--verbose]

Examples:
  search code "react suspense cache"
  search code "facebook/react hooks" --json
  search code repo facebook/react "useEffect cleanup"
  search code repo . "auth middleware" --json
  search code repo ~/dev/myproject "database connection"

JSON (remote):
  - text (merged primary + secondary)
  - native (exa-context-api or exa-mcp)
  - secondary[] (context7 and/or deepwiki)

JSON (deep search):
  - target, query, localPath
  - matches[] (file, line, text)
  - truncated
`;

export const DOCS_HELP = `search docs — local docs search

What it does:
  searches local markdown/doc collections via qmd

Usage:
  search docs <query...> [--json] [--verbose]
  search docs index add <path> --name <name> [--pattern <glob>] [--json]
  search docs index list [--json]
  search docs index update [--json]
  search docs index embed [--json]
  search docs index status [--json]

Examples:
  search docs auth flow
  search docs index add ./docs --name project-docs
  search docs index update
  search docs index status --json

JSON:
  - results[]
  - raw qmd results
  - index status for index subcommands
`;

export const FETCH_HELP = `search fetch — readable page fetch

What it does:
  fetches a URL and extracts readable content
  handles GitHub repos and PDFs specially

Usage:
  search fetch <url> [--json] [--verbose]
  search fetch-content <url> [--json] [--verbose]

Examples:
  search fetch https://clig.dev
  search fetch https://clig.dev --json
  search fetch https://github.com/tobi/qmd --json
  search fetch https://arxiv.org/pdf/1706.03762.pdf --json

Notes:
  - prefer search fetch
  - search fetch-content remains the canonical command name for skills/docs references

JSON:
  - url
  - title
  - content
  - error
`;

export const HISTORY_HELP = `search history — prior runs

Usage:
  search history [web|code|fetch|docs] [--json]

Examples:
  search history
  search history docs --json

JSON:
  - entries[]
  - count
  - kind
`;

export const INSPECT_HELP = `search inspect — diagnostics

Usage:
  search inspect tools [--json] [--verbose]

Examples:
  search inspect tools
  search inspect tools --json
  search inspect tools --verbose

JSON:
  - providers
  - secretResolution (redacted source only)
  - geminiWeb profile diagnostics
  - github/gh availability
  - docs backend/db
  - code backend
  - runtime
`;
