import { loadConfig, saveConfig, type SearchConfig, type SecretField } from "../core/config.js";
import type { SearchProvider } from "../core/types.js";

const SECRET_FIELDS = new Set(["exaApiKey", "perplexityApiKey", "geminiApiKey", "braveApiKey", "seatsAeroApiKey"] as const);
const PUBLIC_FIELDS = new Set(["provider"] as const);

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

export function setSecretRef(field: string, source: string, key: string): SearchConfig {
  if (!SECRET_FIELDS.has(field as SecretField)) {
    throw new Error("Invalid secret field. Use exaApiKey|perplexityApiKey|geminiApiKey|braveApiKey|seatsAeroApiKey");
  }
  if (source !== "fnox" && source !== "op") {
    throw new Error("Invalid secret source. Use fnox|op");
  }
  if (!key.trim()) {
    throw new Error("Missing secret key name");
  }
  const config = loadConfig();
  config.secrets ??= {};
  config.secrets[field as SecretField] = { source: source as "fnox" | "op", key: key.trim() };
  delete config[field as SecretField];
  saveConfig(config);
  return redactConfig(config);
}

export function setSecret(field: string, value: string): SearchConfig {
  if (!SECRET_FIELDS.has(field as SecretField)) {
    throw new Error("Invalid secret field. Use exaApiKey|perplexityApiKey|geminiApiKey|braveApiKey|seatsAeroApiKey");
  }
  if (!value.trim()) {
    throw new Error("Missing secret value");
  }
  const config = loadConfig();
  config[field as SecretField] = value.trim();
  if (config.secrets && field in config.secrets) {
    delete config.secrets[field as SecretField];
    if (Object.keys(config.secrets).length === 0) delete config.secrets;
  }
  saveConfig(config);
  return redactConfig(config);
}

export function unsetField(field: string): SearchConfig {
  if (!SECRET_FIELDS.has(field as SecretField) && !PUBLIC_FIELDS.has(field as PublicField)) {
    throw new Error("Invalid field name");
  }
  const config = loadConfig();
  delete config[field as keyof SearchConfig];
  if (config.secrets && SECRET_FIELDS.has(field as SecretField)) {
    delete config.secrets[field as SecretField];
    if (Object.keys(config.secrets).length === 0) delete config.secrets;
  }
  saveConfig(config);
  return redactConfig(config);
}
