import { existsSync } from "node:fs";
import type { HookAdapter } from "./types.js";
import { commandString, homePath, readJsonFile, writeJsonFile } from "./utils.js";

type CodexHookEntry = {
  name?: string;
  command?: string;
  timeout?: number;
};

type CodexHooks = {
  session_start?: CodexHookEntry[];
};

function hooksPath(): string {
  return homePath(".codex", "hooks.json");
}

export const codexHookAdapter: HookAdapter = {
  name: "codex",
  detect() {
    return existsSync(homePath(".codex")) || existsSync(hooksPath());
  },
  install(config) {
    const path = hooksPath();
    const hooks = readJsonFile<CodexHooks>(path, {});
    const command = commandString(config.command);
    const entries = (hooks.session_start ?? []).filter((item) => item.name !== config.marker && item.command !== command);
    entries.push({ name: config.marker, command, timeout: config.timeoutSeconds });
    hooks.session_start = entries;
    writeJsonFile(path, hooks);
  },
  uninstall(marker) {
    const path = hooksPath();
    const hooks = readJsonFile<CodexHooks>(path, {});
    hooks.session_start = (hooks.session_start ?? []).filter((item) => item.name !== marker);
    writeJsonFile(path, hooks);
  },
  isInstalled(marker) {
    const hooks = readJsonFile<CodexHooks>(hooksPath(), {});
    return (hooks.session_start ?? []).some((item) => item.name === marker);
  }
};
