"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FoundRace } from "@/lib/midterms/civic";
import { PANEL_TYPES, PANELS, type ChamberOffice, type PanelType } from "@/lib/midterms/decisionView";
import { compareRaces, raceLabel, STATE_NAMES, type RaceSummary } from "@/lib/midterms/view";

export type Choice = { type: PanelType; raceId?: number; office?: ChamberOffice; text?: string };
const OFFICES: { id: ChamberOffice; label: string }[] = [
  { id: "house", label: "U.S. House" },
  { id: "senate", label: "U.S. Senate" },
  { id: "governor", label: "Governors" },
];
const GROUPS: { title: string; types: PanelType[] }[] = [
  { title: "A race", types: PANEL_TYPES.filter((t) => PANELS[t].needs === "race") },
  { title: "A chamber", types: PANEL_TYPES.filter((t) => PANELS[t].needs === "office") },
  { title: "Everything", types: PANEL_TYPES.filter((t) => PANELS[t].needs === "none" || PANELS[t].needs === "text") },
];

/** Tracked races matching a search: state, district, title or candidate. */
function matching(races: readonly RaceSummary[], q: string): RaceSummary[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (r: RaceSummary) => `${raceLabel(r)} ${r.title} ${STATE_NAMES[r.state] ?? ""} ${r.state}-${r.district ?? ""} ${r.candidates.map((c) => c.name).join(" ")}`.toLowerCase();
  return races.filter((r) => r.office !== "measure" || words.length).filter((r) => words.every((w) => hay(r).includes(w))).sort(compareRaces).slice(0, 30);
}

/**
 * "Add element": pick a panel type, then what it shows (a race, tracked or any civicAPI race; a chamber; or a
 * section's name). With `only`, the type is fixed and only the target is asked for (a panel's "Change race").
 */
export function AddElement({ races, only, onPick, onClose }: { races: readonly RaceSummary[]; only?: PanelType; onPick: (c: Choice) => void; onClose: () => void }) {
  const [type, setType] = useState<PanelType | null>(only ?? null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; races: FoundRace[] } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const needs = type ? PANELS[type].needs : null;
  const tracked = useMemo(() => (needs === "race" ? matching(races, q) : []), [needs, races, q]);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Other races (mayors, school boards…) come from civicAPI's search once the query is specific enough.
  useEffect(() => {
    const query = q.trim();
    if (needs !== "race" || query.length < 3) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/midterms/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<{ races?: FoundRace[] }>) : { races: [] }))
        .then((b) => setFound({ q: query, races: b.races ?? [] }))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, needs]);

  const trackedIds = new Set(races.map((r) => r.id));
  const others = found && found.q === q.trim() ? found.races.filter((r) => !trackedIds.has(r.id)) : [];

  return (
    <dialog ref={dialog} className="mt-dv-dialog" onClose={onClose} onCancel={onClose} aria-labelledby="dv-add-title">
      <header>
        <h2 id="dv-add-title">{!type ? "Add element" : PANELS[type].label}</h2>
        <button type="button" className="btn quiet small" onClick={onClose}>Close</button>
      </header>
      {!type && (
        <div className="mt-dv-types">
          {GROUPS.map((g) => (
            <fieldset key={g.title}>
              <legend>{g.title}</legend>
              {g.types.map((t) => (
                <button key={t} type="button" onClick={() => (PANELS[t].needs === "none" ? onPick({ type: t }) : setType(t))}>
                  {PANELS[t].label}
                </button>
              ))}
            </fieldset>
          ))}
        </div>
      )}
      {needs === "office" && (
        <div className="mt-dv-offices">
          {OFFICES.map((o) => (
            <button key={o.id} type="button" className="btn secondary" onClick={() => onPick({ type: type!, office: o.id })}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      {needs === "text" && (
        <form
          className="mt-dv-text"
          onSubmit={(e) => {
            e.preventDefault();
            const text = String(new FormData(e.currentTarget).get("text") ?? "").trim();
            if (text) onPick({ type: type!, text });
          }}
        >
          <input name="text" className="input" maxLength={80} placeholder="US Senate" autoFocus aria-label="Section name" />
          <button className="btn">Add</button>
        </form>
      )}
      {needs === "race" && (
        <div className="mt-dv-races">
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a race, state, district or candidate" autoFocus aria-label="Search races" />
          <ul>
            {tracked.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onPick({ type: type!, raceId: r.id })}>
                  <b>{raceLabel(r)}</b>
                  <span>{r.candidates.slice(0, 2).map((c) => c.name).join(" vs ") || r.title}</span>
                </button>
              </li>
            ))}
            {others.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onPick({ type: type!, raceId: r.id })}>
                  <b>{r.title}</b>
                  <span>{STATE_NAMES[r.state] ?? r.state} · {r.type}</span>
                </button>
              </li>
            ))}
            {!tracked.length && !others.length && <li className="muted small">{q.trim().length < 3 ? "Type to search every race, including mayors and school boards." : "No races match."}</li>}
          </ul>
        </div>
      )}
    </dialog>
  );
}
