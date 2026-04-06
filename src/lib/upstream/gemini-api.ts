import { resolveSecret } from "../core/secrets.js";

export const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_MODEL = "gemini-2.5-flash";

export async function getApiKey(): Promise<string | null> {
  return resolveSecret("geminiApiKey");
}

export async function isGeminiApiAvailable(): Promise<boolean> {
  return (await getApiKey()) !== null;
}
