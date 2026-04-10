import { defineSource } from "../define.js";
import type { Source, SourceRequest } from "../types.js";

export type BirdSourceRequest = SourceRequest & {
  count?: number;
};

export type BirdEvidencePayload = {
  kind: "tweet";
  id: string;
  author: string;
  text: string;
  createdAt?: string;
  url: string;
};

export const birdSource: Source<BirdSourceRequest, BirdEvidencePayload> = defineSource({
  name: "bird",
  domain: "social",
  capabilities: ["search"],
  traits: ["auth-required"],
  transports: ["bird"],
  async run(req, ctx) {
    ctx.trace.step("source.bird", req.query, { count: req.count ?? 10 });
    const { twitterSearch } = await import("../../lib/upstream/bird.js");
    const result = await twitterSearch(req.query, req.count ?? 10);

    return result.tweets.map((tweet) => ({
      source: "bird",
      domain: "social",
      query: req.query,
      provenance: {
        kind: "web",
        url: `https://x.com/i/status/${tweet.id}`,
        transport: "bird",
        timestamp: Date.now(),
        cached: false
      },
      payload: {
        kind: "tweet",
        id: tweet.id,
        author: tweet.author,
        text: tweet.text,
        createdAt: tweet.createdAt,
        url: `https://x.com/i/status/${tweet.id}`
      }
    }));
  }
});
