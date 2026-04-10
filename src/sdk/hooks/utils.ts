import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function homePath(...parts: string[]): string {
  return join(homedir(), ...parts);
}

export function ensureParent(path: string): void {
  mkdirSync(path.replace(/\/[^/]+$/, ""), { recursive: true });
}

export function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function removeFile(path: string): void {
  rmSync(path, { force: true });
}

export function commandString(command: string): string {
  return command;
}
