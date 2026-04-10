import { defineDomain } from "../define.js";

export const flightsDomain = defineDomain({
  name: "flights",
  defaultStrategy: "flights/default",
  strategies: ["flights/default"],
  sources: ["fli"],
  capabilities: ["search"],
  subdomains: []
});
