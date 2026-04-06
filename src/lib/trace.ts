type TraceStatus = "ok" | "error";

export interface TraceEvent {
  label: string;
  detail?: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status?: TraceStatus;
  meta?: Record<string, unknown>;
}

export interface TraceSink {
  enabled: boolean;
  add(event: Omit<TraceEvent, "startedAt"> & { startedAt?: number }): void;
  step(label: string, detail?: string, meta?: Record<string, unknown>): void;
  span<T>(label: string, detail: string | undefined, fn: () => Promise<T>, meta?: Record<string, unknown>): Promise<T>;
  flush(): void;
  snapshot(): TraceEvent[];
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function render(events: TraceEvent[]): string {
  const lines = ["trace"];
  for (const event of events) {
    const symbol = event.status === "error" ? "x" : event.endedAt ? "•" : ">";
    const parts = [symbol, event.label];
    if (event.detail) parts.push(`— ${event.detail}`);
    if (typeof event.durationMs === "number") parts.push(`[${fmtMs(event.durationMs)}]`);
    const metaEntries = Object.entries(event.meta ?? {}).filter(([, value]) => value !== undefined && value !== null);
    if (metaEntries.length > 0) parts.push(metaEntries.map(([key, value]) => `${key}=${String(value)}`).join(" "));
    lines.push(parts.join(" "));
  }
  return lines.join("\n");
}

export function createTraceSink(enabled: boolean): TraceSink {
  const events: TraceEvent[] = [];

  return {
    enabled,
    add(event) {
      if (!enabled) return;
      events.push({ ...event, startedAt: event.startedAt ?? Date.now() });
    },
    step(label, detail, meta) {
      if (!enabled) return;
      events.push({ label, detail, meta, startedAt: Date.now(), endedAt: Date.now(), durationMs: 0, status: "ok" });
    },
    async span(label, detail, fn, meta) {
      const startedAt = Date.now();
      try {
        const value = await fn();
        if (enabled) {
          events.push({ label, detail, meta, startedAt, endedAt: Date.now(), durationMs: Date.now() - startedAt, status: "ok" });
        }
        return value;
      } catch (error) {
        if (enabled) {
          events.push({
            label,
            detail,
            meta: { ...(meta ?? {}), error: error instanceof Error ? error.message : String(error) },
            startedAt,
            endedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            status: "error"
          });
        }
        throw error;
      }
    },
    flush() {
      if (!enabled) return;
      console.error(render(events));
    },
    snapshot() {
      return [...events];
    }
  };
}
