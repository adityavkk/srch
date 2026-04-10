import { queryContext7 } from "../../lib/secondary/context7.js";
import { defineSource } from "../define.js";
import type { Source, SourceRequest } from "../types.js";
import type { CodeTextEvidencePayload } from "./exa-code.js";

export type Context7EvidencePayload = CodeTextEvidencePayload<{ resolve: unknown; docs: unknown }>;

export const context7Source: Source<SourceRequest, Context7EvidencePayload> = defineSource({
  name: "context7",
  domain: "code",
  capabilities: ["search", "docs"],
  traits: ["mcp"],
  transports: ["context7-mcp"],
  async run(req, ctx) {
    ctx.trace.step("source.context7", req.query);
    const result = await queryContext7(req.query, req.signal);
    if (!result.meaningful || !result.text.trim() || !result.libraryId) return [];

    return [{
      source: "context7",
      domain: "code",
      query: req.query,
      provenance: {
        kind: "api",
        api: "context7",
        transport: "context7-mcp",
        timestamp: Date.now(),
        cached: false
      },
      payload: {
        kind: "text",
        title: `Context7 (${result.libraryId})`,
        text: result.text,
        native: result.native as { resolve: unknown; docs: unknown }
      }
    }];
  }
});
