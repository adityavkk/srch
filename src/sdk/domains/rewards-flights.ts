import { defineDomain } from "../define.js";

export const rewardsFlightsDomain = defineDomain({
  name: "rewards-flights",
  defaultStrategy: "rewards-flights/default",
  strategies: ["rewards-flights/default"],
  sources: ["seats-aero"],
  capabilities: ["search"],
  subdomains: []
});
