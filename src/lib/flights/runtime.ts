import { homedir } from "node:os";
import { join } from "node:path";

// PyPI 0.9.0 predates the public-page transport fix. Keep this immutable.
export const FLI_REVISION = "881aee5ff4321e81ea2157cb44be94ce6a21dc1b";
export const FLI_REQUIREMENT = `flights @ git+https://github.com/punitarani/fli.git@${FLI_REVISION}`;
export const FLI_RUNTIME_DIR = join(homedir(), ".search", "runtimes", "flights", FLI_REVISION);
export const FLI_MANAGED_PYTHON = process.platform === "win32"
  ? join(FLI_RUNTIME_DIR, "Scripts", "python.exe")
  : join(FLI_RUNTIME_DIR, "bin", "python");

export function fliPython(): string {
  return process.env.SRCH_FLI_PYTHON?.trim()
    || (process.env.SRCH_FLI_FIXTURE?.trim() ? "python3" : FLI_MANAGED_PYTHON);
}
