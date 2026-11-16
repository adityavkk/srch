import { loadConfig, saveConfig, type SearchConfig, type SecretField } from "../core/config.js";
import type { SearchProvider, WebProvider } from "../core/types.js";
import { isSearchProvider, isWebProvider, SEARCH_PROVIDERS, WEB_PROVIDERS } from "../search/web-options.js";

const SECRET_FIELDS = new Set(["exaApiKey", "perplexityApiKey", "geminiApiKey", "braveApiKey", "seatsAeroApiKey"] as const);
const PUBLIC_FIELDS = new Set(["provider", "webProviders"] as const);

type PublicField = "provider" | "webProviders";

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
  if (!isSearchProvider(provider)) {
    throw new Error(`Invalid provider. Use ${SEARCH_PROVIDERS.join("|")}`);
  }
  const config = loadConfig();
  config.provider = provider;
  saveConfig(config);
  return redactConfig(config);
}

/** Parse a comma-separated provider order, e.g. `google,exa,brave`. */
export function parseWebProviders(value: string): WebProvider[] {
  const providers = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (providers.length === 0 || !providers.every(isWebProvider) || new Set(providers).size !== providers.length) {
    throw new Error(`Invalid provider order. Use distinct names from ${WEB_PROVIDERS.join("|")}, separated by commas`);
  }
  return providers;
}

export function setWebProviders(value: string): SearchConfig {
  const config = loadConfig();
  config.webProviders = parseWebProviders(value);
  saveConfig(config);
  return redactConfig(config);
}

export function getSearchProvider(explicit?: string): SearchProvider {
  const provider = explicit ?? loadConfig().provider ?? "auto";
  if (!isSearchProvider(provider)) throw new Error(`Invalid provider. Use ${SEARCH_PROVIDERS.join("|")}`);
  return provider;
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
