import type { RunResult, SearchFn, StrategyContext, StrategyRequest } from "./types.js";

export type AgentInvocation = {
  prompt: string;
  instructions?: string;
};

export type AgentContext = {
  search: SearchFn;
  merge: StrategyContext["merge"];
};

export type AgentAdapter = {
  name: string;
  invoke: <T = unknown>(input: AgentInvocation, context: AgentContext) => Promise<T>;
};

export type AgenticStrategyContext = StrategyContext & {
  agent: AgentAdapter;
};

export type AgenticStrategy<
  TRequest extends StrategyRequest = StrategyRequest,
  TResult extends RunResult = RunResult
> = {
  kind: "agentic";
  name: string;
  domain: string;
  adapter: string;
  run: (req: TRequest, ctx: AgenticStrategyContext) => Promise<TResult>;
};

export function defineAgenticStrategy<
  TRequest extends StrategyRequest = StrategyRequest,
  TResult extends RunResult = RunResult
>(strategy: AgenticStrategy<TRequest, TResult>): AgenticStrategy<TRequest, TResult> {
  return strategy;
}
