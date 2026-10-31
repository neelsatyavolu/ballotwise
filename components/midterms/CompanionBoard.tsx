"use client";
// The companion screen's main area: the toss-ups the main screen can't fit, each with its county map, laid out to fill
// the window; or, when there are too many for maps or none at all, a wall of the closest races' cards.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { closestFirst } from "@/lib/midterms/explore";
import type { RaceDetail } from "@/lib/midterms/races";
import { tileGrid } from "@/lib/midterms/screens";
import { STATE_NAMES, type Overview, type RaceSummary } from "@/lib/midterms/view";
import { CountyTip, fillFor } from "./county";
import { useLive, useStars } from "./hooks";
import { CountyMap, type CountyFill } from "./maps";
import { RaceCard } from "./RaceCard";

type Stars = ReturnType<typeof useStars>;

/** The most race cards the wall lays out; a big screen fits a few dozen, never the House's 435. */
const MAX_CARDS = 60;
const OFFICES = new Set(["senate", "house", "governor"]);
/** Tile layout: the gap between tiles, a results card's height and a state map's rough width over height. */
const TILE = { gap: 12, card: 280, aspect: 1.3 };
/** Narrower than this, a county map is too small to read, so the companion shows cards instead. */
const MIN_MAP_PX = 240;

/** An element's size, kept up to date as it changes. */
function useSize(el: RefObject<HTMLElement | null>): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const watch = new ResizeObserver(() => setSize({ w: node.clientWidth, h: node.clientHeight }));
    watch.observe(node);
    return () => watch.disconnect();
  }, [el]);
  return size;
}

/**
 * Hides every card from the first one that runs past the bottom of the list, so the wall fills its space without
 * scrolling. Hiding from there on, not each card that's cut off, keeps the cards before it in place.
 */
function fitCards(ul: HTMLUListElement | null) {
  if (!ul) return;
  const cards = [...ul.children] as HTMLElement[];
  cards.forEach((c) => (c.hidden = false));
  const bottom = ul.getBoundingClientRect().bottom;
  const first = cards.findIndex((c) => c.getBoundingClientRect().bottom > bottom + 1);
  // The first card always shows, even on a window too short for it.
  if (first >= 0) cards.slice(Math.max(first, 1)).forEach((c) => (c.hidden = true));
}

/** The races the main screen has no card for, closest first (toss-ups lead), as many as fit. */
function CardWall({ races, stars }: { races: readonly RaceSummary[]; stars: Stars }) {
  const list = useRef<HTMLUListElement>(null);
  // After every render (results change cards' heights) and whenever the list changes size.
  useLayoutEffect(() => fitCards(list.current));
  useEffect(() => {
    const ul = list.current;
    if (!ul) return;
    const watch = new ResizeObserver(() => fitCards(ul));
    watch.observe(ul);
    return () => watch.disconnect();
  }, []);
  return (
    <ul ref={list} className="mt-grid mt-sbs-cards">
      {races.map((r) => (
        <RaceCard key={r.id} race={r} starred={stars.ids ? stars.ids.includes(r.id) : null} onStar={stars.toggle} limit={2} />
      ))}
    </ul>
  );
}

/** One toss-up: its results card over its state's county map, shaded as the count comes in. */
function TossupTile({ race, stars }: { race: RaceSummary; stars: Stars }) {
  const detail = useLive<{ race: RaceDetail }>(`/api/midterms/race/${race.id}`).data;
  const [selected, setSelected] = useState<string | null>(null);
  const fills = useMemo(() => {
    const out = new Map<string, CountyFill>();
    for (const c of detail?.race.counties ?? []) if (c.fips) out.set(c.fips, { fill: fillFor(c, "results"), tip: <CountyTip county={c} />, active: true });
    return out;
  }, [detail]);
  return (
    <div className="mt-companion-tile">
      <ul className="mt-grid one">
        <RaceCard race={race} starred={stars.ids ? stars.ids.includes(race.id) : null} onStar={stars.toggle} limit={2} />
      </ul>
      {STATE_NAMES[race.state] && (
        <div className="mt-companion-map">
          <CountyMap state={race.state} fills={fills} selected={selected} onSelect={setSelected} />
        </div>
      )}
    </div>
  );
}

/**
 * The toss-ups the main screen has no card for, each with its county map, in the grid that draws the maps biggest:
 * two hidden toss-ups fill the window side by side. When there are too many for readable maps, or none, the closest
 * races the main screen has no card for fill it as cards instead.
 */
export function CompanionBoard({ data, stars, seen }: { data: Overview; stars: Stars; seen: readonly number[] }) {
  const closest = useMemo(() => data.races.filter((r) => OFFICES.has(r.office) && !seen.includes(r.id)).sort(closestFirst).slice(0, MAX_CARDS), [data, seen]);
  const tossups = useMemo(() => closest.filter((r) => r.rating === "tossup"), [closest]);
  const board = useRef<HTMLDivElement>(null);
  const size = useSize(board);
  const grid = size && tossups.length ? tileGrid(tossups.length, size.w, size.h, TILE) : null;
  const maps = grid && grid.map >= MIN_MAP_PX ? grid : null;
  if (!closest.length) return null;
  return (
    <section className="mt-companion-tossups" aria-label="Races not on your main screen">
      <div className="mt-section-head tight">
        <h2>{maps ? "Toss-ups not on your main screen" : "Not on your main screen"}</h2>
        <span className="muted small">{maps ? `${tossups.length} with county maps` : tossups.length ? "Toss-ups first, then the next closest" : "The next closest races"}</span>
      </div>
      <div ref={board} className="mt-companion-board">
        {maps ? (
          <div className="mt-companion-tiles" style={{ "--cols": maps.cols, "--rows": maps.rows } as CSSProperties}>
            {tossups.map((r) => (
              <TossupTile key={r.id} race={r} stars={stars} />
            ))}
          </div>
        ) : (
          size && <CardWall races={closest} stars={stars} />
        )}
      </div>
    </section>
  );
}
