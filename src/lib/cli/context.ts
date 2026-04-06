import type { TraceSink } from "../trace.js";

export interface CommandContext {
  asJson: boolean;
  trace: TraceSink;
}
