import type { Source, SourceRequest } from "./types.js";

export function defineSource<TRequest extends SourceRequest, TPayload>(
  source: Source<TRequest, TPayload>
): Source<TRequest, TPayload> {
  return source;
}
