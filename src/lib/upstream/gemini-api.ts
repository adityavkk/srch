import { loadConfig } from "../core/config.js";

export const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_MODEL = "gemini-2.5-flash";

export function getApiKey(): string | null {
  return process.env.GEMINI_API_KEY ?? loadConfig().geminiApiKey ?? null;
}

export function isGeminiApiAvailable(): boolean {
  return getApiKey() !== null;
}
