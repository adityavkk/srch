import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  coreModule,
  createClient,
  defineConfig,
  defineDomain,
  defineModule,
  defineSource,
  defineStrategy,
  findConfigPath,
  loadConfig
} from "../../src/sdk.js";

test("defineConfig + defineModule register a runnable domain", async () => {
  const alpha = defineSource({
    name: "alpha",
    domain: "notes",
    capabilities: ["search"],
    traits: [],
    transports: ["memory"],
    async run(req) {
      return [{
        source: "alpha",
        domain: "notes",
        query: req.query,
        provenance: { kind: "local", path: "/tmp/alpha.txt", timestamp: Date.now() },
        payload: { title: `note:${req.query}` }
      }];
    }
  });

  const notesStrategy = defineStrategy({
    kind: "static",
    name: "notes/default",
    domain: "notes",
    async run(req, ctx) {
      const evidence = await ctx.search("alpha", { query: req.query, signal: req.signal });
      return {
        kind: "success",
        domain: "notes",
        strategy: "notes/default",
        evidence: [evidence[0]!, ...evidence.slice(1)],
        summary: {
          totalEvidence: evidence.length,
          sourceBreakdown: { alpha: evidence.length },
          attempts: [{ provider: "alpha", status: "success", transport: "memory", durationMs: 0, evidenceCount: evidence.length }],
          durationMs: 0
        },
        trace: []
      };
    }
  });

  const notesDomain = defineDomain({
    name: "notes",
    defaultStrategy: "notes/default",
    strategies: ["notes/default"],
    sources: ["alpha"],
    capabilities: ["search"],
    subdomains: []
  });

  const notesModule = defineModule({
    name: "notes",
    sources: [alpha],
    strategies: [notesStrategy],
    domains: [notesDomain]
  });

  const config = defineConfig({
    modules: [notesModule]
  });

  const client = createClient({ config });
  const result = await client.run({ domain: "notes", query: "typed sdk" });

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;

  assert.equal(result.evidence[0].source, "alpha");
  assert.equal(client.registry.domains.get("notes").defaultStrategy, "notes/default");
});

test("coreModule registers built-in web domain", async () => {
  const client = createClient({ config: defineConfig({ modules: [coreModule] }) });
  const status = await client.status();

  assert.ok(status.domains.includes("web"));
  assert.equal(client.registry.domains.get("web").defaultStrategy, "web/default");
});

test("loadConfig loads srch.config.ts via tsx runtime", async () => {
  const dir = await mkdtemp(`${tmpdir()}/srch-config-`);
  const sdkUrl = pathToFileURL(resolve("src/sdk.ts")).href;
  const configPath = resolve(dir, "srch.config.ts");

  await writeFile(configPath, `
import { defineConfig, defineDomain, defineModule, defineSource, defineStrategy } from ${JSON.stringify(sdkUrl)};

const alpha = defineSource({
  name: "alpha",
  domain: "notes",
  capabilities: ["search"],
  traits: [],
  transports: ["memory"],
  async run(req) {
    return [{
      source: "alpha",
      domain: "notes",
      query: req.query,
      provenance: { kind: "local", path: "/tmp/alpha.txt", timestamp: Date.now() },
      payload: { title: req.query }
    }];
  }
});

const notesStrategy = defineStrategy({
  kind: "static",
  name: "notes/default",
  domain: "notes",
  async run(req, ctx) {
    const evidence = await ctx.search("alpha", { query: req.query, signal: req.signal });
    return {
      kind: "success",
      domain: "notes",
      strategy: "notes/default",
      evidence: [evidence[0], ...evidence.slice(1)],
      summary: {
        totalEvidence: evidence.length,
        sourceBreakdown: { alpha: evidence.length },
        attempts: [{ provider: "alpha", status: "success", transport: "memory", durationMs: 0, evidenceCount: evidence.length }],
        durationMs: 0
      },
      trace: []
    };
  }
});

const notesDomain = defineDomain({
  name: "notes",
  defaultStrategy: "notes/default",
  strategies: ["notes/default"],
  sources: ["alpha"],
  capabilities: ["search"],
  subdomains: []
});

export default defineConfig({
  modules: [defineModule({ name: "notes", sources: [alpha], strategies: [notesStrategy], domains: [notesDomain] })]
});
`, "utf8");

  assert.equal(findConfigPath(dir), configPath);

  const loaded = await loadConfig({ path: configPath });
  assert.ok(loaded);

  const client = createClient({ config: loaded! });
  const result = await client.run({ domain: "notes", query: "hello" });

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.evidence[0].payload.title, "hello");
});
