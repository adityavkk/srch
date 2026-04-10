import { defineDomain } from "../define.js";

export const codeDomain = defineDomain({
  name: "code",
  defaultStrategy: "code/default",
  strategies: ["code/default"],
  sources: ["exa-code", "context7", "deepwiki"],
  capabilities: ["search", "context"],
  subdomains: []
});
