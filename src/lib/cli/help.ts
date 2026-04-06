export const ROOT_HELP = `search — web, code, content

Usage:
  search <command> [args]

Commands:
  web           search web
  code          search code/docs
  fetch-content fetch URL content
  history       inspect prior runs
  config        inspect config path
  help          show help

Examples:
  search web bun sqlite wasm
  search code "react suspense cache"
  search fetch-content https://clig.dev
  search history

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

Examples:
  search web bun package manager
  search web llm evals --provider perplexity
`;

export const CODE_HELP = `search code — search code/docs

Usage:
  search code <query...> [--max-tokens N] [--json]

Examples:
  search code react suspense cache
  search code "sqlite wal checkpoint" --max-tokens 8000
`;

export const FETCH_HELP = `search fetch-content — fetch readable page content

Usage:
  search fetch-content <url> [--json]

Examples:
  search fetch-content https://clig.dev
`;

export const HISTORY_HELP = `search history — inspect prior runs

Usage:
  search history [web|code|fetch] [--json]
`;
