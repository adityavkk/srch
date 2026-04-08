import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getConfigPath, loadConfig } from "../core/config.js";
import { inspectSecretSources } from "../core/secrets.js";
import { isGeminiApiAvailable } from "../upstream/gemini-api.js";
import { isExaAvailable } from "../upstream/exa.js";
import { isPerplexityAvailable } from "../upstream/perplexity.js";
import { getDocsDbPath } from "../docs/qmd.js";
import { inspectGeminiCookieProfiles } from "../fetch/chrome-cookies-inspect.js";
import { checkGhAvailable } from "../fetch/github-api.js";
import { inspectDuffel } from "../flights/duffel.js";
import { inspectSeatsAero } from "../rewards-flights/seats-aero.js";

export async function inspectTools() {
  const qmdDbPath = getDocsDbPath();
  const colgrepConfig = join(homedir(), ".config", "colgrep", "config.json");
  const config = (() => {
    try { return loadConfig(); } catch { return null; }
  })();

  return {
    configPath: getConfigPath(),
    searchConfigPresent: existsSync(getConfigPath()),
    configuredProvider: config?.provider ?? null,
    secretResolution: config ? await inspectSecretSources(config) : null,
    providers: {
      exa: isExaAvailable(),
      perplexity: await isPerplexityAvailable(),
      geminiApi: await isGeminiApiAvailable()
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
    flights: await inspectDuffel(),
    rewardsFlights: await inspectSeatsAero(),
    runtime: {
      node: process.version,
      cwd: process.cwd()
    }
  };
}
