"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { foundGroup, matchedCandidates, matchTracked, splitPlace, untracked, type SearchGroup } from "@/lib/midterms/search";
import { STATE_NAMES, type Overview } from "@/lib/midterms/view";
import type { FoundRace } from "@/lib/midterms/civic";
import { useLive, useStars } from "./hooks";
import { ModeNav } from "./ModeNav";
import { DAY, useRaceSearch } from "./RaceSearch";
import { RaceRows, type Star } from "./RaceRows";

const GROUPS: { id: SearchGroup; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tracked", label: "Congress & governors" },
  { id: "measures", label: "Ballot measures" },
  { id: "local", label: "Local" },
  { id: "statewide", label: "County & state" },
];
/** Election day; races on other dates show theirs. */
const NOV_3 = "2026-11-03";
/** Starting points shown before anything is typed. */
const SUGGESTIONS = ["Mayor", "School board", "City council", "Sheriff", "Judge", "Ballot measure", "Senate"];

/** Placeholder rows while a list loads, shaped like the table that replaces them. */
function Loading({ n }: { n: number }) {
  return (
    <div className="mt-skel-rows" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="mt-skel" style={{ height: 18, width: `${92 - (i % 3) * 12}%` }} />
      ))}
    </div>
  );
}

/** civicAPI's races outside the tracked offices, each opening the same race page as tracked ones. */
function FoundRows({ races }: { races: FoundRace[] }) {
  return (
    <div className="mt-rows-wrap">
      <table className="mt-table mt-rows mt-found">
        <thead>
          <tr>
            <th>Race</th>
            <th>Office</th>
            <th>State</th>
            <th className="num">Election</th>
          </tr>
        </thead>
        <tbody>
          {races.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/midterms/${r.id}`}>{r.title}</Link>
                {/* Phones drop the office and state columns and show them here instead. */}
                <span className="mt-row-about mt-found-where">{[r.type, STATE_NAMES[r.state] ?? r.state].filter(Boolean).join(" · ")}</span>
              </td>
              <td>{r.type || "—"}</td>
              <td>{STATE_NAMES[r.state] ?? r.state}</td>
              <td className="num">{r.date === NOV_3 ? "Nov 3" : DAY.format(new Date(`${r.date}T00:00:00Z`))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The Search tab: any race on the ballot, from Senate seats to school boards. Tracked races (Senate, House, governors,
 * statewide measures) match at once, candidates included, and show live; everything else comes from civicAPI's
 * search by office or place. The query lives in the URL so a search can be shared.
 */
export function SearchView({ initialQuery }: { initialQuery: string }) {
  const [q, setQ] = useState(initialQuery);
  const [group, setGroup] = useState<SearchGroup>("all");
  const { data } = useLive<Overview>("/api/midterms");
  const stars = useStars();
  const star: Star = { ids: stars.ids, toggle: stars.toggle };
  const { query, current } = useRaceSearch(q);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  }, [query]);

  const tracked = useMemo(() => (data && query.length >= 2 ? matchTracked(data.races, query) : []), [data, query]);
  const found = useMemo(() => untracked(current?.races ?? [], data?.races ?? []), [current, data]);
  const counts: Record<SearchGroup, number> = {
    all: tracked.length + found.length,
    tracked: tracked.filter((r) => r.office !== "measure").length,
    measures: tracked.filter((r) => r.office === "measure").length + found.filter((r) => foundGroup(r) === "measures").length,
    local: found.filter((r) => foundGroup(r) === "local").length,
    statewide: found.filter((r) => foundGroup(r) === "statewide").length,
  };
  const trackedShown = group === "all" ? tracked : group === "tracked" ? tracked.filter((r) => r.office !== "measure") : group === "measures" ? tracked.filter((r) => r.office === "measure") : [];
  const foundShown = group === "all" ? found : group === "tracked" ? [] : found.filter((r) => foundGroup(r) === group);
  const showTracked = group === "all" || group === "tracked" || group === "measures";
  const showFound = group !== "tracked";
  const searching = query.length >= 2;
  const settled = !!data && !!current;
  // When nothing at all matches, one message replaces both empty sections.
  const nothing = settled && !current?.error && counts.all === 0;
  const parts = nothing ? splitPlace(query) : null;

  return (
    <div className="wrap mt mt-search-page">
      <ModeNav current="/midterms/search" />
      <header className="mt-hero">
        <h1>Search</h1>
        <span className="mt-kicker">Every race on the ballot</span>
      </header>
      <div className="mt-search-box">
        <input
          className="input"
          type="search"
          placeholder="A race, a place or a candidate: Ossoff, Austin mayor, Greenville school board"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search every race"
          autoFocus
        />
      </div>

      {!searching ? (
        <section className="mt-search-start" aria-label="Suggestions">
          <p className="muted small">Search by office or place for any race civicAPI covers: mayors, city councils, school boards, judges, sheriffs and local measures. Candidate names work for Senate, House and governor races.</p>
          <div className="mt-search-chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="btn secondary small" onClick={() => setQ(s)}>
                {s}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className="stack mt-in" aria-live="polite">
          <div className="mt-seg" role="group" aria-label="Show">
            {GROUPS.map((g) => (
              <button key={g.id} type="button" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
                {g.label}
                {settled && <span className="mt-seg-count">{counts[g.id]}</span>}
              </button>
            ))}
          </div>

          {/* Under "All", the tracked block only appears when something in it matches. */}
          {!nothing && showTracked && (group !== "all" || !data || trackedShown.length > 0) && (
            <section aria-labelledby="search-tracked">
              <div className="mt-section-head tight">
                <h2 id="search-tracked">Tracked live</h2>
              </div>
              {!data ? (
                <Loading n={4} />
              ) : trackedShown.length ? (
                <RaceRows races={trackedShown} star={star} note={(r) => matchedCandidates(r, query).join(", ") || null} />
              ) : (
                <p className="mt-empty small">No {group === "measures" ? "statewide measure" : "Senate, House or governor race"} matches &ldquo;{query}&rdquo;.</p>
              )}
            </section>
          )}

          {!nothing && showFound && (
            <section aria-labelledby="search-found">
              <div className="mt-section-head tight">
                <h2 id="search-found">Local, county and state races</h2>
              </div>
              {!current ? (
                <Loading n={6} />
              ) : current.error ? (
                <p className="error small">{current.error}</p>
              ) : foundShown.length ? (
                <FoundRows races={foundShown} />
              ) : (
                <p className="mt-empty small">No other races match &ldquo;{query}&rdquo;{group === "all" ? "" : " in this group"}.</p>
              )}
            </section>
          )}

          {nothing && (
            <div className="mt-empty mt-search-none">
              <p>
                <b>Nothing matches &ldquo;{query}&rdquo;.</b>
              </p>
              <p className="small">
                City, county and school races come from civicAPI, which lists a place&apos;s races once its results feed is loaded. Coverage varies by state and fills in as counties publish, so a race can be missing for now.
              </p>
              {parts && (
                <div className="mt-search-chips">
                  <span className="small">Search for</span>
                  <button type="button" className="btn secondary small" onClick={() => setQ(parts.place)}>
                    {parts.place}
                  </button>
                  <button type="button" className="btn secondary small" onClick={() => setQ(parts.office)}>
                    {parts.office}
                  </button>
                </div>
              )}
            </div>
          )}
          <p className="muted small">
            Results from <a href="https://civicapi.org">civicAPI</a>, up to 25 at a time; add a place to narrow them.
          </p>
        </div>
      )}
    </div>
  );
}
