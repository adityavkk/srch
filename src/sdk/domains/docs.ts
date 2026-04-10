import { defineDomain } from "../define.js";

export const docsDomain = defineDomain({
  name: "docs",
  defaultStrategy: "docs/default",
  strategies: ["docs/default"],
  sources: ["docs-qmd"],
  capabilities: ["search"],
  subdomains: []
});
