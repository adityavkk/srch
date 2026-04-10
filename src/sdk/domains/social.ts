import { defineDomain } from "../define.js";

export const socialDomain = defineDomain({
  name: "social",
  defaultStrategy: "social/default",
  strategies: ["social/default"],
  sources: ["bird"],
  capabilities: ["search"],
  subdomains: ["x"]
});
