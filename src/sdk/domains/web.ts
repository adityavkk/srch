import { defineDomain } from "../define.js";

export const webDomain = defineDomain({
  name: "web",
  defaultStrategy: "web/default",
  strategies: ["web/default", "web/research"],
  sources: ["google", "exa", "brave", "gemini", "perplexity"],
  capabilities: ["search", "grounded-research"],
  subdomains: []
});
