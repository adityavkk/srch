import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { stdin } from "node:process";
import { loadConfig, saveConfig, type SearchConfig } from "../core/config.js";
import type { SearchProvider } from "../core/types.js";

const SECRET_FIELDS = new Set(["exaApiKey", "perplexityApiKey", "geminiApiKey"] as const);
const PUBLIC_FIELDS = new Set(["provider"] as const);

type SecretField = "exaApiKey" | "perplexityApiKey" | "geminiApiKey";
type PublicField = "provider";

export function redactConfig(config: SearchConfig): SearchConfig {
  const copy: SearchConfig = { ...config };
  for (const field of SECRET_FIELDS) {
    if (copy[field]) copy[field] = "[set]";
  }
  return copy;
}

export function getConfigSafe() {
  return redactConfig(loadConfig());
}

export function setProvider(provider: string): SearchConfig {
  if (!["auto", "exa", "perplexity", "gemini"].includes(provider)) {
    throw new Error("Invalid provider. Use auto|exa|perplexity|gemini");
  }
  const config = loadConfig();
  config.provider = provider as SearchProvider;
  saveConfig(config);
  return redactConfig(config);
}

async function readSecretValue(flags: Map<string, string | boolean>): Promise<string> {
  const envName = flags.get("from-env");
  if (typeof envName === "string") {
    const value = process.env[envName];
    if (!value) throw new Error(`Environment variable ${envName} is empty or unset`);
    return value.trim();
  }

  const filePath = flags.get("from-file");
  if (typeof filePath === "string") {
    return readFileSync(filePath, "utf8").trim();
  }

  if (flags.has("stdin")) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8").trim();
  }

  throw new Error("No secret source. Use --from-env NAME, --from-file PATH, or --stdin");
}

export async function setSecret(field: string, flags: Map<string, string | boolean>): Promise<SearchConfig> {
  if (!SECRET_FIELDS.has(field as SecretField)) {
    throw new Error("Invalid secret field. Use exaApiKey|perplexityApiKey|geminiApiKey");
  }
  const value = await readSecretValue(flags);
  if (!value) throw new Error("Secret value is empty");
  const config = loadConfig();
  config[field as SecretField] = value;
  saveConfig(config);
  return redactConfig(config);
}

export function unsetField(field: string): SearchConfig {
  if (!SECRET_FIELDS.has(field as SecretField) && !PUBLIC_FIELDS.has(field as PublicField)) {
    throw new Error("Invalid field name");
  }
  const config = loadConfig();
  delete config[field as keyof SearchConfig];
  saveConfig(config);
  return redactConfig(config);
}
