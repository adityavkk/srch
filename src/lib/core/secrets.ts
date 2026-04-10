import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig, type SecretField, type SearchConfig } from "./config.js";

const execFileAsync = promisify(execFile);
const cache = new Map<SecretField, string | null>();

const FALLBACK_ENV_KEYS: Record<SecretField, string> = {
  exaApiKey: "EXA_API_KEY",
  perplexityApiKey: "PERPLEXITY_API_KEY",
  geminiApiKey: "GEMINI_API_KEY",
  braveApiKey: "BRAVE_API_KEY",
  seatsAeroApiKey: "SEATS_AERO_API_KEY"
};

export interface SecretResolution {
  field: SecretField;
  source: "env" | "config" | "config:fnox" | "config:op" | "fnox" | "missing";
  keyName?: string;
  configured: boolean;
}

async function readFnox(key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("fnox", ["get", key], { timeout: 15_000, maxBuffer: 1024 * 64 });
    const value = stdout.trim();
    return value || null;
  } catch {
    return null;
  }
}

async function readOp(path: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("op", ["read", path], { timeout: 15_000, maxBuffer: 1024 * 64 });
    const value = stdout.trim();
    return value || null;
  } catch {
    return null;
  }
}

export async function resolveSecret(field: SecretField): Promise<string | null> {
  if (cache.has(field)) return cache.get(field) ?? null;
  const config = loadConfig();
  const envKey = FALLBACK_ENV_KEYS[field];

  const envValue = process.env[envKey]?.trim();
  if (envValue) {
    cache.set(field, envValue);
    return envValue;
  }

  const configValue = config[field]?.trim();
  if (configValue) {
    cache.set(field, configValue);
    return configValue;
  }

  const ref = config.secrets?.[field];
  if (ref?.source === "fnox" && ref.key) {
    const value = await readFnox(ref.key);
    cache.set(field, value);
    return value;
  }
  if (ref?.source === "op" && ref.key) {
    const value = await readOp(ref.key);
    cache.set(field, value);
    return value;
  }

  const fallbackValue = await readFnox(envKey);
  cache.set(field, fallbackValue);
  return fallbackValue;
}

export async function inspectSecretSources(config?: SearchConfig): Promise<Record<SecretField, SecretResolution>> {
  const resolvedConfig = config ?? loadConfig();
  const out = {} as Record<SecretField, SecretResolution>;

  for (const field of Object.keys(FALLBACK_ENV_KEYS) as SecretField[]) {
    const envKey = FALLBACK_ENV_KEYS[field];
    if (process.env[envKey]?.trim()) {
      out[field] = { field, source: "env", keyName: envKey, configured: true };
      continue;
    }
    if (resolvedConfig[field]?.trim()) {
      out[field] = { field, source: "config", configured: true };
      continue;
    }
    const ref = resolvedConfig.secrets?.[field];
    if (ref?.source === "fnox" && ref.key) {
      const value = await readFnox(ref.key);
      out[field] = { field, source: "config:fnox", keyName: ref.key, configured: !!value };
      continue;
    }
    if (ref?.source === "op" && ref.key) {
      const value = await readOp(ref.key);
      out[field] = { field, source: "config:op", keyName: ref.key, configured: !!value };
      continue;
    }
    const fallbackValue = await readFnox(envKey);
    out[field] = { field, source: fallbackValue ? "fnox" : "missing", keyName: envKey, configured: !!fallbackValue };
  }

  return out;
}
