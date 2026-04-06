export function summarizeBestChunk(text: string | undefined): string | null {
  if (!text) return null;
  const first = text.split("\n").map((line) => line.trim()).find(Boolean);
  return first ?? null;
}
