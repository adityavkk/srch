import type { Source, SourceRequest, RunResult, StaticStrategy, StrategyRequest } from "./types.js";

export function defineSource<TRequest extends SourceRequest, TPayload>(
  source: Source<TRequest, TPayload>
): Source<TRequest, TPayload> {
  return source;
}

export function defineStrategy<
  TRequest extends StrategyRequest,
  TResult extends RunResult = RunResult
>(strategy: StaticStrategy<TRequest, TResult>): StaticStrategy<TRequest, TResult> {
  return strategy;
}
