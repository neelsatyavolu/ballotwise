import type { Party, Tally } from "@/lib/midterms/view";

const NOTE = {
  senate: "Includes the 65 seats not up this year. Republicans keep control at 50 with the vice president's tiebreak.",
  house: "All 435 seats are up.",
  governor: "Includes the 14 governors not up this year.",
} as const;

/** Where control sits. Governors aren't a chamber, so there's no line for them. */
const CONTROL = { senate: "51 D · 50 R for control", house: "218 for control", governor: "No majority to win" } as const;

/** The majority line, drawn at the seat that gives Democrats control (counted from the left); none for governors. */
const tick = (office: keyof typeof NOTE, tally: Tally) => (office === "governor" ? null : <i aria-hidden style={{ left: `${(tally.majority / tally.total) * 100}%` }} />);

type Seats = Record<Party, number>;
/** The forecast's seats beyond those decided, and Democrats' chance of control, until votes are counted (see projection). */
export type Projected = { ahead: Seats; dControl: number | null } | null;

/** "Rep 62% to win control", the favorite's chance; nothing for governors or before the simulation has run. */
const controlOdds = (d: number | null) => (d === null ? null : `${d >= 0.5 ? "Dem" : "Rep"} ${Math.round(Math.max(d, 1 - d) * 100)}% to win control`);
const PROJECTED_NOTE = "Lighter shades are the forecast's projected seats until votes are counted.";

/** One chamber's seats: Democrats from the left, Republicans from the right, undecided in between. */
export function BalanceBar({ title, office, tally, projected = null }: { title: string; office: keyof typeof NOTE; tally: Tally; projected?: Projected }) {
  const share = (n: number) => `${(n / tally.total) * 100}%`;
  const open = tally.total - tally.D - tally.R - tally.other;
  const ahead = projected?.ahead ?? { D: 0, R: 0, other: 0 };
  return (
    <section className="mt-balance">
      <div className="mt-balance-head">
        <h2>{title}</h2>
        <span className="muted small">{CONTROL[office]}</span>
      </div>
      <div className="mt-balance-nums">
        {/* Before votes, the big numbers are the projected totals, so the row stays one short line in a narrow card. */}
        <span className="d">
          <b>{tally.D + ahead.D}</b> Dem
        </span>
        {tally.other > 0 && (
          <span className="o">
            <b>{tally.other}</b> Other
          </span>
        )}
        <span className="u">{projected ? "projected" : `${open} undecided`}</span>
        <span className="r">
          Rep <b>{tally.R + ahead.R}</b>
        </span>
      </div>
      <div className="mt-balance-bar" role="img" aria-label={`${tally.D} Democratic, ${tally.R} Republican, ${tally.other} other, ${open} undecided${projected ? `; projected ${tally.D + ahead.D} Democratic, ${tally.R + ahead.R} Republican` : ""}`}>
        <span style={{ width: share(tally.D), background: "var(--dem)" }} />
        <span style={{ width: share(ahead.D), background: "color-mix(in srgb, var(--dem) 45%, var(--sheet))" }} />
        <span style={{ width: share(tally.other), background: "var(--oth)" }} />
        <span style={{ flex: 1 }} />
        <span style={{ width: share(ahead.R), background: "color-mix(in srgb, var(--rep) 45%, var(--sheet))" }} />
        <span style={{ width: share(tally.R), background: "var(--rep)" }} />
        {tick(office, tally)}
      </div>
      <p className="muted small">
        {projected && controlOdds(projected.dControl) && `${controlOdds(projected.dControl)}. `}
        {NOTE[office]}
        {projected && ` ${PROJECTED_NOTE}`}
      </p>
    </section>
  );
}

/**
 * The office screens' seat count, from each end toward the majority line. On election night: seats won (solid) and
 * races led but not called (light). Before votes, `projected` takes the leaders' place: the big numbers are the
 * forecast's projected totals, the light segments its expected seats, and the middle gives the chance of control.
 */
export function SeatBar({ tally, ahead: leading, office, projected = null }: { tally: Tally; ahead: Seats; office: keyof typeof NOTE; projected?: Projected }) {
  const share = (n: number) => `${(n / tally.total) * 100}%`;
  const ahead = projected?.ahead ?? leading;
  const word = projected ? "projected" : "leading";
  const open = tally.total - tally.D - tally.R - tally.other - ahead.D - ahead.R - ahead.other;
  return (
    <section className="mt-seats">
      <div className="mt-seats-nums">
        <span className="d">
          <b>{projected ? tally.D + ahead.D : tally.D}</b> Dem{!projected && ahead.D > 0 && <em> +{ahead.D} {word}</em>}
        </span>
        <span className="mt-seats-mid">
          {projected && "Projected · "}
          {CONTROL[office]}
          {tally.other + ahead.other > 0 && ` · Other ${tally.other}${ahead.other ? ` +${ahead.other}` : ""}`}
          {projected ? (controlOdds(projected.dControl) ? ` · ${controlOdds(projected.dControl)}` : "") : ` · ${open} uncounted`}
        </span>
        <span className="r">
          {!projected && ahead.R > 0 && <em>{ahead.R} {word} + </em>}Rep <b>{projected ? tally.R + ahead.R : tally.R}</b>
        </span>
      </div>
      <div className="mt-balance-bar mt-seats-bar" role="img" aria-label={`Democrats ${tally.D} won and ${ahead.D} ${word}; Republicans ${tally.R} won and ${ahead.R} ${word}; ${open} uncounted`}>
        <span style={{ width: share(tally.D), background: "var(--dem)" }} />
        <span style={{ width: share(ahead.D), background: "color-mix(in srgb, var(--dem) 45%, var(--sheet))" }} />
        <span style={{ width: share(tally.other + ahead.other), background: "var(--oth)" }} />
        <span style={{ flex: 1 }} />
        <span style={{ width: share(ahead.R), background: "color-mix(in srgb, var(--rep) 45%, var(--sheet))" }} />
        <span style={{ width: share(tally.R), background: "var(--rep)" }} />
        {tick(office, tally)}
      </div>
      <p className="muted small">
        {NOTE[office]}
        {projected && ` ${PROJECTED_NOTE}`}
      </p>
    </section>
  );
}
