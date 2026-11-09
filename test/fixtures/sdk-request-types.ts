import type { RunResult, SrchClient, WebEvidencePayload } from "../../src/sdk.js";

declare const client: SrchClient;
const web: Promise<RunResult<WebEvidencePayload>> = client.run({ domain: "web", query: "test", numResults: 4 });
client.run({ domain: "web", strategy: "web/default", query: "test", numResults: 4 });
void web;
client.run({ domain: "notes", query: "test", collection: "local", limit: 3 });
declare const customDomain: "notes" | "tickets";
client.run({ domain: customDomain, query: "test", customFlag: true });
// @ts-expect-error Built-in web options cannot use the custom-domain overload.
client.run({ domain: "web", query: "test", numResults: "many" });
// @ts-expect-error Unknown provider values must remain rejected.
client.run({ domain: "web", query: "test", provider: "unknown" });
// @ts-expect-error Code options must retain their numeric type.
client.run({ domain: "code", query: "test", maxTokens: "many" });
// @ts-expect-error Docs options must retain their numeric type.
client.run({ domain: "docs", query: "test", limit: "many" });
// @ts-expect-error Social options must retain their numeric type.
client.run({ domain: "social", query: "test", count: "many" });
// @ts-expect-error Flight options must be an options object.
client.run({ domain: "flights", query: "JFK LHR 2026-12-01", options: "many" });
// @ts-expect-error Reward options must retain their numeric type.
client.run({ domain: "rewards-flights", query: "JFK LHR", take: "many" });
const invalidWeb = { domain: "web" as const, query: "test", numResults: "many" };
// @ts-expect-error Passing an existing variable must not bypass validation.
client.run(invalidWeb);
declare const uncheckedDomain: string;
// @ts-expect-error A broad domain string cannot bypass built-in option types.
client.run({ domain: uncheckedDomain, query: "test", numResults: "many" });
declare const mixedDomain: "web" | "notes";
// @ts-expect-error A union containing a built-in domain cannot use the extension overload.
client.run({ domain: mixedDomain, query: "test", numResults: "many" });
