import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getStateDir } from "./state.js";
import type { SearchProvider, WebProvider } from "./types.js";

export type SecretField = "exaApiKey" | "perplexityApiKey" | "geminiApiKey" | "braveApiKey" | "seatsAeroApiKey";
export type SecretSource = "fnox" | "op";

export interface SecretRef {
  source: SecretSource;
  key: string;
}

export interface SearchConfig {
  provider?: SearchProvider;
  /** Automatic web provider order. Omitted means the built-in default. */
  webProviders?: WebProvider[];
  exaApiKey?: string;
  perplexityApiKey?: string;
  geminiApiKey?: string;
  braveApiKey?: string;
  seatsAeroApiKey?: string;
  secrets?: Partial<Record<SecretField, SecretRef>>;
}

export function getConfigPath(): string {
  return join(getStateDir(), "config.json");
}

export function ensureConfigDir(): void {
  mkdirSync(getStateDir(), { recursive: true });
}

export function loadConfig(): SearchConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return {};
  const raw = readFileSync(configPath, "utf8");
  try {
    return JSON.parse(raw) as SearchConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${configPath}: ${message}`);
  }
}

export function saveConfig(next: SearchConfig): void {
  ensureConfigDir();
  writeFileSync(getConfigPath(), JSON.stringify(next, null, 2) + "\n");
}
