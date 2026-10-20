import type { Tally } from "@/lib/midterms/view";

const NOTE = {
  senate: "Includes the 65 seats not up this year. Republicans keep control at 50 with the vice president's tiebreak.",
  house: "All 435 seats are up.",
  governor: "Includes the 14 governors not up this year.",
} as const;

/** One chamber's seats: Democrats from the left, Republicans from the right, undecided in between. */
export function BalanceBar({ title, office, tally }: { title: string; office: keyof typeof NOTE; tally: Tally }) {
  const share = (n: number) => `${(n / tally.total) * 100}%`;
  const open = tally.total - tally.D - tally.R - tally.other;
  return (
    <section className="mt-balance">
      <div className="mt-balance-head">
        <h2>{title}</h2>
        <span className="muted small">{office === "senate" ? "51 D · 50 R for control" : `${tally.majority} for control`}</span>
      </div>
      <div className="mt-balance-nums">
        <span className="d">
          <b>{tally.D}</b> Dem
        </span>
        {tally.other > 0 && (
          <span className="o">
            <b>{tally.other}</b> Other
          </span>
        )}
        <span className="u">{open} undecided</span>
        <span className="r">
          Rep <b>{tally.R}</b>
        </span>
      </div>
      <div className="mt-balance-bar" role="img" aria-label={`${tally.D} Democratic, ${tally.R} Republican, ${tally.other} other, ${open} undecided`}>
        <span style={{ width: share(tally.D), background: "var(--dem)" }} />
        <span style={{ width: share(tally.other), background: "var(--oth)" }} />
        <span style={{ flex: 1 }} />
        <span style={{ width: share(tally.R), background: "var(--rep)" }} />
        <i aria-hidden />
      </div>
      <p className="muted small">{NOTE[office]}</p>
    </section>
  );
}

/** Election-night seat count: seats won (solid) and races led but not called (light), from each end toward the majority line. */
export function SeatBar({ tally, ahead, office }: { tally: Tally; ahead: { D: number; R: number; other: number }; office: keyof typeof NOTE }) {
  const share = (n: number) => `${(n / tally.total) * 100}%`;
  const open = tally.total - tally.D - tally.R - tally.other - ahead.D - ahead.R - ahead.other;
  return (
    <section className="mt-seats">
      <div className="mt-seats-nums">
        <span className="d">
          <b>{tally.D}</b> Dem{ahead.D > 0 && <em> +{ahead.D} leading</em>}
        </span>
        <span className="mt-seats-mid">
          {office === "senate" ? "51 D · 50 R for control" : `${tally.majority} for control`}
          {tally.other + ahead.other > 0 && ` · Other ${tally.other}${ahead.other ? ` +${ahead.other}` : ""}`}
          {` · ${open} uncounted`}
        </span>
        <span className="r">
          {ahead.R > 0 && <em>{ahead.R} leading + </em>}Rep <b>{tally.R}</b>
        </span>
      </div>
      <div className="mt-balance-bar mt-seats-bar" role="img" aria-label={`Democrats ${tally.D} won and ${ahead.D} leading; Republicans ${tally.R} won and ${ahead.R} leading; ${open} uncounted`}>
        <span style={{ width: share(tally.D), background: "var(--dem)" }} />
        <span style={{ width: share(ahead.D), background: "color-mix(in srgb, var(--dem) 45%, var(--sheet))" }} />
        <span style={{ width: share(tally.other + ahead.other), background: "var(--oth)" }} />
        <span style={{ flex: 1 }} />
        <span style={{ width: share(ahead.R), background: "color-mix(in srgb, var(--rep) 45%, var(--sheet))" }} />
        <span style={{ width: share(tally.R), background: "var(--rep)" }} />
        <i aria-hidden />
      </div>
      <p className="muted small">{NOTE[office]}</p>
    </section>
  );
}
