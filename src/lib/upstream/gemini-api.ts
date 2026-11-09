import { resolveSecret } from "../core/secrets.js";
import type { WebSearchContext } from "./context.js";

export const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_MODEL = "gemini-2.5-flash";

export async function getApiKey(context?: WebSearchContext): Promise<string | null> {
  return context ? context.secrets.resolve("geminiApiKey") : resolveSecret("geminiApiKey");
}

export async function isGeminiApiAvailable(context?: WebSearchContext): Promise<boolean> {
  return !!(await getApiKey(context));
}
