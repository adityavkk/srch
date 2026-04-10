import type { Module } from "./types.js";

export function assertModuleShape(module: Module): void {
  const count = module.sources.length + module.strategies.length + module.domains.length;
  if (count === 0) {
    throw new Error(`Module ${module.name} must provide at least one source, strategy, or domain`);
  }
}
