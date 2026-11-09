import { resolveSecret } from "../core/secrets.js";
import type { WebSearchContext } from "./context.js";

export const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_MODEL = "gemini-2.5-flash";

export async function getApiKey(context?: WebSearchContext, signal?: AbortSignal): Promise<string | null> {
  return context ? context.secrets.resolve("geminiApiKey", signal) : resolveSecret("geminiApiKey", signal);
}

export async function isGeminiApiAvailable(context?: WebSearchContext, signal?: AbortSignal): Promise<boolean> {
  return !!(await getApiKey(context, signal));
}
