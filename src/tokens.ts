/**
 * Rough token estimate for a string, no tokenizer dependency.
 *
 * We deliberately avoid pulling in tiktoken/wasm: skillstat is meant to be a
 * zero-dependency, offline, AI-free tool. The heuristic below blends a
 * chars-per-token ratio with a word count, which tracks the real BPE token
 * count for English prose (skill descriptions) to within ~10-15%. Every number
 * skillstat prints from this is labeled an estimate.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chars = text.length;
  const words = text.trim().split(/\s+/).length;
  // ~4 chars/token and ~0.75 words/token; average the two signals.
  const byChars = chars / 4;
  const byWords = words / 0.75;
  return Math.round((byChars + byWords) / 2);
}

/** Format a token count compactly: 12345 → "12.3k". */
export function fmtTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}
