export const CONFIG_HELP = `search config — safe config management

Usage:
  search config [--json]
  search config set provider <auto|exa|perplexity|gemini> [--json]
  search config set-secret <exaApiKey|perplexityApiKey|geminiApiKey> (--from-env NAME | --from-file PATH | --stdin) [--json]
  search config unset <field> [--json]

Examples:
  search config --json
  search config set provider exa
  search config set-secret exaApiKey --from-env EXA_API_KEY
  fnox exec -- search config set-secret perplexityApiKey --from-env PERPLEXITY_API_KEY
  op read op://vault/item/field | search config set-secret geminiApiKey --stdin
  search config unset exaApiKey

Safety:
  - never echoes secret values
  - json output redacts secrets as [set]
  - prefer fnox/env injection over plaintext files
`;
