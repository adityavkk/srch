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
  search web bun sqlite wasm
  search code "react suspense cache"
  search docs auth flow
  search fetch-content https://clig.dev

Tips:
  - add --help anywhere
  - default output: short, agent-friendly
  - use --json for structured output
`;

export const WEB_HELP = `search web — search web

Usage:
  search web <query...> [--provider auto|exa|perplexity|gemini] [--json]

Notes:
  - auto prefers exa
  - terse by default
  - citations preserved
`;

export const CODE_HELP = `search code — search code/docs

Usage:
  search code <query...> [--max-tokens N] [--json]

Notes:
  - current backend: exa mcp
  - local colgrep deferred
`;

export const DOCS_HELP = `search docs — local docs via qmd

Usage:
  search docs <query...> [--json]
  search docs index add <path> --name <name> [--pattern <glob>]
  search docs index list [--json]
  search docs index update [--json]
  search docs index embed [--json]
  search docs index status [--json]

Examples:
  search docs auth flow
  search docs index add ./docs --name project-docs
  search docs index update
`;

export const FETCH_HELP = `search fetch-content — fetch readable page content

Usage:
  search fetch-content <url> [--json]
`;

export const HISTORY_HELP = `search history — inspect prior runs

Usage:
  search history [web|code|fetch|docs] [--json]
`;

export const INSPECT_HELP = `search inspect — inspect backends/config

Usage:
  search inspect tools [--json]

Notes:
  - no side effects
  - for debugging agent environment
`;
