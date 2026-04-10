import type { AnyStrategy } from "./types.js";

export class StrategyRegistry {
  #strategies = new Map<string, AnyStrategy>();

  constructor(strategies: AnyStrategy[] = []) {
    for (const strategy of strategies) this.register(strategy);
  }

  register(strategy: AnyStrategy): void {
    if (this.#strategies.has(strategy.name)) {
      throw new Error(`Duplicate strategy registered: ${strategy.name}`);
    }
    this.#strategies.set(strategy.name, strategy);
  }

  get(name: string): AnyStrategy {
    const strategy = this.#strategies.get(name);
    if (!strategy) throw new Error(`Unknown strategy: ${name}`);
    return strategy;
  }

  list(): AnyStrategy[] {
    return [...this.#strategies.values()];
  }
}
