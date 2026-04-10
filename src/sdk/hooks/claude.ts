import { existsSync } from "node:fs";
import type { HookAdapter } from "./types.js";
import { commandString, homePath, readJsonFile, writeJsonFile } from "./utils.js";

type ClaudeHookEntry = {
  name?: string;
  type?: string;
  command?: string;
  timeout?: number;
};

type ClaudeSettings = {
  hooks?: {
    SessionStart?: ClaudeHookEntry[];
  };
  [key: string]: unknown;
};

function settingsPath(): string {
  return homePath(".claude", "settings.json");
}

export const claudeHookAdapter: HookAdapter = {
  name: "claude",
  detect() {
    return existsSync(homePath(".claude"));
  },
  install(config) {
    const path = settingsPath();
    const settings = readJsonFile<ClaudeSettings>(path, {});
    const hooks = settings.hooks ?? {};
    const sessionStart = hooks.SessionStart ?? [];
    const command = commandString(config.command);
    const next = sessionStart.filter((item) => item.name !== config.marker && item.command !== command);
    next.push({ name: config.marker, type: "command", command, timeout: config.timeoutSeconds });
    settings.hooks = { ...hooks, SessionStart: next };
    writeJsonFile(path, settings);
  },
  uninstall(marker) {
    const path = settingsPath();
    const settings = readJsonFile<ClaudeSettings>(path, {});
    const hooks = settings.hooks ?? {};
    const sessionStart = (hooks.SessionStart ?? []).filter((item) => item.name !== marker);
    settings.hooks = { ...hooks, SessionStart: sessionStart };
    writeJsonFile(path, settings);
  },
  isInstalled(marker) {
    const settings = readJsonFile<ClaudeSettings>(settingsPath(), {});
    return (settings.hooks?.SessionStart ?? []).some((item) => item.name === marker);
  }
};
