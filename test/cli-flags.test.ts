import assert from "node:assert/strict";
import test from "node:test";

import { getNumberFlag, getStringFlag, getStringFlags, parseFlagArgs, type FlagSchema } from "../src/lib/cli/flags.js";
import { schemaForCommand, splitCommand } from "../src/lib/cli/flag-specs.js";

const WEB_SCHEMA: FlagSchema = schemaForCommand("web");

test("parseFlagArgs: boolean flag before positional does not swallow the query", () => {
  const { flags, positionals, errors } = parseFlagArgs(["--json", "react compiler"], WEB_SCHEMA);
  assert.deepEqual(errors, []);
  assert.deepEqual(positionals, ["react compiler"]);
  assert.equal(flags.get("json"), true);
});

test("parseFlagArgs: boolean flag after positional parses equivalently", () => {
  const before = parseFlagArgs(["--json", "react compiler"], WEB_SCHEMA);
  const after = parseFlagArgs(["react compiler", "--json"], WEB_SCHEMA);
  assert.deepEqual(after.positionals, before.positionals);
  assert.equal(after.flags.get("json"), before.flags.get("json"));
  assert.deepEqual(after.errors, []);
});

test("parseFlagArgs: value flags accept both `--flag value` and `--flag=value`", () => {
  const spaced = parseFlagArgs(["--provider", "exa", "q"], WEB_SCHEMA);
  const inline = parseFlagArgs(["--provider=exa", "q"], WEB_SCHEMA);
  assert.equal(getStringFlag(spaced.flags, "provider"), "exa");
  assert.equal(getStringFlag(inline.flags, "provider"), "exa");
  assert.deepEqual(spaced.positionals, ["q"]);
  assert.deepEqual(inline.positionals, ["q"]);
});

test("parseFlagArgs: a value flag before the query keeps the query positional", () => {
  const { flags, positionals, errors } = parseFlagArgs(["--provider", "brave", "react compiler"], WEB_SCHEMA);
  assert.deepEqual(errors, []);
  assert.equal(getStringFlag(flags, "provider"), "brave");
  assert.deepEqual(positionals, ["react compiler"]);
});

test("parseFlagArgs: missing value for a value flag is an explicit error", () => {
  const { errors } = parseFlagArgs(["--out", "--json", "q"], WEB_SCHEMA);
  assert.deepEqual(errors, ["Missing value for --out"]);
});

test("parseFlagArgs: unknown flags are reported, not silently consumed", () => {
  const { flags, positionals, errors } = parseFlagArgs(["--bogus", "q"], WEB_SCHEMA);
  assert.deepEqual(errors, ["Unknown flag --bogus"]);
  // The trailing positional is still preserved so the error is the only problem reported.
  assert.deepEqual(positionals, ["q"]);
  assert.equal(flags.has("bogus"), false);
});

test("parseFlagArgs: a value passed to a boolean flag is an error", () => {
  const { errors } = parseFlagArgs(["--json=true", "q"], WEB_SCHEMA);
  assert.deepEqual(errors, ["Flag --json does not take a value"]);
});

test("parseFlagArgs: `--` terminator treats the remainder as positionals", () => {
  const { flags, positionals, errors } = parseFlagArgs(["--json", "--", "--not-a-flag", "tail"], WEB_SCHEMA);
  assert.deepEqual(errors, []);
  assert.equal(flags.get("json"), true);
  assert.deepEqual(positionals, ["--not-a-flag", "tail"]);
});

test("parseFlagArgs: repeatable list flags accumulate while string flags overwrite", () => {
  const schema = schemaForCommand("rewards-flights");
  const { flags } = parseFlagArgs(["--source", "flyingblue", "--source", "aeroplan", "--date", "2026-07-01"], schema);
  assert.deepEqual(getStringFlags(flags, "source"), ["flyingblue", "aeroplan"]);
  assert.equal(getStringFlag(flags, "date"), "2026-07-01");
});

test("getNumberFlag coerces numeric strings and ignores invalid values", () => {
  const { flags } = parseFlagArgs(["--adults", "4", "--children", "x"], schemaForCommand("flights"));
  assert.equal(getNumberFlag(flags, "adults"), 4);
  assert.equal(getNumberFlag(flags, "children"), undefined);
});

test("splitCommand: command first leaves the rest untouched", () => {
  const { command, rest } = splitCommand(["web", "--json", "react compiler"]);
  assert.equal(command, "web");
  assert.deepEqual(rest, ["--json", "react compiler"]);
});

test("splitCommand: a leading global boolean flag still resolves the command", () => {
  const { command, rest } = splitCommand(["--json", "web", "react compiler"]);
  assert.equal(command, "web");
  assert.deepEqual(rest, ["--json", "react compiler"]);
});

test("splitCommand: a leading global value flag carries its value past the command scan", () => {
  const { command, rest } = splitCommand(["--out", "results.json", "web", "react compiler"]);
  assert.equal(command, "web");
  assert.deepEqual(rest, ["--out", "results.json", "react compiler"]);
});

test("splitCommand: a command-specific flag is left for the per-command parse", () => {
  // `--provider` is not global, so the value following it stays in rest and the
  // first bare token (`web`) is still correctly identified as the command.
  const { command, rest } = splitCommand(["web", "--provider", "exa", "q"]);
  assert.equal(command, "web");
  assert.deepEqual(rest, ["--provider", "exa", "q"]);
});

test("schemaForCommand merges global flags with command-specific flags", () => {
  const schema = schemaForCommand("web");
  assert.equal(schema.json, "boolean");
  assert.equal(schema.out, "string");
  assert.equal(schema.provider, "string");
  assert.equal(schema.hq, "boolean");
});

test("schemaForCommand falls back to global flags for unknown commands", () => {
  const schema = schemaForCommand("not-a-command");
  assert.deepEqual(Object.keys(schema).sort(), ["help", "json", "out", "verbose"]);
});