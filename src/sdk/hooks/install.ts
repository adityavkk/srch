import { claudeHookAdapter } from "./claude.js";
import { codexHookAdapter } from "./codex.js";
import { piHookAdapter } from "./pi.js";
import type { HookAdapter, HookInstallConfig } from "./types.js";

export const defaultHookAdapters = [claudeHookAdapter, codexHookAdapter, piHookAdapter] satisfies HookAdapter[];

export function installHooks(config: HookInstallConfig, adapters: HookAdapter[] = defaultHookAdapters) {
  const installed: string[] = [];
  const skipped: string[] = [];
  const normalized = { ...config };

  for (const adapter of adapters) {
    if (!adapter.detect()) {
      skipped.push(adapter.name);
      continue;
    }
    adapter.install(normalized);
    installed.push(adapter.name);
  }

  return { installed, skipped };
}

export function uninstallHooks(marker: string, adapters: HookAdapter[] = defaultHookAdapters) {
  const removed: string[] = [];
  for (const adapter of adapters) {
    if (adapter.isInstalled(marker)) {
      adapter.uninstall(marker);
      removed.push(adapter.name);
    }
  }
  return { removed };
}

export function inspectHooks(marker: string, adapters: HookAdapter[] = defaultHookAdapters) {
  return adapters.map((adapter) => ({
    name: adapter.name,
    detected: adapter.detect(),
    installed: adapter.isInstalled(marker)
  }));
}
