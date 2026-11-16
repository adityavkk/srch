import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GroundingError } from "./errors.js";
import { isPiAntigravityRecord, loadAntigravityRuntime, piAgentDir, type PiAntigravityRecord, type RuntimeLoad } from "./pi-runtime.js";

/** Secret name an SDK host (e.g. a Pi extension) can resolve to `{"token","projectId"}` JSON. */
export const ANTIGRAVITY_CREDENTIALS_SECRET = "antigravityCredentials";

/** Treat a token as expired slightly early so it cannot lapse mid-request. */
const EXPIRY_SKEW_MS = 60_000;

export type AntigravityCredential = {
  token: string;
  projectId: string;
  source: "injected" | "pi-auth";
  /** A rejected token can be replaced once by refreshing. */
  refreshable: boolean;
};

export type AntigravityAuthContext = {
  secrets: { resolve(name: string, signal?: AbortSignal): Promise<string | null> };
  /** Read the signed-in Pi account from disk. Off for injected runtimes. */
  allowLocalAuth?: boolean;
};

export type AntigravityAuthDeps = {
  agentDir: () => string;
  loadRuntime: () => Promise<RuntimeLoad>;
  now: () => number;
};

export const defaultAuthDeps: AntigravityAuthDeps = {
  agentDir: piAgentDir,
  loadRuntime: () => loadAntigravityRuntime(),
  now: Date.now
};

/** Read Pi's stored Antigravity account. srch never writes this file; Pi owns it. */
export function readPiAntigravityRecord(agentDir: string): PiAntigravityRecord | null {
  const path = join(agentDir, "auth.json");
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>).antigravity : undefined;
    return isPiAntigravityRecord(record) ? record : null;
  } catch {
    return null;
  }
}

function parseInjected(raw: string): Pick<AntigravityCredential, "token" | "projectId"> {
  try {
    const parsed = JSON.parse(raw) as { token?: unknown; projectId?: unknown };
    if (typeof parsed.token === "string" && parsed.token && typeof parsed.projectId === "string" && parsed.projectId) {
      return { token: parsed.token, projectId: parsed.projectId };
    }
  } catch {
    // Fall through to a message that does not echo the value.
  }
  throw new GroundingError("auth_unavailable", `${ANTIGRAVITY_CREDENTIALS_SECRET} must be JSON with token and projectId`);
}

/** Abandon a refresh that ignores cancellation without claiming it stopped. */
function raceSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); }
    );
  });
}

/**
 * In-memory refreshed tokens, keyed by a hash of the refresh token. Concurrent callers
 * share one refresh, and nothing is persisted, so srch never races Pi's own writes.
 */
const refreshed = new Map<string, PiAntigravityRecord>();
const inFlight = new Map<string, Promise<PiAntigravityRecord>>();

function cacheKey(record: PiAntigravityRecord): string {
  return createHash("sha256").update(record.refresh).digest("hex");
}

async function refreshRecord(record: PiAntigravityRecord, deps: AntigravityAuthDeps, signal?: AbortSignal): Promise<PiAntigravityRecord> {
  const key = cacheKey(record);
  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const load = await deps.loadRuntime();
      if (load.kind !== "available") {
        throw new GroundingError("auth_expired", `Antigravity session expired and cannot be refreshed: ${load.reason}`);
      }
      try {
        const next = await load.runtime.refresh(record);
        refreshed.set(key, next);
        return next;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new GroundingError("auth_expired", `Antigravity token refresh failed: ${message.slice(0, 200)}`);
      }
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return raceSignal(pending, signal);
}

async function projectIdFor(record: PiAntigravityRecord, deps: AntigravityAuthDeps): Promise<string> {
  if (record.projectId) return record.projectId;
  const load = await deps.loadRuntime();
  if (load.kind === "available") return load.runtime.defaultProjectId(record.email || "antigravity-default");
  throw new GroundingError("auth_unavailable", "Antigravity account has no project ID; open Pi once to complete setup");
}

/**
 * Resolve Antigravity credentials: an injected credential first, then the signed-in Pi
 * account. `forceRefresh` replaces a token the service rejected.
 */
export async function resolveAntigravityCredential(
  ctx: AntigravityAuthContext,
  options: { forceRefresh?: boolean; signal?: AbortSignal } = {},
  deps: AntigravityAuthDeps = defaultAuthDeps
): Promise<AntigravityCredential> {
  const injected = await ctx.secrets.resolve(ANTIGRAVITY_CREDENTIALS_SECRET, options.signal);
  if (injected) return { ...parseInjected(injected), source: "injected", refreshable: false };

  const stored = ctx.allowLocalAuth ? readPiAntigravityRecord(deps.agentDir()) : null;
  if (!stored) {
    throw new GroundingError("auth_unavailable", ctx.allowLocalAuth
      ? "No Antigravity account is signed in to Pi"
      : `No ${ANTIGRAVITY_CREDENTIALS_SECRET} was provided by the SDK host`);
  }

  const cached = refreshed.get(cacheKey(stored));
  const freshest = cached && cached.expires > stored.expires ? cached : stored;
  const fresh = freshest.access && freshest.expires - EXPIRY_SKEW_MS > deps.now();
  const record = fresh && !options.forceRefresh ? freshest : await refreshRecord(stored, deps, options.signal);
  return { token: record.access, projectId: await projectIdFor(record, deps), source: "pi-auth", refreshable: true };
}

/** Whether credentials can be found without a network request. */
export async function hasAntigravityCredential(ctx: AntigravityAuthContext, deps: AntigravityAuthDeps = defaultAuthDeps, signal?: AbortSignal): Promise<boolean> {
  if (await ctx.secrets.resolve(ANTIGRAVITY_CREDENTIALS_SECRET, signal)) return true;
  return !!ctx.allowLocalAuth && readPiAntigravityRecord(deps.agentDir()) !== null;
}

export type AntigravityAuthStatus = {
  account: "signed-in" | "missing";
  sessionFresh: boolean | null;
  expiresInMinutes: number | null;
  refresh: { available: boolean; packageDir: string; reason?: string };
};

/** Diagnostics without secrets or network calls. */
export async function inspectAntigravityAuth(deps: AntigravityAuthDeps = defaultAuthDeps): Promise<AntigravityAuthStatus> {
  const record = readPiAntigravityRecord(deps.agentDir());
  const load = await deps.loadRuntime();
  const refresh = load.kind === "available"
    ? { available: true, packageDir: load.runtime.packageDir }
    : { available: false, packageDir: load.packageDir, reason: load.reason };
  if (!record) return { account: "missing", sessionFresh: null, expiresInMinutes: null, refresh };
  return {
    account: "signed-in",
    sessionFresh: !!record.access && record.expires - EXPIRY_SKEW_MS > deps.now(),
    // `|| 0` turns -0 (expiry just passed) into 0.
    expiresInMinutes: Math.round((record.expires - deps.now()) / 60_000) || 0,
    refresh
  };
}

/** Test hook: forget refreshed tokens. */
export function clearAntigravityAuthCache(): void {
  refreshed.clear();
  inFlight.clear();
}
