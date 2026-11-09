/** Dependencies supplied by the SDK. Omit to use the CLI's default runtime. */
export type WebSearchContext = {
  http: { fetch: typeof fetch };
  secrets: { resolve(name: string): Promise<string | null> };
};

export function fetchWithContext(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1], context?: WebSearchContext): ReturnType<typeof fetch> {
  return context ? context.http.fetch(input, init) : fetch(input, init);
}
