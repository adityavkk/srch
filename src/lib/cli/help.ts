export const ROOT_HELP = `search — local-first research CLI

Use for:
  web research, code context, local docs, content fetch

Usage:
  search <command> [args]

Commands:
  web            search web with citations
  code           search code/docs context
  docs           search local docs via qmd
  fetch-content  fetch readable URL content
  history        inspect prior runs
  inspect        inspect backends/config
  config         show config path
  help           show help

Examples:
  search web bun sqlite wasm
  search code "react suspense cache"
  search docs auth flow
  search fetch-content https://clig.dev
  search inspect tools --json

Output:
  --json      stable structured output
  --verbose   trace view on stderr

Next help:
  search web --help
  search code --help
  search docs --help
`;

export const WEB_HELP = `search web — web research

What it does:
  searches web backends, returns answer + sources

Usage:
  search web <query...> [--provider auto|exa|perplexity|gemini] [--json] [--verbose]

Examples:
  search web bun sqlite wasm
  search web ai evals --provider perplexity
  search web react compiler --json

JSON:
  - answer
  - results[]
  - provider
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

export const FETCH_HELP = `search fetch-content — readable page fetch

What it does:
  fetches a URL and extracts readable content

Usage:
  search fetch-content <url> [--json] [--verbose]

Examples:
  search fetch-content https://clig.dev
  search fetch-content https://clig.dev --json

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
  - docs backend/db
  - code backend
  - runtime
`;
