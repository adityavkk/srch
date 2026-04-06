import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SearchProvider } from "./types.js";

export interface SearchConfig {
  provider?: SearchProvider;
  exaApiKey?: string;
  perplexityApiKey?: string;
  geminiApiKey?: string;
}

const CONFIG_DIR = join(homedir(), ".search");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadConfig(): SearchConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  const raw = readFileSync(CONFIG_PATH, "utf8");
  try {
    return JSON.parse(raw) as SearchConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
  }
}

export function saveConfig(next: SearchConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n");
}
