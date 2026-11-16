import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** OAuth record shape stored by pi-antigravity under `antigravity` in Pi's auth.json. */
export type PiAntigravityRecord = {
  access: string;
  refresh: string;
  expires: number;
  projectId?: string;
  email?: string;
};

/**
 * Version-sensitive pieces owned by the installed pi-antigravity package: OAuth refresh,
 * the client fingerprint, and endpoint selection. Loading them keeps srch from copying
 * OAuth client credentials or a client version string that pi-antigravity updates.
 */
export type AntigravityRuntime = {
  packageDir: string;
  refresh(record: PiAntigravityRecord): Promise<PiAntigravityRecord>;
  userAgent(): string;
  endpoints(): string[];
  defaultProjectId(seed: string): string;
};

export type RuntimeLoad =
  | { kind: "available"; runtime: AntigravityRuntime }
  | { kind: "unavailable"; packageDir: string; reason: string };

export function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function piAntigravityDir(): string {
  return process.env.SRCH_PI_ANTIGRAVITY_DIR || join(piAgentDir(), "npm", "node_modules", "pi-antigravity");
}

async function importTypeScript(path: string): Promise<Record<string, unknown>> {
  // Bun runs TypeScript natively; Node needs tsx, which srch already depends on.
  if (process.versions.bun) return import(pathToFileURL(path).href) as Promise<Record<string, unknown>>;
  const { tsImport } = await import("tsx/esm/api");
  return tsImport(pathToFileURL(path).href, import.meta.url) as Promise<Record<string, unknown>>;
}

function fn<T extends (...args: never[]) => unknown>(module: Record<string, unknown>, name: string): T {
  const value = module[name];
  if (typeof value !== "function") throw new Error(`pi-antigravity does not export ${name}`);
  return value as T;
}

export function isPiAntigravityRecord(value: unknown): value is PiAntigravityRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.access === "string" && typeof record.refresh === "string" && record.refresh.length > 0
    && typeof record.expires === "number" && Number.isFinite(record.expires)
    && (record.projectId === undefined || typeof record.projectId === "string")
    && (record.email === undefined || typeof record.email === "string");
}

async function load(packageDir: string): Promise<RuntimeLoad> {
  const oauthPath = join(packageDir, "src", "auth", "oauth.ts");
  const clientPath = join(packageDir, "src", "client", "client.ts");
  if (!existsSync(oauthPath) || !existsSync(clientPath)) {
    return { kind: "unavailable", packageDir, reason: "pi-antigravity is not installed" };
  }
  try {
    const [oauth, client] = await Promise.all([importTypeScript(oauthPath), importTypeScript(clientPath)]);
    const refresh = fn<(record: PiAntigravityRecord) => Promise<unknown>>(oauth, "refreshAntigravityToken");
    const userAgent = fn<() => string>(client, "defaultUserAgent");
    const endpoints = fn<() => string[]>(client, "endpointCandidates");
    const defaultProjectId = fn<(seed: string) => string>(client, "defaultProjectId");
    return {
      kind: "available",
      runtime: {
        packageDir,
        async refresh(record) {
          const next = await refresh(record);
          if (!isPiAntigravityRecord(next) || !next.access) throw new Error("pi-antigravity returned an invalid refreshed credential");
          return next;
        },
        userAgent,
        endpoints,
        defaultProjectId
      }
    };
  } catch (error) {
    // Import failures can quote source lines, never credentials; still keep it short.
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "unavailable", packageDir, reason: `pi-antigravity could not be loaded: ${message.split("\n")[0]!.slice(0, 200)}` };
  }
}

const loads = new Map<string, Promise<RuntimeLoad>>();

/** Load once per package directory and process. */
export function loadAntigravityRuntime(packageDir = piAntigravityDir()): Promise<RuntimeLoad> {
  let pending = loads.get(packageDir);
  if (!pending) {
    pending = load(packageDir);
    loads.set(packageDir, pending);
  }
  return pending;
}
