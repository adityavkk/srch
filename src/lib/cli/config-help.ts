export const CONFIG_HELP = `search config — safe config management

Usage:
  search config [--json]
  search config set provider <auto|exa|perplexity|gemini> [--json]
  search config set-secret <exaApiKey|perplexityApiKey|geminiApiKey|braveApiKey|seatsAeroApiKey> <value> [--json]
  search config set-secret-ref <exaApiKey|perplexityApiKey|geminiApiKey|braveApiKey|seatsAeroApiKey> <fnox|op> <KEY_NAME> [--json]
  search config unset <field> [--json]

Examples:
  search config --json
  search config set provider exa
  search config set-secret seatsAeroApiKey pro_xxx
  search config set-secret-ref exaApiKey fnox EXA_API_KEY
  search config set-secret-ref exaApiKey op 'op://agent-dev/exa/API Key'
  search config set-secret-ref perplexityApiKey fnox PERPLEXITY_API_KEY
  search config set-secret-ref braveApiKey op 'op://agent-dev/Brave Search/api key'
  search config set-secret-ref seatsAeroApiKey op 'op://agent-dev/Seats Aero/API Key'
  search config unset exaApiKey

Notes:
  - runtime resolves env first
  - then config plaintext if present
  - then config secret refs
  - then implicit fnox fallback by conventional env key name
  - op refs use 1Password CLI at runtime
  - no secret values are printed
`;
