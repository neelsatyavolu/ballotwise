"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from "react";
import { fitted, GRID_SIZES, PANELS, place, type GridLayout, type Panel } from "@/lib/midterms/decisionView";
import type { RaceSummary } from "@/lib/midterms/view";
import { PanelBody, panelHref, panelTitle } from "./Panels";

type Rect = { x: number; y: number; w: number; h: number };
export type PanelAction = { type: "change" | "duplicate" | "remove" | "rename"; panel: Panel };

/** Rows never get shorter than this, so small grids on short windows stay legible. */
const MIN_ROW = 34;
/** The space between cells, as .mt-dv-board's gap. */
const GAP = 6;

/** Each row's height: the grid's rows and the gaps between them fill the window below the board's top edge, down to MIN_ROW. */
function useRowHeight(board: React.RefObject<HTMLDivElement | null>, rows: number) {
  const [row, setRow] = useState(MIN_ROW);
  useLayoutEffect(() => {
    const measure = () => {
      const top = board.current?.getBoundingClientRect().top ?? 0;
      setRow(Math.max(MIN_ROW, Math.floor((window.innerHeight - Math.max(0, top) - 12 - (rows - 1) * GAP) / rows)));
    };
    measure();
    window.addEventListener("resize", measure);
    document.addEventListener("fullscreenchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("fullscreenchange", measure);
    };
  }, [board, rows]);
  return row;
}

/**
 * The dashboard grid. Panels sit on cells; while editing, a panel's header drags it and its corner resizes it
 * (both snap to cells), and a focused panel moves with the arrow keys and resizes with Shift+arrows.
 * Anything a move would overlap is pushed down.
 */
export function Board({ layout, editable, find, onChange, onAction }: { layout: GridLayout; editable: boolean; find: (id: number) => RaceSummary | undefined; onChange: (panels: Panel[]) => void; onAction: (a: PanelAction) => void }) {
  const grid = GRID_SIZES[layout.size];
  const { cols, fit } = fitted(layout.panels, grid);
  const rows = grid.rows;
  const board = useRef<HTMLDivElement>(null);
  const row = useRowHeight(board, fit);
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "resize"; start: { x: number; y: number }; from: Rect; to: Rect } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  const cellW = () => (board.current?.clientWidth ?? 1) / cols;
  const begin = (e: ReactPointerEvent, p: Panel, mode: "move" | "resize") => {
    if (!editable || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const from = { x: p.x, y: p.y, w: p.w, h: p.h };
    setDrag({ id: p.id, mode, start: { x: e.clientX, y: e.clientY }, from, to: from });
  };
  const moveTo = (e: ReactPointerEvent) => {
    if (!drag) return;
    const dx = Math.round((e.clientX - drag.start.x) / cellW());
    const dy = Math.round((e.clientY - drag.start.y) / row);
    const f = drag.from;
    const to = drag.mode === "move" ? { ...f, x: Math.max(0, Math.min(cols - f.w, f.x + dx)), y: Math.max(0, f.y + dy) } : { ...f, w: Math.max(1, Math.min(cols - f.x, f.w + dx)), h: Math.max(1, f.h + dy) };
    if (to.x !== drag.to.x || to.y !== drag.to.y || to.w !== drag.to.w || to.h !== drag.to.h) setDrag({ ...drag, to });
  };
  const end = () => {
    if (drag && (drag.to.x !== drag.from.x || drag.to.y !== drag.from.y || drag.to.w !== drag.from.w || drag.to.h !== drag.from.h)) onChange(place(layout.panels, drag.id, drag.to, cols));
    setDrag(null);
  };
  const onKey = (e: KeyboardEvent, p: Panel) => {
    if (!editable || e.target !== e.currentTarget) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (step) {
      e.preventDefault();
      const [dx, dy] = step;
      const rect = e.shiftKey ? { x: p.x, y: p.y, w: p.w + dx, h: p.h + dy } : { x: p.x + dx, y: Math.max(0, p.y + dy), w: p.w, h: p.h };
      onChange(place(layout.panels, p.id, rect, cols));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onAction({ type: "remove", panel: p });
    }
  };

  // Phones stack panels in reading order, so the DOM follows rows, then columns.
  const ordered = [...layout.panels].sort((a, b) => a.y - b.y || a.x - b.x);
  const bottom = layout.panels.reduce((m, p) => Math.max(m, p.y + p.h), 0);
  const ghost = drag?.to;

  return (
    <div
      ref={board}
      className={`mt-dv-board${editable ? " editing" : ""}${drag ? " dragging" : ""}`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${editable ? Math.max(rows, bottom) : Math.max(fit, bottom)}, ${row}px)`, ["--row" as string]: `${row}px`, ["--cols" as string]: cols }}
      onPointerMove={moveTo}
      onPointerUp={end}
      onPointerCancel={() => setDrag(null)}
    >
      {ordered.map((p) => {
        const r = drag?.id === p.id ? drag.to : p;
        const title = panelTitle(p, find);
        const href = panelHref(p);
        const header = p.type === "header";
        return (
          <section
            key={p.id}
            className={`mt-dv-panel${header ? " header" : ""}${drag?.id === p.id ? " moving" : ""}`}
            style={{ gridColumn: `${r.x + 1} / span ${r.w}`, gridRow: `${r.y + 1} / span ${r.h}`, ["--h" as string]: p.h }}
            tabIndex={editable ? 0 : undefined}
            aria-label={editable ? `${header ? p.text : `${title} ${PANELS[p.type].label}`}. Arrow keys move it, Shift+arrows resize it, Delete removes it.` : undefined}
            onKeyDown={(e) => onKey(e, p)}
          >
            <header className="mt-dv-head" onPointerDown={(e) => begin(e, p, "move")}>
              {header ? (
                <h2>{p.text || "Section"}</h2>
              ) : (
                <p>
                  {href ? <Link href={href} onPointerDown={(e) => e.stopPropagation()}>{title}</Link> : <b>{title}</b>}
                  <span>{PANELS[p.type].label}</span>
                </p>
              )}
              <div className="mt-dv-tools" onPointerDown={(e) => e.stopPropagation()}>
                {editable && header && (
                  <button type="button" aria-label="Rename section" onClick={() => onAction({ type: "rename", panel: p })}>✎</button>
                )}
                {editable && (
                  <button type="button" aria-label="Panel options" aria-expanded={menu === p.id} onClick={() => setMenu(menu === p.id ? null : p.id)}>
                    ⋯
                  </button>
                )}
                {menu === p.id && (
                  <div className="mt-dv-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
                    {PANELS[p.type].needs !== "none" && PANELS[p.type].needs !== "text" && (
                      <button type="button" role="menuitem" onClick={() => (setMenu(null), onAction({ type: "change", panel: p }))}>Change {PANELS[p.type].needs === "race" ? "race" : "chamber"}</button>
                    )}
                    <button type="button" role="menuitem" onClick={() => (setMenu(null), onAction({ type: "duplicate", panel: p }))}>Duplicate</button>
                    <button type="button" role="menuitem" className="danger" onClick={() => (setMenu(null), onAction({ type: "remove", panel: p }))}>Remove</button>
                  </div>
                )}
              </div>
            </header>
            {!header && (
              <div className="mt-dv-body">
                <PanelBody panel={p} />
              </div>
            )}
            {editable && <span className="mt-dv-resize" aria-hidden onPointerDown={(e) => begin(e, p, "resize")} />}
          </section>
        );
      })}
      {ghost && <div className="mt-dv-ghost" style={{ gridColumn: `${ghost.x + 1} / span ${ghost.w}`, gridRow: `${ghost.y + 1} / span ${ghost.h}` }} aria-hidden />}
      {!layout.panels.length && <p className="mt-dv-blank">This dashboard is empty. Use “Add element” to put races, maps and charts on it.</p>}
    </div>
  );
}
