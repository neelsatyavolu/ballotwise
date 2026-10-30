"use client";

// The Near you page's map: the voter's state by county, framed on their county, shaded by early vote, the top race's
// count, or the 2024 presidential vote; beside it, how their own county stands.
import { useMemo, useState } from "react";
import { shareOf2024, type EarlyCounty, type EarlyStateDetail } from "@/lib/midterms/earlyVote";
import type { CountyResult, RaceDetail } from "@/lib/midterms/races";
import { fmt, lead, marginLabel, pct, raceLabel, STATE_NAMES } from "@/lib/midterms/view";
import { CountyTip, fillFor } from "./county";
import { dayLabel, PartyBar, Stats, TurnoutLegend, turnoutFill } from "./EarlyVoteState";
import { useLive } from "./hooks";
import { CountyMap, type CountyFill } from "./maps";
import { partyColor } from "./party";

type MapMode = "early" | "results" | "2024";
const MODE_LABEL: Record<MapMode, string> = { early: "Early vote", results: "Leader", "2024": "2024 president" };

function EarlyTip({ county }: { county: EarlyCounty }) {
  const share = shareOf2024(county.cast, county.base2024);
  return (
    <div className="mt-ev-tip">
      <b>{county.name}</b>
      <span>{fmt(county.cast)} ballots cast{share !== null && ` · ${pct(share)} of the 2024 vote`}</span>
    </div>
  );
}

function Legend({ mode, race }: { mode: MapMode; race: RaceDetail | null }) {
  if (mode === "early") return <TurnoutLegend />;
  const keys =
    mode === "2024"
      ? [{ name: "Harris", color: "var(--dem)" }, { name: "Trump", color: "var(--rep)" }]
      : (race?.candidates.slice(0, 4) ?? []).map((c) => ({ name: c.name, color: partyColor(c) }));
  return (
    <div className="mt-legend">
      {keys.map((k) => (
        <span key={k.name}>
          <i style={{ background: k.color }} />
          {k.name}
        </span>
      ))}
      <span>{mode === "2024" ? "darker is a wider margin" : "darker is a wider lead"}</span>
    </div>
  );
}

/** How the top race stands in the voter's county: the count once it starts, before that its 2024 presidential vote. */
function CountyRace({ race, county }: { race: RaceDetail; county: CountyResult }) {
  const ahead = lead(county.candidates);
  return (
    <div className="ny-county-race">
      <span className="muted small">{raceLabel(race)} here</span>
      {county.total > 0 && ahead ? (
        <b>
          <i style={{ background: partyColor(ahead.leader) }} /> {ahead.leader.name} +{ahead.margin.toFixed(1)}
          <span className="muted"> · {fmt(county.total)} votes</span>
        </b>
      ) : county.baseline2024 !== null ? (
        <b>
          2024: {marginLabel(county.baseline2024)}
          <span className="muted"> · no votes counted yet</span>
        </b>
      ) : (
        <b className="muted">No votes counted yet</b>
      )}
    </div>
  );
}

export function NearYouMap({ state, fips, raceId }: { state: string; fips: string | null; raceId: number | null }) {
  const early = useLive<EarlyStateDetail>(`/api/midterms/early-vote/${state}`);
  const detail = useLive<{ race: RaceDetail }>(raceId ? `/api/midterms/race/${raceId}` : null);
  const race = detail.data?.race ?? null;
  const hasEarly = !!early.data && !early.data.byTown && early.data.counties.some((c) => c.fips);
  const modes = (["early", "results", "2024"] as const).filter((m) => (m === "early" ? hasEarly : !!race?.counties.some((c) => c.fips)));
  const [picked, setPicked] = useState<MapMode | null>(null);
  // Once votes are counted the race's count leads; before that, the early vote is what's moving.
  const mode = picked && modes.includes(picked) ? picked : race && race.total > 0 && modes.includes("results") ? "results" : modes[0] ?? null;
  // The map opens framed on the voter's county; "All of …" clears it.
  const [selected, setSelected] = useState<string | null | undefined>(undefined);
  const focus = selected === undefined ? fips : selected;

  const fills = useMemo(() => {
    const out = new Map<string, CountyFill>();
    if (mode === "early") {
      for (const c of early.data?.counties ?? []) if (c.fips) out.set(c.fips, { fill: turnoutFill(shareOf2024(c.cast, c.base2024)), tip: <EarlyTip county={c} />, active: true });
    } else if (mode) {
      for (const c of race?.counties ?? []) if (c.fips) out.set(c.fips, { fill: fillFor(c, mode), tip: <CountyTip county={c} mode={mode} />, active: true });
    }
    return out;
  }, [mode, early.data, race]);

  const myEarly = early.data?.counties.find((c) => c.fips === fips) ?? null;
  const myRace = race?.counties.find((c) => c.fips === fips) ?? null;
  const name = myEarly?.name ?? myRace?.name ?? null;

  return (
    <div className="ny-top mt-in">
      <section className="ny-map" aria-labelledby="ny-map">
        <div className="mt-section-head tight">
          <h2 id="ny-map">{STATE_NAMES[state] ?? state}</h2>
          {modes.length > 1 && mode && (
            <div className="mt-seg" role="group" aria-label="Map shows">
              {modes.map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setPicked(m)}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          )}
        </div>
        {mode ? (
          <>
            <CountyMap state={state} fills={fills} selected={focus ?? null} onSelect={setSelected} />
            <Legend mode={mode} race={race} />
          </>
        ) : (
          <p className="muted small">{early.error || detail.error ? "The map's data couldn't load. It will try again shortly." : "Loading the map…"}</p>
        )}
      </section>

      <aside className="ny-panel" aria-label="Your county">
        <div>
          <span className="muted small">Your county</span>
          <h2>{name ?? "—"}</h2>
        </div>
        {race && myRace && <CountyRace race={race} county={myRace} />}
        {myEarly ? (
          <>
            <span className="muted small">Early vote{early.data?.asOf ? ` as of ${dayLabel(early.data.asOf)}` : ""}</span>
            <Stats counts={myEarly} base2024={myEarly.base2024} />
            {myEarly.party && <PartyBar party={myEarly.party} />}
          </>
        ) : (
          <p className="muted small">{early.data ? "No early vote figures for your county yet." : early.error ? "Early vote figures aren't available for your state." : "Loading early vote…"}</p>
        )}
      </aside>
    </div>
  );
}
