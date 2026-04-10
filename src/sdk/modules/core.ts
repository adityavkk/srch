import { defineModule } from "../define.js";
import { codeDomain } from "../domains/code.js";
import { webDomain } from "../domains/web.js";
import { braveSource } from "../sources/brave.js";
import { context7Source } from "../sources/context7.js";
import { deepwikiSource } from "../sources/deepwiki.js";
import { exaCodeSource } from "../sources/exa-code.js";
import { exaSource } from "../sources/exa.js";
import { geminiSource } from "../sources/gemini.js";
import { perplexitySource } from "../sources/perplexity.js";
import { codeDefaultStrategy } from "../strategies/code-default.js";
import { webDefaultStrategy } from "../strategies/web-default.js";

export const coreModule = defineModule({
  name: "core",
  sources: [exaSource, braveSource, geminiSource, perplexitySource, exaCodeSource, context7Source, deepwikiSource],
  strategies: [webDefaultStrategy, codeDefaultStrategy],
  domains: [webDomain, codeDomain]
});
