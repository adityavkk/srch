import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getConfigPath, loadConfig, type SecretField, type SearchConfig } from "./config.js";

const execFileAsync = promisify(execFile);
const cache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;
let cacheGeneration = 0;

/** Invalidate cached external-store credentials after rotating a key. */
export function clearSecretCache(): void {
  cacheGeneration++;
  cache.clear();
}

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

async function readFnox(key: string, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted();
  try {
    const { stdout } = await execFileAsync("fnox", ["get", key], { timeout: 15_000, maxBuffer: 1024 * 64, signal });
    signal?.throwIfAborted();
    const value = stdout.trim();
    return value || null;
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

async function readOp(path: string, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted();
  try {
    const { stdout } = await execFileAsync("op", ["read", path], { timeout: 15_000, maxBuffer: 1024 * 64, signal });
    signal?.throwIfAborted();
    const value = stdout.trim();
    return value || null;
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

export async function resolveSecret(field: SecretField, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted();
  const envKey = FALLBACK_ENV_KEYS[field];
  const envValue = process.env[envKey]?.trim();
  if (envValue) return envValue;

  const config = loadConfig();
  const configValue = config[field]?.trim();
  if (configValue) return configValue;

  const ref = config.secrets?.[field];
  const source = ref?.key && (ref.source === "fnox" || ref.source === "op") ? ref.source : "fnox";
  const key = ref?.key && (ref.source === "fnox" || ref.source === "op") ? ref.key : envKey;
  const cacheKey = JSON.stringify([getConfigPath(), process.cwd(), field, source, key]);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const generation = cacheGeneration;
  const value = await (source === "op" ? readOp(key, signal) : readFnox(key, signal));
  signal?.throwIfAborted();
  // Missing credentials must be retried, and environment/config values stay fresh.
  cache.delete(cacheKey);
  if (value && generation === cacheGeneration) {
    for (const [entry, cachedValue] of cache) {
      if (cachedValue.expiresAt <= Date.now()) cache.delete(entry);
    }
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return value;
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
