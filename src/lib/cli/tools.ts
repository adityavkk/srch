import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getConfigPath, loadConfig } from "../core/config.js";
import { inspectSecretSources } from "../core/secrets.js";
import { getDocsDbPath } from "../docs/qmd.js";
import { inspectGeminiCookieProfiles } from "../fetch/chrome-cookies-inspect.js";
import { checkGhAvailable } from "../fetch/github-api.js";
import { inspectFli } from "../flights/fli.js";
import { inspectSeatsAero } from "../rewards-flights/seats-aero.js";

export async function inspectTools() {
  const qmdDbPath = getDocsDbPath();
  const colgrepConfig = join(homedir(), ".config", "colgrep", "config.json");
  const config = (() => {
    try { return loadConfig(); } catch { return null; }
  })();
  const secretResolution = config ? await inspectSecretSources(config) : null;

  return {
    configPath: getConfigPath(),
    searchConfigPresent: existsSync(getConfigPath()),
    configuredProvider: config?.provider ?? null,
    secretResolution,
    providers: {
      exa: { status: "untested", requiresApiKey: false },
      brave: { status: "untested", apiKeyConfigured: secretResolution?.braveApiKey.configured ?? null },
      perplexity: { status: "untested", apiKeyConfigured: secretResolution?.perplexityApiKey.configured ?? null },
      geminiApi: { status: "untested", apiKeyConfigured: secretResolution?.geminiApiKey.configured ?? null }
    },
    geminiWeb: inspectGeminiCookieProfiles(),
    github: {
      ghCliAvailable: await checkGhAvailable()
    },
    docs: {
      backend: "qmd-sdk",
      dbPath: qmdDbPath,
      dbPresent: existsSync(qmdDbPath)
    },
    code: {
      backend: "exa-mcp",
      colgrepConfigPresent: existsSync(colgrepConfig)
    },
    flights: await inspectFli(),
    rewardsFlights: await inspectSeatsAero(),
    runtime: {
      node: process.version,
      cwd: process.cwd()
    }
  };
}
