import { defineModule } from "../define.js";
import { codeDomain } from "../domains/code.js";
import { docsDomain } from "../domains/docs.js";
import { fetchDomain } from "../domains/fetch.js";
import { socialDomain } from "../domains/social.js";
import { webDomain } from "../domains/web.js";
import { birdSource } from "../sources/bird.js";
import { braveSource } from "../sources/brave.js";
import { context7Source } from "../sources/context7.js";
import { deepwikiSource } from "../sources/deepwiki.js";
import { docsQmdSource } from "../sources/docs-qmd.js";
import { exaCodeSource } from "../sources/exa-code.js";
import { exaSource } from "../sources/exa.js";
import { fetchContentSource } from "../sources/fetch-content.js";
import { geminiSource } from "../sources/gemini.js";
import { perplexitySource } from "../sources/perplexity.js";
import { codeDefaultStrategy } from "../strategies/code-default.js";
import { docsDefaultStrategy } from "../strategies/docs-default.js";
import { fetchDefaultStrategy } from "../strategies/fetch-default.js";
import { socialDefaultStrategy } from "../strategies/social-default.js";
import { webDefaultStrategy } from "../strategies/web-default.js";

export const coreModule = defineModule({
  name: "core",
  sources: [exaSource, braveSource, geminiSource, perplexitySource, exaCodeSource, context7Source, deepwikiSource, docsQmdSource, fetchContentSource, birdSource],
  strategies: [webDefaultStrategy, codeDefaultStrategy, docsDefaultStrategy, fetchDefaultStrategy, socialDefaultStrategy],
  domains: [webDomain, codeDomain, docsDomain, fetchDomain, socialDomain]
});
