import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fail, ok } from "./output.js";
import type { EmitOptions } from "./result.js";
import type { CliSuccessResult } from "./result.js";

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function writeOutputFile(path: string, content: string): string {
  const resolvedPath = resolve(path);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, content);
  return resolvedPath;
}

export function emitSuccess(result: CliSuccessResult, options: EmitOptions): void {
  if (options.asJson) {
    const data = options.outPath ? { ...(result.data as Record<string, unknown>), savedTo: resolve(options.outPath) } : result.data;
    const payload = ensureTrailingNewline(JSON.stringify(ok(result.command, data), null, 2));
    process.stdout.write(payload);
    if (options.outPath) writeOutputFile(options.outPath, payload);
    return;
  }

  const payload = ensureTrailingNewline(result.text);
  process.stdout.write(payload);
  if (options.outPath) writeOutputFile(options.outPath, payload);
}

export function emitFailure(command: string[], message: string, options: EmitOptions): never {
  const payload = options.asJson
    ? ensureTrailingNewline(JSON.stringify(fail(command, message), null, 2))
    : ensureTrailingNewline(message);
  process.stderr.write(payload);
  process.exit(1);
}
