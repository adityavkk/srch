import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/core/config.js";
import { createSourceContext } from "./config.js";
import { exaSource } from "./sources/exa.js";
import type { HttpClient, SecretResolver } from "./types.js";

const CREDENTIAL_FIELDS = ["exaApiKey", "braveApiKey", "geminiApiKey", "perplexityApiKey"] as const;
const PROXY_VARIABLES = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] as const;
const CREDENTIAL_ENV = {
  exaApiKey: "EXA_API_KEY",
  braveApiKey: "BRAVE_API_KEY",
  geminiApiKey: "GEMINI_API_KEY",
  perplexityApiKey: "PERPLEXITY_API_KEY"
} as const;

export type WebDoctorOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  http?: HttpClient;
  secrets?: SecretResolver;
};

type CredentialStatus = "configured" | "reference" | "unchecked" | "missing" | "error" | "timeout" | "cancelled";
type FailureStage = "dns" | "connection" | "permission" | "tls" | "http" | "response" | "timeout" | "cancelled";

const FAILURE_MESSAGES: Record<FailureStage, string> = {
  dns: "The search endpoint could not be resolved",
  connection: "The search endpoint could not be reached",
  permission: "The environment denied the network request",
  tls: "The TLS connection failed",
  http: "The search provider returned an HTTP error",
  response: "The search provider returned an unreadable or incomplete response",
  timeout: "The probe exceeded its deadline",
  cancelled: "The probe was cancelled"
};

export type WebDoctorReport = {
  ok: boolean;
  checkedAt: string;
  durationMs: number;
  timeoutMs: number;
  runtime: { name: "node" | "bun"; version: string; nodeVersion: string; executable: string };
  package: { name: "srch"; sdkEntry: string };
  proxy: { configured: boolean; variables: string[]; nodeUsesEnvProxy: boolean };
  credentials: Record<typeof CREDENTIAL_FIELDS[number], { status: CredentialStatus }>;
  probe: {
    provider: "exa";
    transport: "exa-mcp";
    status: "ok" | "empty" | "failed";
    stage: "complete" | FailureStage;
    code?: string;
    httpStatus?: number;
    evidenceCount: number;
    durationMs: number;
    message: string;
  };
};

const NETWORK_CODES: Record<string, FailureStage> = {
  ENOTFOUND: "dns",
  EAI_AGAIN: "dns",
  EPERM: "permission",
  EACCES: "permission",
  ECONNREFUSED: "connection",
  ECONNRESET: "connection",
  ENETUNREACH: "connection",
  EHOSTUNREACH: "connection",
  ETIMEDOUT: "connection",
  FailedToOpenSocket: "connection",
  UND_ERR_CONNECT_TIMEOUT: "connection",
  CERT_HAS_EXPIRED: "tls",
  DEPTH_ZERO_SELF_SIGNED_CERT: "tls",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "tls",
  ERR_TLS_CERT_ALTNAME_INVALID: "tls"
};

// Errors can contain proxy URLs, headers or response bodies. Only report known
// codes and fixed messages; never copy an upstream error's message into a report.
function networkFailure(error: unknown): { stage: FailureStage; code?: string } {
  if (error instanceof Error && error.name === "TimeoutError") return { stage: "timeout" };
  if (error instanceof Error && error.name === "AbortError") return { stage: "cancelled" };
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ("code" in current && typeof current.code === "string" && Object.hasOwn(NETWORK_CODES, current.code)) {
      return { stage: NETWORK_CODES[current.code], code: current.code };
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return { stage: "connection" };
}

function abortStage(signal: AbortSignal): "timeout" | "cancelled" {
  return signal.reason instanceof Error && signal.reason.name === "TimeoutError" ? "timeout" : "cancelled";
}

function credentialPresence(signal: AbortSignal): WebDoctorReport["credentials"] {
  let checks: WebDoctorReport["credentials"];
  try {
    signal.throwIfAborted();
    const config = loadConfig();
    checks = Object.fromEntries(CREDENTIAL_FIELDS.map((field) => {
      const status: CredentialStatus = process.env[CREDENTIAL_ENV[field]]?.trim() || config[field]?.trim()
        ? "configured"
        : config.secrets?.[field]?.key ? "reference" : "unchecked";
      return [field, { status }];
    })) as WebDoctorReport["credentials"];
  } catch {
    const status: CredentialStatus = signal.aborted ? abortStage(signal) : "error";
    checks = Object.fromEntries(CREDENTIAL_FIELDS.map((field) => [field, { status }])) as WebDoctorReport["credentials"];
  }
  return checks;
}

// A supplied resolver or HTTP client may ignore cancellation. The report still
// finishes at its deadline while the signal asks cooperative work to stop.
function withinDeadline<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { reject(signal.reason); };
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return work();
    }).then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

export async function doctorWeb(options: WebDoctorOptions = {}): Promise<WebDoctorReport> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new RangeError("Doctor timeoutMs must be an integer from 1 to 60000");
  }

  const startedAt = Date.now();
  const checkedAt = new Date(startedAt).toISOString();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException("Doctor deadline exceeded", "TimeoutError")), timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const context = createSourceContext(options);

  // Presence checks never open external secret stores. Those commands can keep
  // the CLI alive after this report's deadline, even after Promise cancellation.
  const credentials = async () => options.secrets ? Object.fromEntries(await Promise.all(CREDENTIAL_FIELDS.map(async (field) => {
    let status: CredentialStatus;
    try {
      const value = await withinDeadline(signal, () => context.secrets.resolve(field, signal));
      status = value?.trim() ? "configured" : "missing";
    } catch {
      status = signal.aborted ? abortStage(signal) : "error";
    }
    return [field, { status }];
  }))) as WebDoctorReport["credentials"] : credentialPresence(signal);

  const probe = async (): Promise<WebDoctorReport["probe"]> => {
    const probeStartedAt = Date.now();
    let failure: { stage: FailureStage; code?: string } = { stage: "response" };
    let httpStatus: number | undefined;
    const base = { provider: "exa", transport: "exa-mcp" } as const;
    try {
      const evidence = await withinDeadline(signal, () => exaSource.run({
        query: "TypeScript official documentation",
        mode: "mcp",
        numResults: 1,
        signal
      }, {
        ...context,
        http: {
          async fetch(input, init) {
            try {
              const response = await context.http.fetch(input, init);
              httpStatus = response.status;
              failure = { stage: response.ok ? "response" : "http" };
              return response;
            } catch (error) {
              failure = networkFailure(error);
              throw error;
            }
          }
        }
      }));
      return {
        ...base,
        status: evidence.length ? "ok" : "empty",
        stage: "complete",
        httpStatus,
        evidenceCount: evidence.length,
        durationMs: Date.now() - probeStartedAt,
        message: evidence.length ? "Exa returned search results" : "Exa completed the request without search results"
      };
    } catch {
      if (signal.aborted) failure = { stage: abortStage(signal) };
      return {
        ...base,
        status: "failed",
        ...failure,
        httpStatus,
        evidenceCount: 0,
        durationMs: Date.now() - probeStartedAt,
        message: FAILURE_MESSAGES[failure.stage]
      };
    }
  };

  try {
    const [credentialChecks, probeResult] = await Promise.all([credentials(), probe()]);
    const proxyVariables = PROXY_VARIABLES.filter((name) => Boolean(process.env[name]?.trim()));
    return {
      ok: probeResult.status === "ok",
      checkedAt,
      durationMs: Date.now() - startedAt,
      timeoutMs,
      runtime: {
        name: process.versions.bun ? "bun" : "node",
        version: process.versions.bun ?? process.versions.node,
        nodeVersion: process.versions.node,
        executable: process.execPath
      },
      package: { name: "srch", sdkEntry: fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "../sdk.ts" : "../sdk.js", import.meta.url)) },
      proxy: {
        configured: proxyVariables.length > 0,
        variables: proxyVariables,
        nodeUsesEnvProxy: process.env.NODE_USE_ENV_PROXY === "1" || process.execArgv.includes("--use-env-proxy")
      },
      credentials: credentialChecks,
      probe: probeResult
    };
  } finally {
    clearTimeout(timer);
  }
}
