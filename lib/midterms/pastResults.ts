// Results for the past-elections precinct map: the rows its tooltips and sidebar show, and each place's margin.

/** The three candidates the map tells apart in each state: the Democrat, the Republican and the strongest other. */
export type Slot = "d" | "r" | "a";
export type Named = { name: string; party: string };
export type Candidate = Named & { votes: number };
export type StateSummary = { slots: Partial<Record<Slot, Named>>; cands: Candidate[]; total: number };
export type Summary = { id: string; year: number; office: string; states: Record<string, StateSummary> };
/** Votes on a precinct, county or state in the tiles: one count per slot, and every vote cast. */
export type Votes = { d: number; r: number; a: number; t: number };

/** A row in a results table. `slot` ties it to the map's colors; Others and write-ins have none. */
export type Row = Candidate & { slot: Slot | null };

const SLOTS: Slot[] = ["d", "r", "a"];
const byVotes = (a: Row, b: Row) => b.votes - a.votes;

/** A place's candidates by votes, from its counts and its state's candidates, with the rest of the vote as Others. */
export function rowsFor(votes: Votes, slots: Partial<Record<Slot, Named>>): Row[] {
  const named = SLOTS.flatMap((slot) => {
    const c = slots[slot];
    return c ? [{ ...c, votes: votes[slot], slot }] : [];
  });
  const others = votes.t - named.reduce((n, c) => n + c.votes, 0);
  const rows: Row[] = [...named.sort(byVotes)];
  return others > 0 ? [...rows, { name: "Others", party: "", votes: others, slot: null }] : rows;
}

/** The leader and their lead over the runner-up, in points of the whole vote; null with no votes or a tie at the top. */
export function marginOf(rows: Row[]): { leader: Row; pct: number } | null {
  const total = rows.reduce((n, r) => n + r.votes, 0);
  const [first, second] = [...rows].filter((r) => r.slot).sort(byVotes);
  if (!first || total === 0 || first.votes === (second?.votes ?? 0)) return null;
  return { leader: first, pct: ((first.votes - (second?.votes ?? 0)) / total) * 100 };
}

const PARTY_LABELS: Record<string, string> = { DEM: "Democrats", GOP: "Republicans" };

/**
 * The nationwide table. A presidential race adds each candidate up across the states; Senate and governor races are
 * separate contests, so they add up by party, with every minor party together as Others.
 */
export function nationRows(states: Record<string, StateSummary>, sameCandidates: boolean): Row[] {
  const totals = new Map<string, Row>();
  // A presidential candidate can run on a different minor-party line from state to state: one row, under the party
  // that brought in the most votes.
  const lines = new Map<string, Map<string, number>>();
  for (const s of Object.values(states)) {
    for (const c of s.cands) {
      const party = c.party === "DEM" || c.party === "GOP" ? c.party : "";
      const key = sameCandidates ? (c.party ? c.name : "Others") : party || "Others";
      const name = sameCandidates ? (c.party ? c.name : "Others") : PARTY_LABELS[party] ?? "Others";
      const prev = totals.get(key);
      totals.set(key, { name, party: "", slot: null, votes: (prev?.votes ?? 0) + c.votes });
      const byParty = lines.get(key) ?? new Map<string, number>();
      const shown = sameCandidates ? c.party : party;
      lines.set(key, byParty.set(shown, (byParty.get(shown) ?? 0) + c.votes));
    }
  }
  const rows = [...totals.entries()].map(([key, row]) => {
    const [party] = [...(lines.get(key) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1])[0] ?? [""];
    // The color follows the party shown.
    const slot: Slot | null = party === "DEM" ? "d" : party === "GOP" ? "r" : party ? "a" : null;
    return { ...row, party, slot };
  });
  // Others always goes last, whatever its size.
  return [...rows.filter((r) => r.name !== "Others").sort(byVotes), ...rows.filter((r) => r.name === "Others")];
}

/** "Donald J. Trump" → "Trump", keeping a lowercase particle: "Kevin de León" → "de León". */
export function lastName(name: string): string {
  const words = name.trim().split(/\s+/);
  let i = words.length - 1;
  while (i > 0 && /^[a-z]/.test(words[i - 1])) i--;
  return words.slice(i).join(" ");
}

/** Baltimore and St. Louis are cities that count as their own county, as are Virginia's (FIPS 51510 and up). */
const CITIES = new Set(["24510", "29510"]);
const BARE = new Set(["AK", "CT", "DC"]);

/**
 * A county's full name: "Fresno County", "Orleans Parish", "Richmond City" (Virginia has a Richmond County too).
 * Alaska's boroughs, Connecticut's planning regions and DC go as they are.
 */
export function countyLabel(st: string, co: string, name: string): string {
  if (!name || BARE.has(st) || /\b(County|Parish|City|Borough)$/.test(name)) return name;
  if (CITIES.has(co) || (st === "VA" && Number(co) >= 51510)) return `${name} City`;
  return `${name} ${st === "LA" ? "Parish" : "County"}`;
}
