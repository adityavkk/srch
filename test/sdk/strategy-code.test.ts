import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "../../src/sdk.js";
import type { RunRequest } from "../../src/sdk.js";
import { defineConfig } from "../../src/sdk/define.js";
import { codeDomain } from "../../src/sdk/domains/code.js";
import { defineModule, defineSource, defineStrategy } from "../../src/sdk.js";

test("code/default merges primary and secondary evidence", async () => {
  const exaCode = defineSource({
    name: "exa-code",
    domain: "code",
    capabilities: ["search"],
    traits: [],
    transports: ["exa-context-api"],
    async run(req) {
      return [{
        source: "exa-code",
        domain: "code",
        query: req.query,
        provenance: { kind: "api", api: "exa", transport: "exa-context-api", timestamp: Date.now(), cached: false },
        payload: { kind: "text", title: "Primary", text: "primary", native: {} }
      }];
    }
  });

  const context7 = defineSource({
    name: "context7",
    domain: "code",
    capabilities: ["docs"],
    traits: [],
    transports: ["context7-mcp"],
    async run(req) {
      return [{
        source: "context7",
        domain: "code",
        query: req.query,
        provenance: { kind: "api", api: "context7", transport: "context7-mcp", timestamp: Date.now(), cached: false },
        payload: { kind: "text", title: "Context7", text: "docs", native: {} }
      }];
    }
  });

  const deepwiki = defineSource({
    name: "deepwiki",
    domain: "code",
    capabilities: ["docs"],
    traits: [],
    transports: ["deepwiki-mcp"],
    async run() {
      return [];
    }
  });

  const strategy = defineStrategy({
    kind: "static",
    name: "code/default",
    domain: "code",
    async run(req, ctx) {
      const [primary, secondary, repo] = await Promise.all([
        ctx.search("exa-code", { query: req.query }),
        ctx.search("context7", { query: req.query }),
        ctx.search("deepwiki", { query: req.query })
      ]);
      const evidence = ctx.merge(primary, secondary, repo);
      return {
        kind: evidence.length > 0 ? "success" : "empty",
        domain: "code",
        strategy: "code/default",
        ...(evidence.length > 0
          ? {
              evidence: [evidence[0]!, ...evidence.slice(1)],
              summary: {
                totalEvidence: evidence.length,
                sourceBreakdown: { "exa-code": 1, context7: 1 },
                attempts: [{ provider: "exa-code", status: "success", transport: "exa-context-api", durationMs: 0, evidenceCount: 1 }],
                durationMs: 0
              },
              trace: []
            }
          : {
              summary: { totalEvidence: 0, sourceBreakdown: {}, attempts: [{ provider: "exa-code", status: "failed", error: "none", durationMs: 0 }], durationMs: 0 },
              trace: [],
              suggestions: ["none"]
            })
      } as const;
    }
  });

  const client = createClient({
    config: defineConfig({
      modules: [defineModule({ name: "code-test", sources: [exaCode, context7, deepwiki], strategies: [strategy], domains: [codeDomain] })]
    })
  });

  const result = await client.run({ domain: "code", query: "bun sqlite" } satisfies RunRequest);

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.summary.totalEvidence, 2);
  assert.deepEqual(result.summary.sourceBreakdown, { "exa-code": 1, context7: 1 });
});
