import { assertModuleShape } from "./module.js";
import type { Domain, Module, Source, SourceRequest, RunResult, SrchConfig, StaticStrategy, StrategyRequest } from "./types.js";

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

export function defineDomain(domain: Domain): Domain {
  return domain;
}

export function defineModule(module: Module): Module {
  assertModuleShape(module);
  return module;
}

export function defineConfig(config: SrchConfig): SrchConfig {
  return config;
}
