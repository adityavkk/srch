import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getConfigPath, loadConfig } from "../core/config.js";
import { isGeminiApiAvailable } from "../upstream/gemini-api.js";
import { isExaAvailable } from "../upstream/exa.js";
import { isPerplexityAvailable } from "../upstream/perplexity.js";
import { getDocsDbPath } from "../docs/qmd.js";

export function inspectTools() {
  const qmdDbPath = getDocsDbPath();
  const colgrepConfig = join(homedir(), ".config", "colgrep", "config.json");
  const config = (() => {
    try { return loadConfig(); } catch { return null; }
  })();

  return {
    configPath: getConfigPath(),
    searchConfigPresent: existsSync(getConfigPath()),
    configuredProvider: config?.provider ?? null,
    providers: {
      exa: isExaAvailable(),
      perplexity: isPerplexityAvailable(),
      geminiApi: isGeminiApiAvailable()
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
    runtime: {
      node: process.version,
      cwd: process.cwd()
    }
  };
}
