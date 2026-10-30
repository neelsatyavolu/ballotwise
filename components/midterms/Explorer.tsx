"use client";

import { useMemo, useState } from "react";
import { activeCount, DEFAULT_FILTERS, explore, viewCounts, type Filters, type Leader, type Sort, type Status, type Tier, type View } from "@/lib/midterms/explore";
import { closeWaves, formatET } from "@/lib/midterms/polls";
import { STATE_NAMES, type RaceSummary } from "@/lib/midterms/view";
import { useClock } from "./hooks";
import { RaceSearchButton } from "./RaceSearch";
import { ResultList, type Stars } from "./ResultList";
import { parseIds, useStored } from "./seen";

const VIEWS: { id: View; label: string; title: string }[] = [
  { id: "all", label: "All", title: "Every race in this office" },
  { id: "mine", label: "★ Starred", title: "Races you starred" },
  { id: "key", label: "Key races", title: "Rated toss-up, lean or likely by markets or polls" },
  { id: "uncalled", label: "Uncalled", title: "Not called yet" },
  { id: "close", label: "Close", title: "Votes counted, lead under 5 points, not called" },
  { id: "gains", label: "Called gains & leading flips", title: "Called for a different party than holds the seat now, or led by one (early leads, under 25% reporting, are marked Early)" },
];
const STATUSES: { id: Status; label: string }[] = [
  { id: "awaiting", label: "No votes yet" },
  { id: "counting", label: "Counting" },
  { id: "called", label: "Called" },
];
const TIERS: { id: Tier; label: string }[] = [
  { id: "tossup", label: "Toss-up" },
  { id: "lean", label: "Lean" },
  { id: "likely", label: "Likely" },
  { id: "safe", label: "Safe" },
  { id: "unrated", label: "Unrated" },
];
const LEADERS: { id: Leader; label: string }[] = [
  { id: "D", label: "Dem ahead" },
  { id: "R", label: "Rep ahead" },
  { id: "other", label: "Other ahead" },
  { id: "yes", label: "Yes ahead" },
  { id: "no", label: "No ahead" },
];
const MARGINS = [1, 3, 5, 10];
const REPORTING = [25, 50, 75, 90];
const SORTS: { id: Sort; label: string }[] = [
  { id: "close", label: "Closest first" },
  { id: "competitive", label: "Most competitive" },
  { id: "called", label: "Latest calls" },
  { id: "reporting", label: "Most reported" },
  { id: "closing", label: "Poll closing time" },
  { id: "state", label: "State A–Z" },
];
const WAVES = closeWaves();

const toggle = <T,>(list: readonly T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

function Chips<T extends string | number>({ label, options, picked, onToggle }: { label: string; options: { id: T; label: string }[]; picked: readonly T[]; onToggle: (id: T) => void }) {
  return (
    <fieldset className="mt-fx-group">
      <legend>{label}</legend>
      <div>
        {options.map((o) => (
          <button key={String(o.id)} type="button" className={`mt-chip${picked.includes(o.id) ? " on" : ""}`} aria-pressed={picked.includes(o.id)} onClick={() => onToggle(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Every filter that's on, as chips that remove themselves. */
function ActiveChips({ f, set }: { f: Filters; set: (next: Partial<Filters>) => void }) {
  const chips: { key: string; label: string; clear: Partial<Filters> }[] = [
    ...(f.q.trim() ? [{ key: "q", label: `“${f.q.trim()}”`, clear: { q: "" } }] : []),
    ...f.states.map((s) => ({ key: `s${s}`, label: STATE_NAMES[s] ?? s, clear: { states: f.states.filter((x) => x !== s) } })),
    ...f.status.map((s) => ({ key: `st${s}`, label: STATUSES.find((x) => x.id === s)!.label, clear: { status: f.status.filter((x) => x !== s) } })),
    ...f.tiers.map((t) => ({ key: `t${t}`, label: TIERS.find((x) => x.id === t)!.label, clear: { tiers: f.tiers.filter((x) => x !== t) } })),
    ...f.leaders.map((l) => ({ key: `l${l}`, label: LEADERS.find((x) => x.id === l)!.label, clear: { leaders: f.leaders.filter((x) => x !== l) } })),
    ...(f.maxMargin !== null ? [{ key: "m", label: `Lead ≤ ${f.maxMargin} pts`, clear: { maxMargin: null } }] : []),
    ...(f.minReporting !== null ? [{ key: "in", label: `≥ ${f.minReporting}% reporting`, clear: { minReporting: null } }] : []),
    ...f.waves.map((w) => ({ key: `w${w}`, label: `Polls close ${formatET(w)}`, clear: { waves: f.waves.filter((x) => x !== w) } })),
  ];
  if (!chips.length) return null;
  return (
    <div className="mt-fx-active" aria-label="Filters on">
      {chips.map((c) => (
        <button key={c.key} type="button" className="mt-chip on removable" onClick={() => set(c.clear)} aria-label={`Remove filter ${c.label}`}>
          {c.label} <span aria-hidden>×</span>
        </button>
      ))}
      <button type="button" className="btn quiet small" onClick={() => set({ q: "", states: [], status: [], tiers: [], leaders: [], maxMargin: null, minReporting: null, waves: [] })}>
        Clear all
      </button>
    </div>
  );
}

function Panel({ f, set, states, onClose }: { f: Filters; set: (next: Partial<Filters>) => void; states: string[]; onClose: () => void }) {
  return (
    <div className="mt-fx-panel" role="region" aria-label="More filters">
      <fieldset className="mt-fx-group">
        <legend>States</legend>
        <select className="input mt-select" value="" onChange={(e) => e.target.value && set({ states: toggle(f.states, e.target.value) })} aria-label="Add a state">
          <option value="">Add a state…</option>
          {states.filter((s) => !f.states.includes(s)).map((s) => (
            <option key={s} value={s}>{STATE_NAMES[s] ?? s}</option>
          ))}
        </select>
      </fieldset>
      <Chips label="Count" options={STATUSES} picked={f.status} onToggle={(s) => set({ status: toggle(f.status, s) })} />
      <Chips label="Rating before the vote" options={TIERS} picked={f.tiers} onToggle={(t) => set({ tiers: toggle(f.tiers, t) })} />
      <Chips label="Who's ahead" options={LEADERS} picked={f.leaders} onToggle={(l) => set({ leaders: toggle(f.leaders, l) })} />
      <Chips label="Lead at most" options={MARGINS.map((m) => ({ id: m, label: `${m} pts` }))} picked={f.maxMargin === null ? [] : [f.maxMargin]} onToggle={(m) => set({ maxMargin: f.maxMargin === m ? null : m })} />
      <Chips label="Reporting at least" options={REPORTING.map((p) => ({ id: p, label: `${p}%` }))} picked={f.minReporting === null ? [] : [f.minReporting]} onToggle={(p) => set({ minReporting: f.minReporting === p ? null : p })} />
      <Chips label="Last polls close (Eastern)" options={WAVES.map((w) => ({ id: w.at, label: formatET(w.at).replace(" ET", "") }))} picked={f.waves} onToggle={(w) => set({ waves: toggle(f.waves, w) })} />
      <button type="button" className="btn secondary small" onClick={onClose}>Done</button>
    </div>
  );
}

/** Search, quick views, more filters (count status among them) and sort over one office's races, all kept in the URL. */
export function Explorer({ races, f, set, stars }: { races: readonly RaceSummary[]; f: Filters; set: (next: Partial<Filters>) => void; stars: Stars }) {
  const [open, setOpen] = useState(false);
  // A frozen order is kept in this browser for the night, so a reload doesn't reshuffle the rows.
  const [heldRaw, setHeldRaw] = useStored("mt-freeze");
  const held = useMemo(() => parseIds(heldRaw), [heldRaw]);
  const setHeld = (next: number[] | null) => setHeldRaw(next ? JSON.stringify(next) : null);
  const now = useClock(30_000);
  const list = useMemo(() => explore(races, f, stars.ids), [races, f, stars.ids]);
  // "Hold order" keeps rows where they are while results move; new matches go to the bottom.
  const ordered = useMemo(() => {
    if (!held) return list;
    const at = new Map(held.map((id, i) => [id, i]));
    return [...list].sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity));
  }, [list, held]);
  const counts = useMemo(() => viewCounts(races, f, stars.ids), [races, f, stars.ids]);
  const states = useMemo(() => [...new Set(races.filter((r) => f.office === "all" || r.office === f.office).map((r) => r.state))].sort((a, b) => (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b)), [races, f.office]);
  // Choosing a sort means wanting that order, so it releases a frozen one.
  const sortBy = (sort: Sort) => {
    setHeld(null);
    set({ sort });
  };
  const extra = activeCount(f) - (f.q.trim() ? 1 : 0);

  return (
    <section className="mt-fx" aria-label="Races">
      <div className="mt-fx-bar">
        <input className="input mt-search" type="search" placeholder="Search a race, state or candidate" value={f.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search races" />
        <button type="button" className={`btn secondary small${extra ? " has" : ""}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          Filters{extra ? ` (${extra})` : ""}
        </button>
        <select className="input mt-select" value={f.sort} onChange={(e) => sortBy(e.target.value as Sort)} aria-label="Sort by">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button type="button" className="btn secondary small mt-fx-freeze" aria-pressed={!!held} onClick={() => setHeld(held ? null : list.map((r) => r.id))} title="Stop rows moving as new votes come in">
          {held ? "Unfreeze" : "Freeze"}
        </button>
        <RaceSearchButton />
      </div>

      <div className="mt-fx-row">
        <div className="mt-fx-views" role="group" aria-label="Quick views">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" className={`mt-chip${f.view === v.id ? " on" : ""}`} aria-pressed={f.view === v.id} title={v.title} onClick={() => set({ view: v.id })}>
              {v.label} <span className="mt-chip-n">{counts[v.id]}</span>
            </button>
          ))}
        </div>
        <p className="muted small mt-fx-count" aria-live="polite">
          {ordered.length} {ordered.length === 1 ? "race" : "races"}
          {f.view !== DEFAULT_FILTERS.view || activeCount(f) ? " match" : ""}
        </p>
      </div>

      {open && <Panel f={f} set={set} states={states} onClose={() => setOpen(false)} />}
      <ActiveChips f={f} set={set} />
      {f.view === "mine" && stars.ids && !stars.ids.length && <p className="muted small">Tap ☆ on any race to keep it here.</p>}
      {ordered.length === 0 && activeCount(f) + (f.view !== "all" ? 1 : 0) > 0 && (
        <p className="small">
          <button type="button" className="mt-linkish" onClick={() => set({ view: "all", q: "", states: [], status: [], tiers: [], leaders: [], maxMargin: null, minReporting: null, waves: [] })}>
            Clear every filter
          </button>
        </p>
      )}
      <ResultList key={`${f.office}${f.view}${f.sort}`} races={ordered} stars={stars} sort={f.sort} now={now} frozen={!!held} />
    </section>
  );
}
