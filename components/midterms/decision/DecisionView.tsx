"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeShare, GRID_SIZES, openSpot, PANELS, panelId, place, type GridLayout, type GridSize, type Panel } from "@/lib/midterms/decisionView";
import type { RaceSummary } from "@/lib/midterms/view";
import { AddElement, type Choice } from "./AddElement";
import { Board, type PanelAction } from "./Board";
import { DashboardData, useDashboardData } from "./data";

/** Edits settle this long before they're saved, so a drag saves once, not on every cell. */
const SAVE_DELAY_MS = 600;

const raceIdsOf = (layout: GridLayout) => layout.panels.flatMap((p) => (p.raceId ? [p.raceId] : []));

/** The board with the dashboard's data around it, so panel titles can name their races. */
function Canvas({ layout, editable, onChange, onAction }: { layout: GridLayout; editable: boolean; onChange: (panels: Panel[]) => void; onAction: (a: PanelAction) => void }) {
  const { overview, races } = useDashboardData();
  const find = useCallback(
    (id: number): RaceSummary | undefined => {
      const got = races.get(id);
      return got && got !== "missing" ? got.race : overview?.races.find((r) => r.id === id);
    },
    [overview, races],
  );
  return <Board layout={layout} editable={editable} find={find} onChange={onChange} onAction={onAction} />;
}

function Picker({ layout, adding, setAdding, apply }: { layout: GridLayout; adding: { only?: Panel } | null; setAdding: (a: { only?: Panel } | null) => void; apply: (next: GridLayout) => void }) {
  const { overview } = useDashboardData();
  if (!adding) return null;
  const { cols } = GRID_SIZES[layout.size];
  const pick = (c: Choice) => {
    setAdding(null);
    const target = adding.only;
    if (target) {
      apply({ ...layout, panels: layout.panels.map((p) => (p.id === target.id ? { ...p, raceId: c.raceId ?? p.raceId, office: c.office ?? p.office, text: c.text ?? p.text } : p)) });
      return;
    }
    const size = PANELS[c.type];
    const w = Math.min(size.w, cols);
    const spot = openSpot(layout.panels, w, size.h, cols);
    const panel: Panel = { id: panelId(), type: c.type, ...spot, w, h: size.h, ...(c.raceId ? { raceId: c.raceId } : {}), ...(c.office ? { office: c.office } : {}), ...(c.text ? { text: c.text } : {}) };
    apply({ ...layout, panels: [...layout.panels, panel] });
  };
  return <AddElement races={overview?.races ?? []} only={adding.only?.type} onPick={pick} onClose={() => setAdding(null)} />;
}

/**
 * One Decision View dashboard: its name, grid size, share and present controls, and the board. `onSave` gets each
 * settled change; without it the dashboard is read-only (a shared link), with `onCopy` offering to keep a copy.
 */
export function DecisionView({ layout: initial, onSave, onCopy, popout = false, backHref = "/midterms/dashboards" }: { layout: GridLayout; onSave?: (layout: GridLayout) => Promise<boolean>; onCopy?: () => void; popout?: boolean; backHref?: string }) {
  const [layout, setLayout] = useState(initial);
  const [adding, setAdding] = useState<{ only?: Panel } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [saved, setSaved] = useState<"saved" | "saving" | "failed">("saved");
  const [note, setNote] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editable = !!onSave && !presenting;
  const raceIds = useMemo(() => raceIdsOf(layout), [layout]);

  const apply = useCallback(
    (next: GridLayout) => {
      setLayout(next);
      if (!onSave) return;
      setSaved("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void onSave(next).then((ok) => setSaved(ok ? "saved" : "failed")), SAVE_DELAY_MS);
    },
    [onSave],
  );

  useEffect(() => {
    const onFs = () => setPresenting(document.fullscreenElement === wrap.current && !!wrap.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const act = (a: PanelAction) => {
    const { cols } = GRID_SIZES[layout.size];
    if (a.type === "remove") apply({ ...layout, panels: layout.panels.filter((p) => p.id !== a.panel.id) });
    else if (a.type === "duplicate") {
      const copy = { ...a.panel, id: panelId(), ...openSpot(layout.panels, a.panel.w, a.panel.h, cols) };
      apply({ ...layout, panels: [...layout.panels, copy] });
    } else setAdding({ only: a.panel });
  };
  const flash = (text: string) => {
    setNote(text);
    setTimeout(() => setNote(null), 2500);
  };
  const copyLink = async () => {
    const url = `${window.location.origin}/midterms/dashboards/view?d=${encodeShare(layout)}`;
    try {
      await navigator.clipboard.writeText(url);
      flash("Link copied. Anyone with it can view this dashboard.");
    } catch {
      window.prompt("Copy this link:", url);
    }
  };
  const present = () => void wrap.current?.requestFullscreen?.().catch(() => flash("This browser won't go full screen here."));
  const popOut = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("popout", "1");
    window.open(url.toString(), "_blank", "popup,width=1600,height=1000");
  };
  const resize = (size: GridSize) => {
    const { cols } = GRID_SIZES[size];
    // Shrinking the grid squeezes panels into its columns, then settles overlaps.
    let panels = layout.panels.map((p) => ({ ...p, w: Math.min(p.w, cols), x: Math.min(p.x, cols - Math.min(p.w, cols)) }));
    for (const p of panels) panels = place(panels, p.id, p, cols);
    apply({ ...layout, size, panels });
  };

  return (
    <DashboardData raceIds={raceIds}>
      <div ref={wrap} className={`wrap mt mt-dv${popout ? " mt-dv-popout" : ""}${presenting ? " presenting" : ""}`}>
        <div className="mt-dv-bar">
          <p className="mt-dv-crumb">
            <Link href={backHref}>Decision View</Link>
            <span aria-hidden>›</span>
            {renaming && onSave ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const title = String(new FormData(e.currentTarget).get("title") ?? "").trim();
                  if (title) apply({ ...layout, title });
                  setRenaming(false);
                }}
              >
                <input name="title" className="input" defaultValue={layout.title} maxLength={80} autoFocus aria-label="Dashboard name" onBlur={(e) => e.currentTarget.form?.requestSubmit()} />
              </form>
            ) : (
              <b>{layout.title}</b>
            )}
            {onSave && !renaming && (
              <button type="button" className="mt-dv-icon" aria-label="Rename dashboard" onClick={() => setRenaming(true)}>✎</button>
            )}
            {onSave && <span className={`mt-dv-saved ${saved}`} aria-live="polite">{saved === "saving" ? "Saving…" : saved === "failed" ? "Not saved" : "Saved"}</span>}
          </p>
          <div className="mt-dv-actions">
            {onSave && (
              <select className="input mt-select" value={layout.size} onChange={(e) => resize(e.target.value as GridSize)} aria-label="Grid size">
                {(Object.keys(GRID_SIZES) as GridSize[]).map((s) => (
                  <option key={s} value={s}>{s.replace("x", " × ")}</option>
                ))}
              </select>
            )}
            <button type="button" className="btn secondary small" onClick={() => void copyLink()}>Copy link</button>
            <button type="button" className="btn secondary small mt-dv-present" onClick={present}>▷ Present</button>
            {!popout && <button type="button" className="btn secondary small" onClick={popOut}>Pop out</button>}
            {onCopy && <button type="button" className="btn small mt-dv-add" onClick={onCopy}>Save a copy</button>}
            {onSave && <button type="button" className="btn small mt-dv-add" onClick={() => setAdding({})}>+ Add element</button>}
          </div>
        </div>
        {note && <p className="mt-dv-note" role="status">{note}</p>}
        <Canvas layout={layout} editable={editable} onChange={(panels) => apply({ ...layout, panels })} onAction={act} />
        <Picker layout={layout} adding={adding} setAdding={setAdding} apply={apply} />
      </div>
    </DashboardData>
  );
}
