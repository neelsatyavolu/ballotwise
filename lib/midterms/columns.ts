// Resizable columns for the side-by-side screen, kept free of React so the math can be tested on its own.

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Column shares after dragging the divider right of column `i` by `dx` pixels: that column and the next trade
 * width, each kept at least its `mins` pixels wide. `width` is the room the columns share, gaps left out.
 */
export function resize(weights: readonly number[], i: number, dx: number, width: number, mins: readonly number[]): number[] {
  const perShare = width / weights.reduce((a, b) => a + b, 0);
  const pair = weights[i] + weights[i + 1];
  const lo = mins[i] / perShare;
  const hi = pair - mins[i + 1] / perShare;
  const left = round(Math.min(hi, Math.max(lo, weights[i] + dx / perShare)));
  return weights.map((w, j) => (j === i ? left : j === i + 1 ? round(pair - left) : w));
}

/** Saved column shares, or null when there are none or they're damaged or for a different number of columns. */
export function parseWeights(raw: string | null, n: number): number[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length === n && parsed.every((w) => typeof w === "number" && w > 0) ? parsed : null;
  } catch {
    return null;
  }
}
