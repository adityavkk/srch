import { defineDomain } from "../define.js";

export const fetchDomain = defineDomain({
  name: "fetch",
  defaultStrategy: "fetch/default",
  strategies: ["fetch/default"],
  sources: ["fetch-content"],
  capabilities: ["fetch", "extract"],
  subdomains: []
});
