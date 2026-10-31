import type { Metadata } from "next";
import Link from "next/link";
import { backtestShare, FIT, modelFor, PARAMS, phi, sigmaOf, TUNING } from "@/lib/midterms/forecast";
import { AGGREGATES_SOURCE } from "@/lib/midterms/genericAggregates";
import "../midterms.css";

export const metadata: Metadata = { title: "How the forecast works: 2026 midterms" };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const money = (x: number) => (x >= 1_000_000 ? `$${x / 1_000_000}M` : `$${x / 1000}K`);

const MODELS = [
  ["House", FIT.house],
  ["House, no FEC data", FIT.houseNoFundraising],
  ["Senate", FIT.senate],
  ["Senate and governors, no FEC data", FIT.senateNoFundraising],
] as const;
const BODIES = ["house", "senate", "governor"] as const;
const BACKTEST_SHARE = Object.fromEntries(BODIES.map((b) => [b, backtestShare(modelFor(b, b !== "governor"), b)])) as Record<(typeof BODIES)[number], number>;
const SHARE = Object.fromEntries(BODIES.map((b) => [b, Math.max(BACKTEST_SHARE[b], TUNING.shared[b])])) as Record<(typeof BODIES)[number], number>;
/** The backtest's seat-count check of the simulations' correlation, at its own share and at the tuned one. */
const SEAT_CHECK = (["house", "senate"] as const)
  .map((b) => {
    const c = FIT[b].calibration.seatCheck;
    if (!c) return "";
    const zs = (r: { cycles: Record<string, { z: number }> }) => Object.entries(r.cycles).map(([y, v]) => `${y} ${v.z >= 0 ? "+" : "−"}${Math.abs(v.z).toFixed(1)}`).join(", ");
    return `${b === "house" ? "House" : "Senate"} seats Democrats won, in standard deviations from the simulated count, ${zs(c.tuned)} at the tuned share (${zs(c.backtest)} at the backtest's); log likelihood of the four counts ${c.tuned.logLik.toFixed(1)} against ${c.backtest.logLik.toFixed(1)}.`;
  })
  .join(" ");
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}`;

export default function Methodology() {
  const { markets } = PARAMS;
  const cycles = Object.keys(FIT.house.backtest);
  return (
    <article className="wrap mt mt-method prose">
      <p className="small">
        <Link href="/midterms">← Midterms 2026</Link>
      </p>
      <h1>How the forecast works</h1>
      <p>
        Every Senate, House and governor race gets a chance of winning for each side. We follow the approach{" "}
        <a href="https://votes-docs.decisiondeskhq.com/forecast-methodology">Decision Desk HQ publishes</a> for its own forecast: start
        from a model of how races like this one have gone in past elections, blend in the polls, then blend in prediction markets. The
        forecast updates every few minutes, as markets and polls move.
      </p>

      <h2>1. Fundamentals, fit on past elections</h2>
      <p>
        We fit a regression on every two-party House and Senate race from {cycles[0]} to {cycles.at(-1)}: the Democrat&apos;s margin over
        the Republican, explained by
      </p>
      <ul>
        <li>
          <strong>Partisan lean:</strong> the seat&apos;s previous presidential margin against that election&apos;s national margin, on the
          district lines in use that year. For 2026 that&apos;s the 2024 result against Trump&apos;s 1.5-point national win.
        </li>
        <li>
          <strong>National environment:</strong> the generic-ballot average as it stood before that election, not the national vote
          that came after, so the fit sees the environment the way a forecast does. For past cycles that&apos;s
          RealClearPolitics&apos; final average ({cycles.map((c) => `${c} ${signed(FIT.national.generic[c])}`).join(", ")}); for 2026 it&apos;s our
          own average (see below for how it&apos;s built).
        </li>
        <li>
          <strong>Incumbency:</strong> whether the Democrat or the Republican holds the seat, or it&apos;s open.
        </li>
        <li>
          <strong>The incumbent&apos;s own vote:</strong> how far a sitting member ran ahead of their seat the last time they won it:
          their margin, minus the seat&apos;s presidential lean that year plus that year&apos;s national House vote, capped at 25 points.
          Susan Collins, for one, won Maine by 9 points in 2020 while Biden carried it by 9, so she carries about 17 points of her own
          into 2026. House seats are measured on the lines of the member&apos;s last race, from The Downballot&apos;s district results;
          senators and governors against their state. Governors&apos; past results come from Wikipedia&apos;s 2022 and 2024 results
          tables. Ossoff, who won Georgia in a January runoff, and appointed incumbents have no measured personal vote.
        </li>
        <li>
          <strong>Fundraising:</strong> the log of the Democrat&apos;s receipts over the Republican&apos;s, from FEC candidate summaries,
          capped at a 20-to-1 ratio. Races missing either side&apos;s FEC data use the fit without it.
        </li>
      </ul>
      <p>
        Races without both a Democrat and a Republican, and top-two, jungle or ranked-choice fields where a party ran two serious
        candidates, are left out of the fit. MEDSL publishes no governor returns, so governors use the statewide Senate fit without
        fundraising.
      </p>
      <div className="mt-method-scroll">
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th className="num">Lean</th>
              <th className="num">Environment</th>
              <th className="num">Incumbent</th>
              <th className="num">Own vote</th>
              <th className="num">Fundraising</th>
              <th className="num">Races</th>
            </tr>
          </thead>
          <tbody>
            {MODELS.map(([name, m]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="num">{m.coefficients.lean.toFixed(2)} ± {m.standardErrors.lean.toFixed(2)}</td>
                <td className="num">{m.coefficients.environment.toFixed(2)} ± {m.standardErrors.environment.toFixed(2)}</td>
                <td className="num">{signed(m.coefficients.incumbent)} ± {m.standardErrors.incumbent.toFixed(2)}</td>
                <td className="num">{m.coefficients.personal.toFixed(2)} ± {m.standardErrors.personal.toFixed(2)}</td>
                <td className="num">{m.coefficients.fundraising === undefined ? "—" : `${signed(m.coefficients.fundraising)} ± ${m.standardErrors.fundraising!.toFixed(2)}`}</td>
                <td className="num">{m.races}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Points of margin per point of lean, environment or the incumbent&apos;s own past vote, per incumbent, and per natural-log unit
        of the fundraising ratio (a ratio of about 2.7 to 1), with standard errors. Fundraising and the incumbent&apos;s own vote each
        lower the out-of-sample error, so both stay in; with the own vote in, the flat incumbency bonus shrinks, since much of it was
        the members who had always run ahead.
      </p>

      <h3>How well it predicts</h3>
      <p>
        Each cycle is predicted from a fit on the other three, so no race is scored by a model that saw it, using only what was known
        before that election. The miss is the root mean square error of the margin, in points. Fundraising is each campaign&apos;s
        full-cycle total, including money raised after election day, since the FEC&apos;s bulk files don&apos;t split it out; that
        flatters the fundraising term a little.
      </p>
      <div className="mt-method-scroll">
        <table>
          <thead>
            <tr>
              <th>Model</th>
              {cycles.map((c) => (
                <th key={c} className="num">{c}</th>
              ))}
              <th className="num">All (σ)</th>
            </tr>
          </thead>
          <tbody>
            {MODELS.map(([name, m]) => (
              <tr key={name}>
                <td>{name}</td>
                {cycles.map((c) => (
                  <td key={c} className="num">
                    {m.backtest[c] ? `${m.backtest[c].rmse.toFixed(1)} · ${m.backtest[c].wrongWinner} wrong` : "—"}
                  </td>
                ))}
                <td className="num">{m.sigma.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Because the environment going in was a poll average, that miss already includes how far the generic ballot ended up from the
        real vote. It becomes each race&apos;s uncertainty after one more check.
      </p>

      <h3>Calibration</h3>
      <p>
        A race-level error can be the right size on average and still produce chances that are too sure or too timid. So we scale it by
        a multiplier, chosen per office to give the best held-out log score on who actually won: {MODELS.map(([name, m]) => `${name} ${m.calibration.k.toFixed(2)}`).join("; ")}.
        We also tried a separate error for midterm years, since 2026 is one; it scored better only for the Senate, where midterm
        misses ran {FIT.senate.calibration.midtermSigma?.toFixed(1)} points against {FIT.senate.calibration.presidentialSigma.toFixed(1)} in
        presidential years, so the Senate uses it. Dropping blowouts (margins over 30 points) from the scoring leaves the multipliers
        within 0.02. These are the backtest&apos;s own choices; the forecast runs on multipliers tuned to agree with DDHQ (below), and
        the table shows how those would have scored too.
      </p>
      <p>How often the favorite won, House races 2018–2024: before any multiplier, at the backtest&apos;s, and at the tuned one:</p>
      <div className="mt-method-scroll">
        <table>
          <thead>
            <tr>
              <th>Favorite&apos;s chance</th>
              <th className="num">Races</th>
              <th className="num">Predicted</th>
              <th className="num">Won</th>
              <th className="num">Races after</th>
              <th className="num">Predicted after</th>
              <th className="num">Won after</th>
              <th className="num">Races tuned</th>
              <th className="num">Predicted tuned</th>
              <th className="num">Won tuned</th>
            </tr>
          </thead>
          <tbody>
            {FIT.house.calibration.before.reliability.map((b, i) => {
              const a = FIT.house.calibration.after.reliability[i];
              const t = FIT.house.calibration.tuned?.reliability[i];
              return (
                <tr key={b.band}>
                  <td>{b.band}%</td>
                  <td className="num">{b.races}</td>
                  <td className="num">{pct(b.predicted)}</td>
                  <td className="num">{pct(b.actual)}</td>
                  <td className="num">{a.races}</td>
                  <td className="num">{pct(a.predicted)}</td>
                  <td className="num">{pct(a.actual)}</td>
                  <td className="num">{t ? t.races : "—"}</td>
                  <td className="num">{t ? pct(t.predicted) : "—"}</td>
                  <td className="num">{t ? pct(t.actual) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Brier score, House: {FIT.house.calibration.before.brier.toFixed(4)} before, {FIT.house.calibration.after.brier.toFixed(4)} after,{" "}
        {FIT.house.calibration.tuned?.brier.toFixed(4) ?? "—"} tuned; Senate: {FIT.senate.calibration.before.brier.toFixed(4)} before,{" "}
        {FIT.senate.calibration.after.brier.toFixed(4)} after, {FIT.senate.calibration.tuned?.brier.toFixed(4) ?? "—"} tuned. Lower is
        better. Four cycles is a small sample, and the closest band has only a few dozen races, so read the toss-up rows loosely.
      </p>

      <h2>2. Polls</h2>
      <p>
        Where a race has a polling average (below), the fundamentals margin and the polling margin are blended. Polls count for more as
        they accumulate, up to a tuned share of the margin (below) once a race has enough of them; a race with fewer than two gets
        none.
      </p>

      <h2>3. Chance of winning</h2>
      <p>
        The blended margin becomes a chance of winning through a normal curve whose width is the race&apos;s uncertainty: a 5-point
        favorite in a House race wins about {Math.round(100 * phi(5 / sigmaOf(modelFor("house", true), "house")))}% of the time.
      </p>

      <h2>4. Prediction markets</h2>
      <p>
        Prices from <a href="https://kalshi.com">Kalshi</a> and <a href="https://polymarket.com">Polymarket</a> are then blended into
        that chance. A market counts for nothing below {money(markets.min)} traded and up to a set share of the final chance at{" "}
        {money(markets.full)} or more, growing with the logarithm of volume, because busier markets have been better calibrated.
        We couldn&apos;t backtest race-level market prices ourselves, and the evidence there is shows markets called the 2024 presidency
        well but trailed poll-based models in down-ballot races, so markets stay the minority input, a second layer on top of the
        model, as in DDHQ&apos;s method. The cap itself is one of the tuned settings (below).
      </p>
      <p>
        Prices are kept between {pct(markets.clip)} and {pct(1 - markets.clip)}. Near the ends a price says little: trading fees, money
        tied up until November and the long-standing habit of overpaying for long shots keep heavy favorites trading at 95 to 99 cents
        whatever their real odds, so past that range the model decides how safe a seat is.
      </p>

      <h2>5. Expert ratings</h2>
      <p>
        Last, the race ratings of the Cook Political Report, Inside Elections and Sabato&apos;s Crystal Ball, as Wikipedia&apos;s 2026
        Senate, governor and House election pages reproduce them, are blended into the chance. Each rating stands for a chance for
        its favorite: Safe or Solid {pct(PARAMS.experts.solid)}, Likely {pct(PARAMS.experts.likely)}, Lean {pct(PARAMS.experts.lean)},
        Tilt {pct(PARAMS.experts.tilt)} and Toss-up even. The raters who rate a race are averaged, and the average takes{" "}
        {pct(TUNING.experts.house)} of the final chance in House races, {pct(TUNING.experts.senate)} in Senate races and{" "}
        {pct(TUNING.experts.governor)} for governors; a race nobody rates gets none. Raters see things a model can&apos;t, like
        candidate quality and private polling. Decision Desk HQ&apos;s ratings are left out, even where Wikipedia lists them, since
        theirs is the forecast we tune against. Some House ratings on Wikipedia are months old; we use them as listed.
      </p>

      <h2>Tuned to agree with DDHQ</h2>
      <p>
        <strong>
          The forecast&apos;s hyperparameters are tuned so that its race chances, seat counts and chamber odds agree with Decision Desk
          HQ&apos;s published forecast.
        </strong>{" "}
        The fitted model stays as fit; only settings that apply to every race of an office move. We searched them against DDHQ&apos;s
        public toss-ups, race chances, seats and chamber odds: first for the same toss-ups in each office, then each
        chamber&apos;s expected seats and control, then each race within five points of DDHQ&apos;s chance. No race is adjusted on its own, and none of DDHQ&apos;s numbers are
        stored here. The settings in use:
      </p>
      <ul>
        <li>
          Uncertainty multiplier: House {TUNING.k.house.toFixed(2)}, Senate {TUNING.k.senate.toFixed(2)}, governors{" "}
          {TUNING.k.governor.toFixed(2)} (the backtest&apos;s own: {FIT.house.calibration.k.toFixed(2)}, {FIT.senate.calibration.k.toFixed(2)},{" "}
          {FIT.senateNoFundraising.calibration.k.toFixed(2)}).
        </li>
        <li>
          Markets: up to {pct(TUNING.markets.max.house)} of the chance in House races, {pct(TUNING.markets.max.senate)} in Senate races
          and {pct(TUNING.markets.max.governor)} for governors, prices clipped to {pct(TUNING.markets.clip)}–{pct(1 - TUNING.markets.clip)}.
        </li>
        <li>
          Expert ratings: {pct(TUNING.experts.house)} of the chance in House races, {pct(TUNING.experts.senate)} in Senate races and{" "}
          {pct(TUNING.experts.governor)} for governors.
        </li>
        <li>
          The fitted environment coefficient times {TUNING.environment.toFixed(2)}; the incumbent&apos;s own vote times{" "}
          {TUNING.personal.house.toFixed(2)} for the House, {TUNING.personal.senate.toFixed(2)} for the Senate and{" "}
          {TUNING.personal.governor.toFixed(2)} for governors, counting at most {TUNING.personalCap.house} points of a House
          member&apos;s past overperformance ({TUNING.personalCap.senate} for senators, {TUNING.personalCap.governor} for governors).
          The flat incumbency bonus times {TUNING.incumbency.house.toFixed(1)} for the House, {TUNING.incumbency.senate.toFixed(1)} for
          the Senate and {TUNING.incumbency.governor.toFixed(1)} for governors.
        </li>
        <li>
          The fitted lean coefficient times {TUNING.lean.house.toFixed(2)} for the House, {TUNING.lean.senate.toFixed(2)} for the Senate
          and {TUNING.lean.governor.toFixed(2)} for governors, and every race&apos;s fundamentals moved {signed(TUNING.offset.house)},{" "}
          {signed(TUNING.offset.senate)} and {signed(TUNING.offset.governor)} points toward the Democrat.
        </li>
        <li>
          Fundraising: the fitted coefficient times {TUNING.fundraising.house.toFixed(2)} for the House and{" "}
          {TUNING.fundraising.senate.toFixed(2)} for the Senate; a ratio past {Math.round(Math.exp(TUNING.fundraisingCap.house))} to 1
          adds nothing more in House races ({Math.round(Math.exp(TUNING.fundraisingCap.senate))} to 1 in the Senate).
        </li>
        <li>
          Polls: up to {pct(TUNING.pollMax.house)} of the margin in House races, {pct(TUNING.pollMax.senate)} in Senate races and{" "}
          {pct(TUNING.pollMax.governor)} for governors, reaching it at {TUNING.pollFull.house}, {TUNING.pollFull.senate} and{" "}
          {TUNING.pollFull.governor} polls.
        </li>
        <li>
          In the chamber simulations, the share of each race&apos;s uncertainty that moves with other races (the national, regional
          and lean-band errors): {pct(SHARE.house)} for the House, {pct(SHARE.senate)} for the Senate and {pct(SHARE.governor)} for
          governors, against {pct(BACKTEST_SHARE.house)}, {pct(BACKTEST_SHARE.senate)} and {pct(BACKTEST_SHARE.governor)} from the
          backtest&apos;s cycle-wide, regional and lean-band errors alone. A race&apos;s total uncertainty, and so its chance, is the
          same either way; a larger shared share makes races swing together, so chamber control follows the tipping-point races
          more closely, as in DDHQ&apos;s correlated simulations.{" "}
          {TUNING.nationalShare.senate !== null &&
            `In the Senate the shared part is ${pct(TUNING.nationalShare.senate)} national, so all its races move together. `}
          On past cycles: {SEAT_CHECK}
        </li>
      </ul>
      <p>
        On our own backtest the tuned multipliers score about as well as the backtest&apos;s: House Brier{" "}
        {FIT.house.calibration.after.brier.toFixed(3)} against {FIT.house.calibration.tuned?.brier.toFixed(3)} tuned, Senate{" "}
        {FIT.senate.calibration.after.brier.toFixed(3)} against {FIT.senate.calibration.tuned?.brier.toFixed(3)}. The personal-vote
        scales are a bigger departure from the fit: {TUNING.personal.house.toFixed(2)} times the fitted coefficient for the House, {TUNING.personal.senate.toFixed(2)} for the Senate (where the expert ratings carry what it measured) and {TUNING.personal.governor.toFixed(2)} for governors. So this is a forecast built on DDHQ&apos;s
        method and kept in line with their published numbers, not an independent check on them. Where the two still differ,
        it&apos;s because our inputs differ: our polling averages, our generic ballot, or the market prices we read.
      </p>

      <h2>Ratings</h2>
      <p>
        Ratings come straight from the chance of winning, on DDHQ&apos;s scale: Safe at 95% or more, Likely at 75%, Lean above 60%, and
        Toss-up otherwise. A race between two candidates of the same party, such as some of California&apos;s top-two races, has no
        partisan forecast unless a market prices it.
      </p>

      <h2>Chamber control</h2>
      <p>
        To get the chance of controlling the House, Senate and a majority of governorships, we simulate the election 10,000 times.
        Races don&apos;t miss independently, so each simulation draws errors that are shared, across all three offices at once:
      </p>
      <ul>
        <li>
          <strong>A national error</strong> that moves every race, sized from how far whole cycles ran from the model in the backtest
          (about {FIT.house.cycleBias.toFixed(1)} points for the House, before the tuned scale): the generic ballot&apos;s miss shows up
          there, as in 2018 and 2020.
        </li>
        <li>
          <strong>A regional error</strong> for each of the nine census divisions, about {FIT.correlation.region} points, so seats in
          Pennsylvania and Ohio tend to move together.
        </li>
        <li>
          <strong>A wave error</strong> for each band of partisan lean, about {FIT.correlation.bucket} points: a stand-in for the
          demographic swings that hit similar seats alike.
        </li>
      </ul>
      <p>
        Their sizes come from the backtest: how much the held-out misses of races in the same division, or the same lean band, moved
        together within a cycle, beyond what chance alone would produce. What&apos;s left is each race&apos;s own error.
      </p>
      <p>
        Democrats&apos; chance of controlling the House or Senate is the chance Republicans fall short of what they need to keep it:
        218 House seats, or 50 Senate seats, since the vice president breaks a 50–50 tie. An independent who beats the
        Republican, such as Dan Osborn in Nebraska, counts with the Democrats&apos; seats, as in Decision Desk HQ&apos;s seat totals,
        and so against Republican control; the two parties&apos; chances add to 100%.
      </p>

      <h2>On election night</h2>
      <p>
        Once a race starts counting votes, its forecast is frozen at its last pre-election value and labeled that way. Counts, leads and
        calls take over from there.
      </p>

      <h2 id="polls">Polling average</h2>
      <p>
        We average polls the way <a href="https://votes-docs.decisiondeskhq.com/polling-methodology">DDHQ describes</a>. Any poll that
        discloses its field dates and sample size counts, with no adjustment for pollster, sample size or partisan sponsor. Only two things
        change how much a poll counts:
      </p>
      <ul>
        <li>
          <strong>Recency.</strong> With few polls, the average weights each poll by how recent it is, keeping real weight on older ones.
          As polls accumulate it blends toward a smooth cubic-spline trend, and from 15 polls on it is the trend alone, but only as
          far as recent polls support it: the trend gets its full weight with five or more polls in the last 30 days, so two or three
          late polls can&apos;t pull the line on their own.
        </li>
        <li>
          <strong>Campaign internals.</strong> A campaign&apos;s first internal poll counts like any other; its later internals are averaged
          into that first one rather than counted again, so a campaign can&apos;t flood the average.
        </li>
      </ul>
      <h3>The generic ballot</h3>
      <p>
        The national generic ballot is averaged the same way from VoteHub&apos;s polls. That feed has gone thin in the final weeks, so
        our own average is trusted in proportion to how many polls it has from the last two weeks (fully at five). The rest comes from
        the median of the public aggregates listed on{" "}
        <a href={AGGREGATES_SOURCE}>Wikipedia&apos;s 2026 House elections page</a> that were updated in the past week. Decision Desk
        HQ&apos;s average is left out of that median because we compare our forecast against theirs.
      </p>
      <p>
        A race needs at least two qualifying polls for an average. When a pollster releases likely-voter and registered-voter versions
        of the same poll, the likely-voter version is used. Each race page lists every poll, and marks the ones left out of the average
        and why.
      </p>

      <h2>Sources</h2>
      <ul>
        <li>
          Presidential results by congressional district, for 2026 and for each map since 2018: <a href="https://www.the-downballot.com/p/the-downballots-calculations-of-presidential">The Downballot</a>.
        </li>
        <li>
          House, Senate and presidential returns, 2016 to 2024: <a href="https://electionlab.mit.edu/data">MIT Election Data and Science Lab</a> (Harvard Dataverse, CC0).
        </li>
        <li>
          Fundraising and incumbency for the fit and for 2026: <a href="https://www.fec.gov/data/browse-data/?tab=bulk-data">FEC candidate summaries</a>.
        </li>
        <li>Statewide 2024 results: county returns compiled for Ballotwise.</li>
        <li>
          Polls and the generic ballot: <a href="https://votehub.com/polls">VoteHub</a>, under CC BY 4.0.
        </li>
        <li>
          Incumbents: <a href="https://github.com/unitedstates/congress-legislators">congress-legislators</a>, The Downballot and{" "}
          <a href="https://www.wikidata.org">Wikidata</a>.
        </li>
        <li>
          Generic-ballot aggregates: FiftyPlusOne, NBC News, RealClearPolitics, Silver Bulletin and others as tabulated on{" "}
          <a href={AGGREGATES_SOURCE}>Wikipedia</a> (CC BY-SA).
        </li>
        <li>
          Expert ratings: the Cook Political Report, Inside Elections and Sabato&apos;s Crystal Ball, as reproduced on Wikipedia&apos;s
          2026 election pages (CC BY-SA).
        </li>
        <li>Markets: Kalshi and Polymarket.</li>
        <li>
          Method: modeled on <a href="https://www.decisiondeskhq.com">Decision Desk HQ</a>&apos;s published forecast and polling
          methodologies. Ballotwise isn&apos;t affiliated with DDHQ, and our numbers are our own.
        </li>
      </ul>
    </article>
  );
}
