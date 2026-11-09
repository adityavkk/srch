import type { RunSummary } from "../../sdk/types.js";
import type { TraceEvent } from "../trace.js";

export type FailureDetails = {
  code?: string;
  summary?: RunSummary;
  trace?: TraceEvent[];
};

export interface JsonEnvelope<T> {
  ok: boolean;
  command: string[];
  data?: T;
  error?: FailureDetails & {
    message: string;
    suggestions?: string[];
  };
}

export function ok<T>(command: string[], data: T): JsonEnvelope<T> {
  return { ok: true, command, data };
}

export function fail(command: string[], message: string, suggestions?: string[], details?: FailureDetails): JsonEnvelope<never> {
  return { ok: false, command, error: { message, ...details, ...(suggestions?.length ? { suggestions } : {}) } };
}
