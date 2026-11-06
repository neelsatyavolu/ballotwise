// The past-results map's Swing view: how far each place's Democratic-minus-Republican margin moved from the
// presidential race four years earlier (public/midterms/past/swing-*.json, built by scripts/build-past-shift.mjs).

/** A margin now and then, in points of the whole vote, Democrat minus Republican. */
export type Pair = readonly [now: number, then: number];
export type SwingFile = {
  id: string;
  year: number;
  base: number;
  us: Pair;
  states: Record<string, Pair>;
  counties: Record<string, Pair>;
};
export type Swing = { now: number; then: number; shift: number };

/** A place's margins and the move between them, to a tenth as shown; null for a place the file doesn't compare. */
export function swingOf(pair: Pair | undefined): Swing | null {
  if (!pair) return null;
  const [now, then] = pair;
  return { now, then, shift: Math.round((now - then) * 10) / 10 };
}

/** Each county's move to a hundredth, by county code, for coloring the map. */
export function countyShifts(file: SwingFile): Record<string, number> {
  return Object.fromEntries(Object.entries(file.counties).map(([co, [now, then]]) => [co, Math.round((now - then) * 100) / 100]));
}

/** "D+3.3" for a move toward the Democrat, "R+12.0" toward the Republican. */
export function swingLabel(shift: number): string {
  if (Math.abs(shift) < 0.05) return "No change";
  return `${shift > 0 ? "D" : "R"}+${Math.abs(shift).toFixed(1)}`;
}
