export interface JsonEnvelope<T> {
  ok: boolean;
  command: string[];
  data?: T;
  error?: {
    message: string;
  };
}

export function ok<T>(command: string[], data: T): JsonEnvelope<T> {
  return { ok: true, command, data };
}

export function fail(command: string[], message: string): JsonEnvelope<never> {
  return { ok: false, command, error: { message } };
}
