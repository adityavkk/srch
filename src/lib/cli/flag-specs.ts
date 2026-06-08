/**
 * Per-command flag schemas for the srch CLI.
 *
 * Each command declares exactly which flags it understands and whether each is a
 * boolean, single-value, or repeatable-value flag. The parser ({@link parseFlagArgs})
 * uses these schemas to collect positionals and flags regardless of order, so an
 * agent can write `search web --json "query"` or `search web "query" --json` and
 * get identical results.
 *
 * Schemas are intentionally explicit rather than inferred: unknown flags become
 * actionable errors, and the declared kind disambiguates booleans from value
 * flags so a boolean can safely sit immediately before the positional query.
 */

import { isLongFlag, type FlagSchema } from "./flags.js";

/**
 * Flags understood by every command. These are the output/control flags an agent
 * is most likely to reorder, and the only flags permitted *before* the command
 * name (e.g. `search --json web "query"`).
 */
export const GLOBAL_FLAGS: FlagSchema = {
  json: "boolean",
  verbose: "boolean",
  help: "boolean",
  out: "string"
};

/**
 * Command-specific flags, keyed by the command token the user types. Aliases
 * (e.g. `fetch`/`fetch-content`) are listed separately so each invocation name
 * resolves directly. The global flags above are merged in by {@link schemaForCommand}.
 */
const COMMAND_FLAGS: Record<string, FlagSchema> = {
  web: {
    provider: "string",
    hq: "boolean"
  },
  code: {
    "max-tokens": "string"
  },
  docs: {
    name: "string",
    pattern: "string"
  },
  fetch: {
    "download-images": "string",
    "describe-images": "boolean"
  },
  "fetch-content": {
    "download-images": "string",
    "describe-images": "boolean"
  },
  social: {
    count: "string"
  },
  twitter: {
    count: "string"
  },
  "x.com": {
    count: "string"
  },
  flights: {
    return: "string",
    "return-date": "string",
    adults: "string",
    children: "string",
    infants: "string",
    cabin: "string",
    "max-stopovers": "string",
    currency: "string",
    limit: "string",
    sort: "string"
  },
  "rewards-flights": {
    date: "string",
    "start-date": "string",
    "end-date": "string",
    cabin: "list",
    source: "list",
    carrier: "list",
    direct: "boolean",
    "min-seats": "string",
    "include-zero-seats": "boolean",
    take: "string",
    skip: "string",
    "order-by": "string",
    "include-trips": "boolean",
    "include-filtered": "boolean",
    key: "string"
  },
  install: {
    global: "boolean",
    "dry-run": "boolean",
    marker: "string"
  },
  hooks: {
    marker: "string"
  },
  config: {},
  inspect: {},
  history: {}
};

/**
 * Build the full flag schema for a command by merging the global flags with the
 * command-specific flags. Unknown commands still get the global flags so that
 * `--json`/`--help` keep working and the dispatcher can emit a proper
 * "Unknown command" error instead of a parse failure.
 */
export function schemaForCommand(command: string | undefined): FlagSchema {
  const specific = command ? COMMAND_FLAGS[command] : undefined;
  return { ...GLOBAL_FLAGS, ...(specific ?? {}) };
}

/** The command name and the remaining args after global-flag extraction. */
export interface CommandSplit {
  /** The resolved command token, or `undefined` when only flags were supplied. */
  command: string | undefined;
  /** Remaining args (global flags preserved) to parse against the command schema. */
  rest: string[];
}

/**
 * Separate the command token from the rest of the args, tolerating global flags
 * placed before the command.
 *
 * Coding agents often emit `search --json web "query"`. To support that, we scan
 * for the first positional token and treat it as the command, while carrying any
 * leading global flags (and their values) into `rest` so they parse normally
 * against the command schema afterwards.
 *
 * Only {@link GLOBAL_FLAGS} are recognized before the command: command-specific
 * value flags cannot be resolved until the command is known, so they are left
 * for the per-command parse and surfaced as ordinary positionals/errors there.
 * A bare `--` terminator forces the next token to be treated as the command.
 */
export function splitCommand(argv: string[]): CommandSplit {
  let command: string | undefined;
  const rest: string[] = [];
  let terminated = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (command !== undefined) {
      // Command already found: everything else belongs to the per-command parse.
      rest.push(token);
      continue;
    }

    if (!terminated && token === "--") {
      // The token immediately after `--` is the command, taken verbatim.
      terminated = true;
      const next = argv[i + 1];
      if (next !== undefined) {
        command = next;
        i += 1;
      }
      continue;
    }

    if (!terminated && isLongFlag(token)) {
      const body = token.slice(2);
      const name = body.includes("=") ? body.slice(0, body.indexOf("=")) : body;
      const hasInlineValue = body.includes("=");
      rest.push(token);
      // Carry the value of a leading global value-flag so it is not mistaken
      // for the command (e.g. `--out path web` must not treat `path` as command).
      if (!hasInlineValue && GLOBAL_FLAGS[name] === "string") {
        const value = argv[i + 1];
        if (value !== undefined && value !== "--" && !isLongFlag(value)) {
          rest.push(value);
          i += 1;
        }
      }
      continue;
    }

    command = token;
  }

  return { command, rest };
}