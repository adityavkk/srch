import { searchCodePrimary, type CodePrimaryResult } from "../../lib/search/code.js";
import { defineSource } from "../define.js";
import type { Source, SourceRequest } from "../types.js";

export type ExaCodeSourceRequest = SourceRequest & {
  maxTokens?: number;
};

export type CodeTextEvidencePayload<TNative = unknown> = {
  kind: "text";
  title: string;
  text: string;
  native: TNative;
};

export type ExaCodeEvidencePayload = CodeTextEvidencePayload<CodePrimaryResult["native"]>;

export const exaCodeSource: Source<ExaCodeSourceRequest, ExaCodeEvidencePayload> = defineSource({
  name: "exa-code",
  domain: "code",
  capabilities: ["search", "context"],
  traits: ["multi-transport"],
  transports: ["exa-context-api", "exa-mcp"],
  async run(req, ctx) {
    ctx.trace.step("source.exa-code", req.query, { maxTokens: req.maxTokens ?? 5000 });
    const result = await searchCodePrimary(req.query, req.maxTokens ?? 5000, req.signal);
    if (!result?.text.trim()) return [];

    return [{
      source: "exa-code",
      domain: "code",
      query: req.query,
      provenance: {
        kind: "api",
        api: "exa",
        transport: result.native.provider,
        timestamp: Date.now(),
        cached: false
      },
      payload: {
        kind: "text",
        title: "Exa code context",
        text: result.text,
        native: result.native
      }
    }];
  }
});
