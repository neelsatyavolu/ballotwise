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
