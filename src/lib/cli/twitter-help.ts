export const TWITTER_HELP = `search twitter -- search/read X (Twitter)

What it does:
  searches tweets or reads a specific tweet/thread via bird CLI
  requires bird CLI installed and authenticated

Usage:
  search twitter <query...> [--count N] [--json] [--verbose]
  search twitter read <tweet-id-or-url> [--json]
  search twitter thread <tweet-id-or-url> [--json]
  search x.com <query...> [--count N] [--json] [--verbose]

Examples:
  search twitter "bun runtime"
  search twitter "from:toaborevol" --json
  search twitter read https://x.com/toaborevol/status/123456
  search twitter thread https://x.com/toaborevol/status/123456 --json
  search x.com "react compiler" --count 20

JSON:
  - query or id
  - tweets[]
  - native bird payload
`;
