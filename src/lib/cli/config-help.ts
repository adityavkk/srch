export const CONFIG_HELP = `search config — safe config management

Usage:
  search config [--json]
  search config set provider <auto|exa|perplexity|gemini> [--json]
  search config set-secret-ref <exaApiKey|perplexityApiKey|geminiApiKey> fnox <KEY_NAME> [--json]
  search config unset <field> [--json]

Examples:
  search config --json
  search config set provider exa
  search config set-secret-ref exaApiKey fnox EXA_API_KEY
  search config set-secret-ref perplexityApiKey fnox PERPLEXITY_API_KEY
  search config unset exaApiKey

Notes:
  - runtime resolves env first
  - then config plaintext if present
  - then config secret refs
  - then implicit fnox fallback by conventional env key name
  - no secret values are printed
`;
