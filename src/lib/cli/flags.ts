/**
 * Schema-driven CLI flag parser.
 *
 * The srch CLI is a thin UI over the SDK, and is frequently driven by coding
 * agents that guess at conventional argument shapes. Agents routinely place
 * flags before the positional query (`search web --json "query"`) just as often
 * as after it (`search web "query" --json`). A naive parser that assumes every
 * `--flag` might consume the next token cannot tell a boolean flag (`--json`)
 * apart from a value flag (`--provider exa`), so it swallows the query and the
 * command fails with a confusing `Missing query`.
 *
 * This module fixes that by parsing against an explicit per-command schema:
 * boolean flags never consume a following token, value flags always do, and
 * positionals are collected regardless of where they appear. The result is an
 * order-insensitive, predictable surface with explicit errors instead of silent
 * misparsing.
 */

/** A parsed flag value. Booleans are presence flags; lists accumulate. */
export type FlagValue = string | boolean | string[];

/**
 * The kind of a flag, which determines how it is parsed:
 * - `boolean`: a presence flag (`--json`). Never consumes the next token.
 * - `string`: takes a single value (`--provider exa`). Last occurrence wins.
 * - `list`: a repeatable value flag (`--source a --source b`). Accumulates.
 */
export type FlagKind = "boolean" | "string" | "list";

/** A mapping of flag name (without the leading `--`) to its kind. */
export type FlagSchema = Record<string, FlagKind>;

/** The outcome of parsing an argument list against a {@link FlagSchema}. */
export interface ParseResult {
  /** Parsed flags. Booleans map to `true`, strings to the value, lists to an array. */
  flags: Map<string, FlagValue>;
  /** Positional arguments in the order they appeared, flags removed. */
  positionals: string[];
  /** Human-readable parse errors. Empty when parsing succeeded. */
  errors: string[];
}

const FLAG_PREFIX = "--";

/** A token is a long flag when it starts with `--` and is longer than the bare terminator. */
export function isLongFlag(token: string): boolean {
  return token.startsWith(FLAG_PREFIX) && token.length > FLAG_PREFIX.length;
}

/** Split `name=value` flag bodies into their parts. Returns `undefined` value when no `=`. */
function splitInlineValue(body: string): { name: string; inlineValue: string | undefined } {
  const eq = body.indexOf("=");
  if (eq === -1) return { name: body, inlineValue: undefined };
  return { name: body.slice(0, eq), inlineValue: body.slice(eq + 1) };
}

/** Record a parsed value, appending for `list` flags and overwriting for `string` flags. */
function assignValue(flags: Map<string, FlagValue>, name: string, kind: "string" | "list", value: string): void {
  if (kind === "string") {
    flags.set(name, value);
    return;
  }
  const existing = flags.get(name);
  if (Array.isArray(existing)) existing.push(value);
  else flags.set(name, [value]);
}

/**
 * Parse an argument list against a flag schema.
 *
 * Parsing rules:
 * - Tokens that are not long flags are collected as positionals, in order.
 * - A bare `--` terminates flag parsing; everything after it is positional.
 *   This lets callers pass queries that begin with `--`.
 * - Boolean flags set `true` and never consume the next token, so they are safe
 *   to place immediately before a positional.
 * - Value flags (`string`/`list`) accept both `--flag value` and `--flag=value`.
 *   A missing value (end of input, another flag, or the `--` terminator) is an error.
 * - Unknown flags and value-on-boolean mistakes are reported as errors rather
 *   than guessed at, giving agents precise, actionable feedback.
 *
 * The parser is total: it never throws and always returns a {@link ParseResult},
 * collecting every error so callers can surface them together.
 */
export function parseFlagArgs(args: string[], schema: FlagSchema): ParseResult {
  const flags = new Map<string, FlagValue>();
  const positionals: string[] = [];
  const errors: string[] = [];

  let i = 0;
  while (i < args.length) {
    const token = args[i];

    if (token === FLAG_PREFIX) {
      // Everything after the `--` terminator is positional, verbatim.
      positionals.push(...args.slice(i + 1));
      break;
    }

    if (!isLongFlag(token)) {
      positionals.push(token);
      i += 1;
      continue;
    }

    const { name, inlineValue } = splitInlineValue(token.slice(FLAG_PREFIX.length));
    const kind = schema[name];

    if (kind === undefined) {
      errors.push(`Unknown flag --${name}`);
      i += 1;
      continue;
    }

    if (kind === "boolean") {
      if (inlineValue !== undefined) errors.push(`Flag --${name} does not take a value`);
      else flags.set(name, true);
      i += 1;
      continue;
    }

    // Value flag: prefer an inline `=value`, otherwise consume the next token.
    if (inlineValue !== undefined) {
      assignValue(flags, name, kind, inlineValue);
      i += 1;
      continue;
    }

    const next = args[i + 1];
    if (next === undefined || next === FLAG_PREFIX || isLongFlag(next)) {
      errors.push(`Missing value for --${name}`);
      i += 1;
      continue;
    }

    assignValue(flags, name, kind, next);
    i += 2;
  }

  return { flags, positionals, errors };
}

/** Read a single string flag. For `list` flags, returns the last value. */
export function getStringFlag(flags: Map<string, FlagValue>, key: string): string | undefined {
  const value = flags.get(key);
  if (Array.isArray(value)) return value.at(-1);
  return typeof value === "string" ? value : undefined;
}

/** Read a repeatable flag as an array. Normalizes single string values into a one-element array. */
export function getStringFlags(flags: Map<string, FlagValue>, key: string): string[] {
  const value = flags.get(key);
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}

/** Read a string flag and coerce it to a finite number, or `undefined` when absent/invalid. */
export function getNumberFlag(flags: Map<string, FlagValue>, key: string): number | undefined {
  const value = getStringFlag(flags, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}