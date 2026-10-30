"use client";

// Rendered inside the tracker's client components, and as the shell's streamed fallback.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { loadMap, NationMap } from "./maps";

/** A grey placeholder block, shimmering while results load. */
function Bone({ w, h, style, className }: { w?: string | number; h?: string | number; style?: CSSProperties; className?: string }) {
  return <span className={`mt-skel${className ? ` ${className}` : ""}`} style={{ width: w, height: h, ...style }} aria-hidden />;
}

/** How many placeholders are on screen, and when the first of them started its shimmer (document timeline ms). */
let shown = 0;
let since = 0;

/**
 * The frame every placeholder shares: a status line for screen readers, the blocks hidden from them. `nation`
 * starts fetching the US map now, alongside the results, rather than only once they arrive.
 * A frame that takes over from one already on screen (the streamed fallback handing off to the page's own) skips
 * the entrance fade and picks up the shimmer mid-beat, so the placeholder doesn't blink out and back.
 */
function Frame({ label, nation, children }: { label: string; nation?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [handoff] = useState(() => (shown > 0 ? ({ "--skel-t": `${Math.round(since - performance.now())}ms` } as CSSProperties) : undefined));
  useLayoutEffect(() => {
    if (shown++ === 0 && !handoff) {
      const start = ref.current?.getAnimations?.({ subtree: true }).find((a) => typeof a.startTime === "number")?.startTime;
      since = typeof start === "number" ? start : performance.now();
    }
    return () => {
      shown--;
    };
  }, [handoff]);
  useEffect(() => {
    if (nation) loadMap("US").catch(() => {});
  }, [nation]);
  return (
    <div ref={ref} className={`mt-skel-frame${handoff ? " handoff" : ""}`} style={handoff} aria-busy>
      <p className="mt-sr" role="status">{label}</p>
      {children}
    </div>
  );
}

const NO_FILLS = new Map();
const noPick = () => {};

/** The US map with nothing filled in yet, its outline drawn from the same file the real map uses. */
function Nation() {
  return (
    <div className="mt-skel-breathe" aria-hidden>
      <NationMap fills={NO_FILLS} onPick={noPick} label="Map loading" />
    </div>
  );
}

/** A table's worth of placeholder rows, as in RaceRows. */
function Rows({ n }: { n: number }) {
  return (
    <div className="mt-skel-rows">
      <Bone h={12} w="40%" />
      {Array.from({ length: n }, (_, i) => (
        <Bone key={i} h={18} w={`${92 - (i % 4) * 9}%`} />
      ))}
    </div>
  );
}

function Balance() {
  return (
    <div className="mt-balance mt-skel-balance">
      <Bone h={14} w="45%" />
      <Bone h={28} />
      <Bone h={10} />
      <Bone h={12} w="80%" />
    </div>
  );
}

/** The overview while every race loads: the balance of power, the tabs, then the map beside the key races. */
export function OverviewSkeleton() {
  return (
    <Frame label="Loading every race…" nation>
      <div className="mt-balances">
        <Balance />
        <Balance />
        <Balance />
      </div>
      <Bone h={38} w={450} style={{ maxWidth: "100%", margin: "12px 0 14px" }} />
      <div className="mt-overview">
        <section>
          <div className="mt-section-head tight"><Bone h={12} w={110} /></div>
          <Nation />
        </section>
        <section>
          <div className="mt-section-head tight"><Bone h={12} w={90} /></div>
          <Rows n={12} />
        </section>
      </div>
    </Frame>
  );
}

/** An office screen while its races load: the seat count, then the zoom map beside the race list. */
export function OfficeSkeleton() {
  return (
    <Frame label="Loading every race…" nation>
      <Bone h={100} w="100%" style={{ marginTop: 12 }} />
      <div className="mt-office">
        <Bone className="mt-skel-map zoom" />
        <div className="mt-panel">
          <div className="mt-section-head tight"><Bone h={12} w={110} /><Bone h={36} w={200} /></div>
          <Rows n={14} />
        </div>
      </div>
    </Frame>
  );
}

/** A race page while its results load: title and status lines, then candidates beside the county map. */
export function RaceSkeleton() {
  return (
    <Frame label="Loading results…">
      <Bone h={14} w={220} style={{ marginBottom: 10 }} />
      <div className="mt-race-head">
        <Bone h={38} w={340} style={{ maxWidth: "100%" }} />
        <Bone h={14} w={420} style={{ maxWidth: "100%" }} />
        <Bone h={18} w={300} style={{ maxWidth: "100%" }} />
        <Bone h={14} w={360} style={{ maxWidth: "100%" }} />
      </div>
      <div className="mt-race-grid">
        <section>
          <div className="mt-section-head"><Bone h={12} w={90} /></div>
          <Bone h={220} w="100%" />
        </section>
        <section>
          <div className="mt-section-head"><Bone h={12} w={80} /></div>
          <Bone className="mt-skel-map state" />
        </section>
      </div>
    </Frame>
  );
}

/** The forecast pages while the races load: the headline panel and its chart. */
export function ForecastSkeleton() {
  return (
    <Frame label="Loading the forecast…">
      <Bone h={36} w={180} style={{ display: "block", margin: "0 auto 16px" }} />
      <Bone h={560} w="100%" />
    </Frame>
  );
}

/** Side by side while the races load: one column per office and the calls feed. */
export function ColumnsSkeleton() {
  return (
    <Frame label="Loading every race…" nation>
      <div className="mt-sbs">
        {[0, 1, 2].map((i) => (
          <section key={i} className="mt-sbs-col">
            <Bone h={90} w="100%" />
            <Nation />
            <Rows n={8} />
          </section>
        ))}
        <Bone className="mt-sbs-side" h={420} w="100%" />
      </div>
    </Frame>
  );
}
