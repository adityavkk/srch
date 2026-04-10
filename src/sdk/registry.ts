import type { AnySource } from "./types.js";

export class SourceRegistry {
  #sources = new Map<string, AnySource>();

  constructor(sources: AnySource[] = []) {
    for (const source of sources) this.register(source);
  }

  register(source: AnySource): void {
    if (this.#sources.has(source.name)) {
      throw new Error(`Duplicate source registered: ${source.name}`);
    }
    this.#sources.set(source.name, source);
  }

  get(name: string): AnySource {
    const source = this.#sources.get(name);
    if (!source) throw new Error(`Unknown source: ${name}`);
    return source;
  }

  list(): AnySource[] {
    return [...this.#sources.values()];
  }
}
