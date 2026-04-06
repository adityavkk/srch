export const ROOT_HELP = `search — local-first research CLI

Use for:
  web research, code context, local docs, content fetch

Usage:
  search <command> [args]

Commands:
  web            search web with citations
  code           search code/docs context
  docs           search local docs via qmd
  fetch          fetch readable URL content
  fetch-content  canonical fetch command
  history        inspect prior runs
  inspect        inspect backends/config
  config         safe config management
  help           show help

Examples:
  search web bun sqlite wasm
  search code "react suspense cache"
  search docs auth flow
  search fetch https://clig.dev
  search inspect tools --json

Output:
  --json      stable structured output
  --verbose   trace view on stderr

Next help:
  search web --help
  search code --help
  search docs --help
  search config --help
`;

export const WEB_HELP = `search web — web research

What it does:
  searches web backends, returns answer + sources

Fallbacks:
  exa -> brave -> perplexity -> gemini

Usage:
  search web <query...> [--provider auto|exa|brave|perplexity|gemini] [--json] [--verbose]

Examples:
  search web bun sqlite wasm
  search web ai evals --provider perplexity
  search web privacy search api --provider brave
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
  gets code/docs context from Exa MCP
  may attach DeepWiki as a secondary source for public repos

Usage:
  search code <query...> [--max-tokens N] [--json] [--verbose]

Examples:
  search code "react suspense cache"
  search code "facebook/react hooks" --json
  search code "sqlite wal checkpoint" --max-tokens 8000

JSON:
  - query
  - maxTokens
  - text
  - native exa payload
  - optional secondary.deepwiki
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
