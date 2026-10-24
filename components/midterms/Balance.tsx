import type { Party, Tally } from "@/lib/midterms/view";

const NOTE = {
  senate: "Includes the 65 seats not up this year. Republicans keep control at 50 with the vice president's tiebreak.",
  house: "All 435 seats are up.",
  governor: "Includes the 14 governors not up this year.",
} as const;

const PROJECTED_NOTE = "Striped: the Kalshi and Polymarket favorite (odds averaged) until votes come in.";

type Seats = Record<Party, number>;
const NONE: Seats = { D: 0, R: 0, other: 0 };

const stripes = (color: string) => `repeating-linear-gradient(-45deg, ${color} 0 3px, color-mix(in srgb, ${color} 40%, var(--sheet)) 3px 6px)`;

/** One chamber's seats: Democrats from the left, Republicans from the right, market projections (striped) inside them, undecided in between. */
export function BalanceBar({ title, office, tally, projected = NONE }: { title: string; office: keyof typeof NOTE; tally: Tally; projected?: Seats }) {
  const share = (n: number) => `${(n / tally.total) * 100}%`;
  const open = tally.total - tally.D - tally.R - tally.other - projected.D - projected.R - projected.other;
  const anyProjected = projected.D + projected.R + projected.other > 0;
  return (
    <section className="mt-balance">
      <div className="mt-balance-head">
        <h2>{title}</h2>
        <span className="muted small">{office === "senate" ? "51 D · 50 R for control" : `${tally.majority} for control`}</span>
      </div>
      <div className="mt-balance-nums">
        <span className="d">
          <b>{tally.D}</b> Dem{projected.D > 0 && <em> +{projected.D}</em>}
        </span>
        {tally.other + projected.other > 0 && (
          <span className="o">
            <b>{tally.other}</b> Other{projected.other > 0 && <em> +{projected.other}</em>}
          </span>
        )}
        <span className="u">{open} {anyProjected ? "no market" : "undecided"}</span>
        <span className="r">
          {projected.R > 0 && <em>+{projected.R} </em>}Rep <b>{tally.R}</b>
        </span>
      </div>
      <div className="mt-balance-bar" role="img" aria-label={`${tally.D} Democratic and ${projected.D} projected, ${tally.R} Republican and ${projected.R} projected, ${tally.other} other and ${projected.other} projected, ${open} undecided`}>
        <span style={{ width: share(tally.D), background: "var(--dem)" }} />
        <span style={{ width: share(projected.D), background: stripes("var(--dem)") }} />
        <span style={{ width: share(tally.other), background: "var(--oth)" }} />
        <span style={{ width: share(projected.other), background: stripes("var(--oth)") }} />
        <span style={{ flex: 1 }} />
        <span style={{ width: share(projected.R), background: stripes("var(--rep)") }} />
        <span style={{ width: share(tally.R), background: "var(--rep)" }} />
        <i aria-hidden />
      </div>
      <p className="muted small">
        {NOTE[office]}
        {anyProjected && ` ${PROJECTED_NOTE}`}
      </p>
    </section>
  );
}

/** Election-night seat count: seats won (solid), races led but not called (light) and market projections for races with no votes yet (striped), from each end toward the majority line. */
export function SeatBar({ tally, ahead, projected = NONE, office }: { tally: Tally; ahead: Seats; projected?: Seats; office: keyof typeof NOTE }) {
  const share = (n: number) => `${(n / tally.total) * 100}%`;
  const open = tally.total - tally.D - tally.R - tally.other - ahead.D - ahead.R - ahead.other - projected.D - projected.R - projected.other;
  const anyProjected = projected.D + projected.R + projected.other > 0;
  const extra = (lead: number, proj: number) => [lead > 0 && `${lead} leading`, proj > 0 && `${proj} projected`].filter(Boolean).join(", ");
  return (
    <section className="mt-seats">
      <div className="mt-seats-nums">
        <span className="d">
          <b>{tally.D}</b> Dem{ahead.D + projected.D > 0 && <em> +{extra(ahead.D, projected.D)}</em>}
        </span>
        <span className="mt-seats-mid">
          {office === "senate" ? "51 D · 50 R for control" : `${tally.majority} for control`}
          {tally.other + ahead.other + projected.other > 0 && ` · Other ${tally.other}${ahead.other + projected.other ? ` +${ahead.other + projected.other}` : ""}`}
          {` · ${open} ${anyProjected ? "uncounted, no market" : "uncounted"}`}
        </span>
        <span className="r">
          {ahead.R + projected.R > 0 && <em>{extra(ahead.R, projected.R)} + </em>}Rep <b>{tally.R}</b>
        </span>
      </div>
      <div className="mt-balance-bar mt-seats-bar" role="img" aria-label={`Democrats ${tally.D} won, ${ahead.D} leading and ${projected.D} projected; Republicans ${tally.R} won, ${ahead.R} leading and ${projected.R} projected; ${open} uncounted`}>
        <span style={{ width: share(tally.D), background: "var(--dem)" }} />
        <span style={{ width: share(ahead.D), background: "color-mix(in srgb, var(--dem) 45%, var(--sheet))" }} />
        <span style={{ width: share(projected.D), background: stripes("var(--dem)") }} />
        <span style={{ width: share(tally.other + ahead.other), background: "var(--oth)" }} />
        <span style={{ width: share(projected.other), background: stripes("var(--oth)") }} />
        <span style={{ flex: 1 }} />
        <span style={{ width: share(projected.R), background: stripes("var(--rep)") }} />
        <span style={{ width: share(ahead.R), background: "color-mix(in srgb, var(--rep) 45%, var(--sheet))" }} />
        <span style={{ width: share(tally.R), background: "var(--rep)" }} />
        <i aria-hidden />
      </div>
      <p className="muted small">
        {NOTE[office]}
        {anyProjected && ` ${PROJECTED_NOTE}`}
      </p>
    </section>
  );
}
