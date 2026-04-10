import { defineDomain } from "../define.js";

export const webDomain = defineDomain({
  name: "web",
  defaultStrategy: "web/default",
  strategies: ["web/default"],
  sources: ["exa", "brave", "gemini", "perplexity"],
  capabilities: ["search"],
  subdomains: []
});
