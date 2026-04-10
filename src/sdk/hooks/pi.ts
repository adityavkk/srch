import { existsSync } from "node:fs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { HookAdapter } from "./types.js";
import { homePath, removeFile } from "./utils.js";

function extensionPath(marker: string): string {
  return homePath(".pi", "agent", "extensions", `${marker}.ts`);
}

function extensionSource(marker: string, command: string): string {
  return `import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

pi.on("session_start", async () => {
  try {
    const { stdout } = await execAsync(${JSON.stringify(command)}, { timeout: 15000, maxBuffer: 1024 * 128 });
    const text = stdout.trim();
    if (text) pi.appendEntry(text);
  } catch (error) {
    pi.appendEntry(${JSON.stringify(marker)} + ": failed to load ambient context");
  }
});
`;
}

export const piHookAdapter: HookAdapter = {
  name: "pi",
  detect() {
    return existsSync(homePath(".pi", "agent"));
  },
  install(config) {
    const path = extensionPath(config.marker);
    mkdirSync(homePath(".pi", "agent", "extensions"), { recursive: true });
    writeFileSync(path, extensionSource(config.marker, config.command));
  },
  uninstall(marker) {
    removeFile(extensionPath(marker));
  },
  isInstalled(marker) {
    const path = extensionPath(marker);
    return existsSync(path) && readFileSync(path, "utf8").includes(`pi.on("session_start"`);
  }
};
