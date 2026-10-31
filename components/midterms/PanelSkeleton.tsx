// Placeholders for the race page's Polls and Markets panels, sized like the cards they stand in for so nothing
// jumps when the data arrives. Shown only when the race's signal says the panel is coming.

/** A grey block the size of a LineChart (its default 560×190 box at the panel's width). */
export function ChartBone() {
  return <span className="mt-skel mt-skel-chart" aria-hidden />;
}

function Bone({ w, h }: { w?: string | number; h: number }) {
  return <span className="mt-skel" style={{ width: w, height: h }} aria-hidden />;
}

/** The polls card: average, chart, legend and the first rows of the table. */
export function PollsSkeleton() {
  return (
    <section className="mt-mk mt-skel-panel" aria-label="Polls" aria-busy>
      <h3 className="mt-mk-head">Polls</h3>
      <p className="mt-sr" role="status">Loading polls…</p>
      <div className="mt-mk-card">
        <Bone h={14} w={110} />
        <Bone h={22} w={150} />
        <ChartBone />
        <Bone h={12} w={200} />
        <div className="mt-skel-table">
          {Array.from({ length: 5 }, (_, i) => (
            <Bone key={i} h={14} w={`${96 - (i % 3) * 8}%`} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** The markets panel: the source switch, then a market card with its chart and legend. */
export function MarketsSkeleton() {
  return (
    <section className="mt-mk mt-skel-panel" aria-label="Prediction markets" aria-busy>
      <h3 className="mt-mk-head">Markets</h3>
      <p className="mt-sr" role="status">Loading markets…</p>
      <Bone h={34} />
      <div className="mt-mk-card">
        <Bone h={14} w="60%" />
        <Bone h={22} w={170} />
        <ChartBone />
        <Bone h={12} w={200} />
      </div>
    </section>
  );
}
