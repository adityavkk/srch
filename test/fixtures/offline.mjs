import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests must provide responses explicitly. A missing mock must never use the web.
globalThis.fetch = async () => {
  throw new Error("Unexpected network request in offline tests");
};

// Never read the developer's signed-in Pi account or load their installed pi-antigravity.
// Tests that need either set these variables to fixtures explicitly.
process.env.PI_CODING_AGENT_DIR ??= mkdtempSync(join(tmpdir(), "srch-pi-agent-"));
process.env.SRCH_PI_ANTIGRAVITY_DIR ??= join(tmpdir(), "srch-missing-pi-antigravity");
