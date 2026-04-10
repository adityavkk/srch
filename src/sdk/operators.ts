import type { Evidence } from "./types.js";

export function merge(...results: Evidence[][]): Evidence[] {
  return results.flat();
}

export function dedupe(results: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  return results.filter((item) => {
    const key = `${item.source}:${item.provenance.kind}:${JSON.stringify(item.provenance)}:${JSON.stringify(item.payload)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sort<T extends Evidence>(results: T[], comparator: (left: T, right: T) => number): T[] {
  return [...results].sort(comparator);
}

export function filter<T extends Evidence>(results: T[], predicate: (value: T) => boolean): T[] {
  return results.filter(predicate);
}
