export const ROOT_HELP = `search — web, code, docs, content

Usage:
  search <command> [args]

Commands:
  web           search web
  code          search code/docs
  docs          search local docs
  fetch-content fetch URL content
  history       inspect prior runs
  inspect       inspect backends/config
  config        inspect config path
  help          show help

Examples:
  search web bun sqlite wasm --json
  search code "react suspense cache" --json
  search docs auth flow --json
  search fetch-content https://clig.dev --json
  search inspect tools --json

Tips:
  - add --help anywhere
  - default output: short, agent-friendly
  - --json returns stable envelopes
`;

export const WEB_HELP = `search web — search web

Usage:
  search web <query...> [--provider auto|exa|perplexity|gemini] [--json]

JSON:
  - answer
  - results[]
  - provider
`;

export const CODE_HELP = `search code — search code/docs

Usage:
  search code <query...> [--max-tokens N] [--json]

JSON:
  - query
  - maxTokens
  - text
`;

export const DOCS_HELP = `search docs — local docs via qmd

Usage:
  search docs <query...> [--json]
  search docs index add <path> --name <name> [--pattern <glob>] [--json]
  search docs index list [--json]
  search docs index update [--json]
  search docs index embed [--json]
  search docs index status [--json]

Examples:
  search docs auth flow --json
  search docs index add ./docs --name project-docs --json
`;

export const FETCH_HELP = `search fetch-content — fetch readable page content

Usage:
  search fetch-content <url> [--json]

JSON:
  - url
  - title
  - content
  - error
`;

export const HISTORY_HELP = `search history — inspect prior runs

Usage:
  search history [web|code|fetch|docs] [--json]

JSON:
  - entries[]
  - count
  - kind
`;

export const INSPECT_HELP = `search inspect — inspect backends/config

Usage:
  search inspect tools [--json]

JSON:
  - providers
  - docs backend/db
  - code backend
  - runtime
`;
