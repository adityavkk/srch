import { defineModule } from "../define.js";
import { webDomain } from "../domains/web.js";
import { braveSource } from "../sources/brave.js";
import { exaSource } from "../sources/exa.js";
import { geminiSource } from "../sources/gemini.js";
import { perplexitySource } from "../sources/perplexity.js";
import { webDefaultStrategy } from "../strategies/web-default.js";

export const coreModule = defineModule({
  name: "core",
  sources: [exaSource, braveSource, geminiSource, perplexitySource],
  strategies: [webDefaultStrategy],
  domains: [webDomain]
});
