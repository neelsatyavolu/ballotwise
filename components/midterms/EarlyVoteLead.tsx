// The "who's ahead" card at the top of a state's early vote panel.
import type { EarlyStateDetail, Lean, PartySplit } from "@/lib/midterms/earlyVote";
import { fmt, marginLabel } from "@/lib/midterms/view";

/** Below this many points either way, the card calls it even. */
const EVEN = 0.05;

/** Democrats' share of a two-way split as one bar, Democrats from the left and Republicans from the right, with a tick at even. */
function Meter({ dem }: { dem: number }) {
  const d = Math.min(100, Math.max(0, dem));
  return (
    <div className="mt-ev-meter" role="img" aria-label={`Democrats ${d.toFixed(1)}%, Republicans ${(100 - d).toFixed(1)}% of the two`}>
      <span className="d" style={{ width: `${d}%` }} />
      <span className="r" style={{ width: `${100 - d}%` }} />
      <i aria-hidden />
    </div>
  );
}

function Head({ who, margin, estimate }: { who: string; margin: number; estimate?: boolean }) {
  const side = Math.abs(margin) < EVEN ? "" : margin > 0 ? " d" : " r";
  return (
    <div className="mt-ev-lead-head">
      <b className={`mt-ev-lead-who${side}`}>{who}</b>
      <span className={`mt-ev-lead-margin${side}`}>{marginLabel(margin)}</span>
      {estimate && <span className="mt-ev-tag">Estimate</span>}
    </div>
  );
}

function ByRegistration({ party }: { party: PartySplit }) {
  const margin = ((party.dem - party.rep) / (party.dem + party.rep + party.other)) * 100;
  const who = Math.abs(margin) < EVEN ? "Democrats and Republicans even" : margin > 0 ? "Registered Democrats ahead" : "Registered Republicans ahead";
  return (
    <>
      <Head who={who} margin={margin} />
      <Meter dem={(party.dem / (party.dem + party.rep)) * 100} />
      <p className="small">
        {fmt(party.dem)} Democrats · {fmt(party.rep)} Republicans · {fmt(party.other)} other or none
      </p>
      <p className="muted small">Registration isn&apos;t a vote: many voters cross party lines, and Democrats vote by mail more than Republicans do.</p>
    </>
  );
}

function ByCounty({ lean }: { lean: Lean }) {
  const who = Math.abs(lean.margin) < EVEN ? "Even" : lean.margin > 0 ? "Leans Democratic" : "Leans Republican";
  const diff = lean.margin - lean.state2024;
  const against =
    Math.abs(diff) < 0.5
      ? `about the same as the state as a whole (${marginLabel(lean.state2024)})`
      : `${Math.abs(diff).toFixed(1)} points more ${diff > 0 ? "Democratic" : "Republican"} than the state as a whole (${marginLabel(lean.state2024)})`;
  return (
    <>
      <Head who={who} margin={lean.margin} estimate />
      <Meter dem={50 + lean.margin / 2} />
      <p className="small">
        Early ballots so far come from places that voted {marginLabel(lean.margin)} in 2024, {against}.
      </p>
      <p className="muted small">
        This state doesn&apos;t record party, so this assumes each county&apos;s early voters split the way the county did in 2024. It shows where ballots come from, not how they were
        cast.
      </p>
    </>
  );
}

/**
 * Which side the early ballots favor: by party registration where the state records it, otherwise an estimate from
 * each county's 2024 vote. Nothing when neither is available.
 */
export function LeadCard({ detail }: { detail: EarlyStateDetail }) {
  if (!detail.party && !detail.lean) return <p className="muted small">This state doesn&apos;t report early voters&apos; party registration.</p>;
  return (
    <section className="mt-ev-lead" aria-labelledby="ev-lead">
      <h3 id="ev-lead">Who&apos;s ahead in early ballots</h3>
      {detail.party ? <ByRegistration party={detail.party} /> : <ByCounty lean={detail.lean!} />}
    </section>
  );
}
