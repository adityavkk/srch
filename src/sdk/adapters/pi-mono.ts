import type { AgentAdapter } from "../agent.js";

export const piMonoAgentAdapter: AgentAdapter = {
  name: "pi-mono",
  async invoke() {
    throw new Error("pi-mono agent adapter is not wired yet. Provide a custom AgentAdapter via createClient({ agentAdapters: [...] }).");
  }
};
