import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { claudeHookAdapter } from "../../src/sdk/hooks/claude.js";
import { codexHookAdapter } from "../../src/sdk/hooks/codex.js";
import { installHooks, inspectHooks, uninstallHooks } from "../../src/sdk/hooks/install.js";
import { piHookAdapter } from "../../src/sdk/hooks/pi.js";

function withTempHome(fn: (home: string) => void) {
  const prevHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), "srch-hooks-home-"));
  process.env.HOME = home;
  try {
    fn(home);
  } finally {
    process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
}

test("hook adapters install idempotently and uninstall cleanly", () => {
  withTempHome((home) => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    const adapters = [claudeHookAdapter, codexHookAdapter, piHookAdapter];
    installHooks({ marker: "srch", command: '"/usr/local/bin/search" ambient-context', timeoutSeconds: 15 }, adapters);
    installHooks({ marker: "srch", command: '"/usr/local/bin/search" ambient-context', timeoutSeconds: 15 }, adapters);

    const status = inspectHooks("srch", adapters);
    assert.equal(status.every((item) => item.installed), true);

    const claudeText = readFileSync(join(home, ".claude", "settings.json"), "utf8");
    assert.equal((claudeText.match(/\"name\": \"srch\"/g) ?? []).length, 1);

    const codexText = readFileSync(join(home, ".codex", "hooks.json"), "utf8");
    assert.equal((codexText.match(/\"name\": \"srch\"/g) ?? []).length, 1);

    const piText = readFileSync(join(home, ".pi", "agent", "extensions", "srch.ts"), "utf8");
    assert.match(piText, /session_start/);

    const removed = uninstallHooks("srch", adapters);
    assert.deepEqual(removed.removed.sort(), ["claude", "codex", "pi"]);
    assert.equal(inspectHooks("srch", adapters).every((item) => item.installed === false), true);
  });
});
