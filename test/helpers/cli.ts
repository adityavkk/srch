import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = join(repoRoot, "dist/cli.js");
const offlineImport = join(repoRoot, "test/fixtures/offline.mjs");

/** Exercise the shipped CLI with isolated state, no ambient keys, and a deadline. */
export function runCli(args: string[], overrides: NodeJS.ProcessEnv = {}, imports: string[] = []) {
  if (!existsSync(cliPath)) throw new Error("Build the CLI before integration tests: npm run build");
  const testDir = mkdtempSync(join(tmpdir(), "srch-cli-"));
  try {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR", "LANG", "LC_ALL"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    // Secret-store discovery must not consult a developer's keychain or account.
    const binDir = join(testDir, "bin");
    mkdirSync(binDir);
    for (const name of ["fnox", "op", "security"]) writeFileSync(join(binDir, name), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    const result = spawnSync(process.execPath, [
      "--import", offlineImport,
      ...imports.flatMap((path) => ["--import", path]),
      cliPath, ...args
    ], {
      cwd: repoRoot,
      env: {
        ...env, ...overrides,
        PATH: `${binDir}${delimiter}${env.PATH ?? ""}`,
        SRCH_STATE_DIR: overrides.SRCH_STATE_DIR ?? join(testDir, ".search"),
        // Never read the developer's Pi login or installed pi-antigravity.
        PI_CODING_AGENT_DIR: overrides.PI_CODING_AGENT_DIR ?? join(testDir, "pi-agent"),
        SRCH_PI_ANTIGRAVITY_DIR: overrides.SRCH_PI_ANTIGRAVITY_DIR ?? join(testDir, "missing-pi-antigravity")
      },
      encoding: "utf8",
      timeout: 15_000,
      killSignal: "SIGKILL",
      maxBuffer: 2 * 1024 * 1024
    });
    if (result.error) throw new Error(`CLI ${args[0] ?? "home"} failed to finish: ${result.error.message}\n${result.stdout}\n${result.stderr}`);
    return result;
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
}
