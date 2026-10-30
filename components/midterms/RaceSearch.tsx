"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { FoundRace } from "@/lib/midterms/civic";
import { SANTA_CLARA_RESULTS, STATE_NAMES } from "@/lib/midterms/view";

/** How long typing pauses before a search goes out. */
const DEBOUNCE_MS = 300;
export const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * civicAPI's races matching `q` (two letters or more), searched once typing pauses. `current` is null while a search
 * for the latest query is still out; then it holds that query's races, or an error to show.
 */
export function useRaceSearch(q: string) {
  const [state, setState] = useState<{ q: string; races: FoundRace[] | null; error: string | null }>({ q: "", races: null, error: null });
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/midterms/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then(async (res) => {
          const body = (await res.json()) as { races?: FoundRace[]; error?: string };
          setState({ q: query, races: res.ok ? (body.races ?? []) : null, error: res.ok ? null : (body.error ?? "Search failed. Try again.") });
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setState({ q: query, races: null, error: "Search failed. Try again." });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);
  const query = q.trim();
  return { query, current: query.length >= 2 && state.q === query ? state : null };
}

/**
 * "Find any race": searches civicAPI for races outside the tracked offices (mayors, county seats, school boards,
 * judges, local questions). Each result opens the same race page as tracked races.
 */
export function RaceSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const { query, current } = useRaceSearch(q);
  const listId = useId();
  return (
    <div className="mt-find">
      <input
        className="input mt-search"
        type="search"
        placeholder="Find any race: mayor, school board, a city or county"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Find any race"
        aria-controls={listId}
        autoFocus={autoFocus}
      />
      <div id={listId} aria-live="polite">
        {query.length >= 2 && !current && <p className="muted small">Searching…</p>}
        {current?.error && <p className="error small">{current.error}</p>}
        {current?.races && current.races.length === 0 && <p className="muted small">No US races from 2026 match &ldquo;{query}&rdquo;.</p>}
        {current?.races && current.races.length > 0 && (
          <ul className="mt-find-list">
            {current.races.map((r) => (
              <li key={r.id}>
                <Link href={`/midterms/${r.id}`}>
                  <span className="mt-find-title">{r.title}</span>
                  <span className="mt-find-meta">
                    {[STATE_NAMES[r.state] ?? r.state, r.type, r.date === "2026-11-03" ? null : DAY.format(new Date(`${r.date}T00:00:00Z`))].filter(Boolean).join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A small button that opens RaceSearch in a dialog, for toolbars with no room for a search box. */
export function RaceSearchButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn secondary small"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
        title="Mayors, county seats, school boards, judges and local questions"
      >
        Other races
      </button>
      <dialog ref={dialog} className="mt-find-dialog" aria-label="Find any race" onClose={() => setOpen(false)} onClick={(e) => e.target === dialog.current && dialog.current?.close()}>
        <div className="mt-find-head">
          <h2>Find any race</h2>
          <button type="button" className="btn quiet small" onClick={() => dialog.current?.close()} aria-label="Close">
            ✕
          </button>
        </div>
        {open && <RaceSearch autoFocus />}
        <p className="muted small">Results from <a href="https://civicapi.org">civicAPI</a> and <a href={SANTA_CLARA_RESULTS}>Santa Clara County</a>.</p>
      </dialog>
    </>
  );
}
