import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Override persistent CLI state without changing the user's home directory. */
export function getStateDir(): string {
  const override = process.env.SRCH_STATE_DIR?.trim();
  return override ? resolve(override) : join(homedir(), ".search");
}
