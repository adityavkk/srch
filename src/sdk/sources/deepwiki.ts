import { inferGithubRepo, queryDeepWiki } from "../../lib/secondary/deepwiki.js";
import { defineSource } from "../define.js";
import type { Source, SourceRequest } from "../types.js";
import type { CodeTextEvidencePayload } from "./exa-code.js";

export type DeepWikiEvidencePayload = CodeTextEvidencePayload<unknown>;

export const deepwikiSource: Source<SourceRequest, DeepWikiEvidencePayload> = defineSource({
  name: "deepwiki",
  domain: "code",
  capabilities: ["search", "docs"],
  traits: ["mcp", "repo-aware"],
  transports: ["deepwiki-mcp"],
  async run(req, ctx) {
    ctx.trace.step("source.deepwiki", req.query);
    const repo = inferGithubRepo(req.query);
    if (!repo) return [];

    const result = await queryDeepWiki(repo, req.query, req.signal);
    if (!result.meaningful || !result.text.trim()) return [];

    return [{
      source: "deepwiki",
      domain: "code",
      query: req.query,
      provenance: {
        kind: "api",
        api: "deepwiki",
        transport: "deepwiki-mcp",
        timestamp: Date.now(),
        cached: false
      },
      payload: {
        kind: "text",
        title: `DeepWiki (${result.repo})`,
        text: result.text,
        native: result.native
      }
    }];
  }
});
