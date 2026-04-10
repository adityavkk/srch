import type { Domain } from "./types.js";

export class DomainRegistry {
  #domains = new Map<string, Domain>();

  constructor(domains: Domain[] = []) {
    for (const domain of domains) this.register(domain);
  }

  register(domain: Domain): void {
    if (this.#domains.has(domain.name)) {
      throw new Error(`Duplicate domain registered: ${domain.name}`);
    }
    this.#domains.set(domain.name, domain);
  }

  get(name: string): Domain {
    const domain = this.#domains.get(name);
    if (!domain) throw new Error(`Unknown domain: ${name}`);
    return domain;
  }

  list(): Domain[] {
    return [...this.#domains.values()];
  }
}
