import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getStateDir } from "../core/state.js";

export interface HistoryEntry {
  id: string;
  kind: "web" | "code" | "fetch" | "docs" | "flights" | "rewards-flights";
  createdAt: string;
  input: unknown;
  output: unknown;
}

function readAll(): HistoryEntry[] {
  const historyPath = join(getStateDir(), "history.json");
  if (!existsSync(historyPath)) return [];
  try {
    return JSON.parse(readFileSync(historyPath, "utf8")) as HistoryEntry[];
  } catch {
    return [];
  }
}

function writeAll(entries: HistoryEntry[]): void {
  const stateDir = getStateDir();
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "history.json"), JSON.stringify(entries, null, 2) + "\n");
}

export function addHistory(entry: Omit<HistoryEntry, "id" | "createdAt">): HistoryEntry {
  const next: HistoryEntry = {
    ...entry,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString()
  };
  const entries = readAll();
  entries.unshift(next);
  writeAll(entries.slice(0, 200));
  return next;
}

export function listHistory(kind?: HistoryEntry["kind"]): HistoryEntry[] {
  const entries = readAll();
  return kind ? entries.filter((entry) => entry.kind === kind) : entries;
}
