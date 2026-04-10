import assert from "node:assert/strict";
import test from "node:test";
import { createClient, defineConfig, defineDomain, defineModule, defineSource, defineAgenticStrategy, type AgentAdapter } from "../../src/sdk.js";

const mockAgent: AgentAdapter = {
  name: "mock-agent",
  async invoke(input) {
    return `agent:${input.prompt}`;
  }
};

test("agentic strategy receives injected adapter", async () => {
  const source = defineSource({
    name: "notes-source",
    domain: "notes-agentic",
    capabilities: ["search"],
    traits: [],
    transports: ["memory"],
    async run(req) {
      return [{
        source: "notes-source",
        domain: "notes-agentic",
        query: req.query,
        provenance: { kind: "local", path: "/tmp/note.txt", timestamp: Date.now() },
        payload: { text: `note:${req.query}` }
      }];
    }
  });

  const strategy = defineAgenticStrategy({
    kind: "agentic",
    name: "notes-agentic/default",
    domain: "notes-agentic",
    adapter: "mock-agent",
    async run(req, ctx) {
      const evidence = await ctx.search("notes-source", { query: req.query });
      const answer = await ctx.agent.invoke<string>({ prompt: req.query }, { search: ctx.search, merge: ctx.merge });
      return {
        kind: "success",
        domain: "notes-agentic",
        strategy: "notes-agentic/default",
        evidence: [evidence[0]!, ...evidence.slice(1)],
        summary: {
          totalEvidence: evidence.length,
          sourceBreakdown: { "notes-source": evidence.length },
          attempts: [{ provider: "notes-source", status: "success", transport: "memory", durationMs: 0, evidenceCount: evidence.length }],
          durationMs: 0
        },
        trace: [],
        suggestions: [answer]
      };
    }
  });

  const domain = defineDomain({
    name: "notes-agentic",
    defaultStrategy: "notes-agentic/default",
    strategies: ["notes-agentic/default"],
    sources: ["notes-source"],
    capabilities: ["search"],
    subdomains: []
  });

  const client = createClient({
    config: defineConfig({ modules: [defineModule({ name: "notes-agentic", sources: [source], strategies: [strategy], domains: [domain] })] }),
    agentAdapters: [mockAgent]
  });

  const result = await client.run({ domain: "notes-agentic", query: "hello" });

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.suggestions?.[0], "agent:hello");
});
