import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface HistoryEntry {
  id: string;
  kind: "web" | "code" | "fetch" | "docs";
  createdAt: string;
  input: unknown;
  output: unknown;
}

const HISTORY_DIR = join(homedir(), ".search");
const HISTORY_PATH = join(HISTORY_DIR, "history.json");

function readAll(): HistoryEntry[] {
  if (!existsSync(HISTORY_PATH)) return [];
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, "utf8")) as HistoryEntry[];
  } catch {
    return [];
  }
}

function writeAll(entries: HistoryEntry[]): void {
  mkdirSync(HISTORY_DIR, { recursive: true });
  writeFileSync(HISTORY_PATH, JSON.stringify(entries, null, 2) + "\n");
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
