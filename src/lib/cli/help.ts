export const ROOT_HELP = `search — programmable retrieval engine

Domain-first grammar:
  search <domain> [subdomain] [strategy] [target] <query-or-task>

Domains:
  web            web retrieval
  code           code retrieval
  docs           local docs retrieval
  flights        live cash fare search via Duffel
  rewards-flights award travel search via Seats.aero
  social         social retrieval spaces
  fetch          readable URL fetch
  ask            cross-domain retrieval
  twitter        legacy X/Twitter command
  x.com          alias for twitter
  install        install optional domain dependencies
  history        inspect prior runs
  inspect        inspect backends/config
  config         safe config management
  help           show help

Examples:
  search web bun sqlite wasm
  search code repo facebook/react "useEffect cleanup"
  search flights LHR BCN 2026-06-15
  search rewards-flights JFK CDG --date 2026-07-01 --cabin business
  search install flights
  search social x "bun runtime"
  search ask compare "best state management for a docs-heavy react app"
  search fetch https://clig.dev
  search inspect tools --json

Output:
  --json          stable structured output
  --verbose       trace view on stderr
  --out <path>    persist final output to a file

Next help:
  search web --help
  search code --help
  search docs --help
  search flights --help
  search rewards-flights --help
  search install --help
  search social --help
  search config --help
`;

export const REWARDS_FLIGHTS_HELP = `search rewards-flights — award travel search via Seats.aero

What it does:
  searches cached award availability by airport pair and loyalty program
  browses monitored award routes for a mileage program
  fetches trip-level details for a specific availability result

Setup:
  search config set-secret-ref seatsAeroApiKey op 'op://agent-dev/Seats Aero/API Key'

Manual fallback:
  export SEATS_AERO_API_KEY=pro_xxx

Usage:
  search rewards-flights <origin> <destination> [flags]
  search rewards-flights search <origin> <destination> [flags]
  search rewards-flights routes <source>
  search rewards-flights trips <availability_id> [--include-filtered]
  search rewards-flights auth [status|instructions|set|clear]

Search flags:
  --date <YYYY-MM-DD>         search a single departure date
  --start-date <YYYY-MM-DD>   start of date range
  --end-date <YYYY-MM-DD>     end of date range
  --cabin <economy|premium|business|first>
  --source <program>          repeatable mileage program filter
  --carrier <AA>              repeatable carrier filter
  --direct                    only show direct award options
  --take <n>                  max results (10-1000)
  --skip <n>                  skip results for pagination
  --order-by <lowest_mileage> sort by cheapest mileage first
  --include-trips             include trip-level details in search results
  --include-filtered          include filtered dynamic pricing

Examples:
  search rewards-flights JFK CDG --date 2026-07-01 --cabin business --source flyingblue
  search rewards-flights search SFO HND --start-date 2026-10-01 --end-date 2026-10-10 --cabin first --direct --json
  search rewards-flights routes aeroplan
  search rewards-flights trips avail_123 --json
  search rewards-flights auth instructions
  search rewards-flights auth set pro_xxx

Notes:
  - Seats.aero cached search can lag live airline inventory
  - Seats.aero Live Search API is commercial-only; srch uses the cached endpoints
  - verify award space before transferring points or miles
`;

export const INSTALL_HELP = `search install — install optional domain dependencies

What it does:
  installs optional backends and local runtimes for selected srch domains

Usage:
  search install flights [--global] [--dry-run] [--json]
  search install all [--global] [--dry-run] [--json]

Targets:
  flights   no-op (Duffel is built in; only API token setup is required)
  all       install every current optional domain dependency

Flags:
  --global   install npm packages globally when srch is globally installed
  --dry-run  print the plan without executing it

Examples:
  search install flights
  search install flights --dry-run --json
  search install all
  search install all --global

Notes:
  - flights uses built-in Duffel SDK and only needs DUFFEL_ACCESS_TOKEN configured
  - use this instead of remembering the individual setup commands
`;

export const FLIGHTS_HELP = `search flights — live cash fare search via Duffel

What it does:
  searches live fares through Duffel offer requests
  supports airport/city suggestions via Duffel places
  enforces returned cabin matching so business/first searches stay trustworthy

Setup:
  search config set-secret-ref duffelAccessToken op 'op://agent-dev/Duffel/access token'

Manual fallback:
  export DUFFEL_ACCESS_TOKEN=dfl_test_xxx

Usage:
  search flights <origin> <destination> <date> [flags]
  search flights search <origin> <destination> <date> [flags]
  search flights resolve <query...>

Search flags:
  --return <date>            return date YYYY-MM-DD
  --adults <n>               adult passengers
  --children <n>             child passengers
  --infants <n>              infant passengers
  --cabin <M|W|C|F>          cabin class
  --max-stopovers <n>        maximum stopovers
  --currency <code>          fare currency
  --limit <n>                max offers returned
  --sort <price|duration>    offer sort order

Examples:
  search flights LHR BCN 2026-06-15
  search flights search LON BCN 2026-06-15 --return 2026-06-22 --cabin C --sort price --json
  search flights resolve "berlin"

Notes:
  - Duffel offers free signup and test mode access
  - production pricing is commercial and not clearly public in Duffel docs
  - srch filters returned offers by actual cabin when you pass --cabin
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
  search web <query...> [--provider auto|exa|brave|perplexity|gemini] [--hq] [--json] [--verbose] [--out <path>]

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
  search code <query...> [--max-tokens N] [--json] [--verbose] [--out <path>]
  search code repo <owner/repo|path> <query> [--json] [--verbose] [--out <path>]

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
  search docs <query...> [--json] [--verbose] [--out <path>]
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
  search fetch <url> [--json] [--verbose] [--out <path>]
  search fetch-content <url> [--json] [--verbose] [--out <path>]

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
  search history [web|code|fetch|docs|flights|rewards-flights] [--json]

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
