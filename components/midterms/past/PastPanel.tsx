// The past-elections map's sidebar: where you are, which race, its results and the color key.
import { nationRows, rowsFor, type Row, type Summary, type Votes } from "@/lib/midterms/pastResults";
import { ELECTIONS, OFFICES, type Office } from "./elections";
import { ResultsTable } from "./Results";
import { LEGEND } from "./style";

/** A picked state, or a county with its votes (null when it has none in this election). */
export type Place = { st: string; stateName: string; co?: string; county?: string; votes?: Votes | null };

/** A state's candidates as table rows, each tied to its map color by matching the state's three slots. */
function stateRows(summary: Summary, st: string): Row[] | null {
  const s = summary.states[st];
  if (!s) return null;
  const slotOf = (name: string) => (["d", "r", "a"] as const).find((k) => s.slots[k]?.name === name) ?? null;
  return s.cands.map((c) => ({ ...c, slot: c.party ? slotOf(c.name) : null }));
}

/** The table's rows, or null when the place had no such race. */
function rowsForPlace(summary: Summary, office: Office, place: Place | null): Row[] | null {
  if (!place) return nationRows(summary.states, office === "president");
  const state = summary.states[place.st];
  if (!state) return null;
  if (place.co) return place.votes ? rowsFor(place.votes, state.slots) : null;
  return stateRows(summary, place.st);
}

export function PastPanel({ electionId, onElection, summary, place, onNation, onState }: {
  electionId: string;
  onElection: (id: string) => void;
  summary: Summary | null | "error";
  place: Place | null;
  onNation: () => void;
  onState: (st: string) => void;
}) {
  const election = ELECTIONS.find((e) => e.id === electionId) ?? ELECTIONS[0];
  const years = ELECTIONS.filter((e) => e.office === election.office);
  const officeLabel = OFFICES.find((o) => o.id === election.office)?.label ?? "";
  const when = election.label ? `the ${election.label}` : election.year;
  const rows = summary && summary !== "error" ? rowsForPlace(summary, election.office, place) : null;

  return (
    <aside className="mt-past-panel" aria-label="Results">
      <nav className="mt-past-crumbs" aria-label="Place">
        {place ? <button onClick={onNation}>United States</button> : null}
        {place?.county ? <button onClick={() => onState(place.st)}>{place.stateName}</button> : null}
      </nav>
      <h1>{place ? place.county ?? place.stateName : "United States"}</h1>

      <label className="sr-only" htmlFor="mt-past-office">Office</label>
      <select
        id="mt-past-office"
        className="mt-past-office"
        value={election.office}
        onChange={(e) => onElection(ELECTIONS.find((x) => x.office === e.target.value)?.id ?? electionId)}
      >
        {OFFICES.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <div className="mt-past-years" role="group" aria-label="Year">
        {[...years].sort((a, b) => a.year - b.year || Number(Boolean(a.label)) - Number(Boolean(b.label))).map((e) => (
          <button key={e.id} aria-pressed={e.id === electionId} onClick={() => onElection(e.id)}>{e.label ?? e.year}</button>
        ))}
      </div>

      {summary === "error" ? (
        <p className="muted">These results didn&rsquo;t load. Try again in a moment.</p>
      ) : !summary ? (
        <p className="muted">Loading results…</p>
      ) : rows ? (
        <>
          {!place && election.office !== "president" ? <p className="mt-past-note">All {officeLabel.toLowerCase()} races in {when}, by party.</p> : null}
          <ResultsTable rows={rows} />
        </>
      ) : (
        <p className="muted">
          {place?.co && summary.states[place.st] ? `No results for ${place.county} in ${when}.` : `No ${officeLabel.toLowerCase()} race in ${place?.stateName} in ${when}.`}
        </p>
      )}

      <div className="mt-past-legend" aria-label="Margin key">
        {(["d", "r", "a"] as const).map((k) => (
          <div key={k}>
            {LEGEND.ramps[k].map((c) => <i key={c} style={{ background: c }} />)}
          </div>
        ))}
        <p>
          {LEGEND.stops.map((s, i) => <span key={s}>{i === 0 ? "0" : `${s}+`}</span>)}
        </p>
        <small>Margin in points. Blue: Democrat, red: Republican, purple: anyone else.</small>
      </div>

      <p className="mt-past-sources">
        Precinct results from the <a href="https://github.com/nytimes/presidential-precinct-map-2024">New York Times</a> (2024),
        the <a href="https://dataverse.harvard.edu/dataverse/electionscience">Voting and Election Science Team</a> (2016, 2018, 2020) and
        California&rsquo;s <a href="https://statewidedatabase.org/">Statewide Database</a> (2018). In 2024, counties and states show official totals
        from the <a href="https://github.com/MEDSL/2024-elections-official">MIT Election Lab</a>, and Alaska is shown by state House district, since
        the Times has no precincts there or in a few counties. Other years&rsquo; totals add up the precincts, so they can differ slightly from
        certified results.
      </p>
    </aside>
  );
}
