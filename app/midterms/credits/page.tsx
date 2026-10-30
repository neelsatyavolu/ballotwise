import type { Metadata } from "next";
import Link from "next/link";
import "../midterms.css";

export const metadata: Metadata = { title: "Sources and credits: 2026 midterms" };

/** Every source behind the midterms tracker, in one place instead of a paragraph on every page. */
export default function Credits() {
  return (
    <article className="wrap mt mt-method prose">
      <p className="small">
        <Link href="/midterms">← Midterms 2026</Link>
      </p>
      <h1>Sources and credits</h1>

      <h2>Results and calls</h2>
      <p>
        Live results and race calls come from <a href="https://civicapi.org">civicAPI</a>, which collects them from state and county election offices. A race is marked won
        only when civicAPI&apos;s own decision desk calls it; these are not AP or Decision Desk HQ calls. &ldquo;Leading&rdquo; counts uncalled races by who is ahead, and
        &ldquo;reporting&rdquo; is precincts or ballot batches in, not the share of the expected vote.
      </p>

      <h2>Forecast and ratings</h2>
      <p>
        Ratings and win chances come from our own forecast, which follows Decision Desk HQ&apos;s published method. <Link href="/midterms/methodology">How the forecast works</Link>{" "}
        lists every input. In short:
      </p>
      <ul>
        <li>
          Polls from <a href="https://votehub.com/polls">VoteHub</a>, under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
        </li>
        <li>
          Market prices from <a href="https://kalshi.com">Kalshi</a> and <a href="https://polymarket.com">Polymarket</a>.
        </li>
        <li>
          2024 presidential results by congressional district from <a href="https://www.the-downballot.com/p/the-downballots-calculations-of-presidential">The Downballot</a>.
        </li>
        <li>
          Past results from the <a href="https://electionlab.mit.edu/">MIT Election Data and Science Lab</a>; fundraising from the <a href="https://www.fec.gov/data/browse-data/?tab=bulk-data">FEC</a>; the
          generic-ballot aggregates listed on Wikipedia, under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>.
        </li>
        <li>
          Race ratings from the <a href="https://www.cookpolitical.com">Cook Political Report</a>,{" "}
          <a href="https://insideelections.com">Inside Elections</a> and{" "}
          <a href="https://centerforpolitics.org/crystalball/">Sabato&apos;s Crystal Ball</a>, as reproduced on Wikipedia&apos;s 2026
          election pages, under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>.
        </li>
      </ul>

      <h2>Maps and seats</h2>
      <ul>
        <li>
          State and county shapes from <a href="https://github.com/topojson/us-atlas">us-atlas</a>; 2026 congressional district lines from the{" "}
          <a href="https://www.census.gov/programs-surveys/decennial-census/about/rdo/congressional-districts.html">Census Bureau</a>.
        </li>
        <li>
          2024 county results from <a href="https://github.com/tonmcg/US_County_Level_Election_Results_08-24">tonmcg/US_County_Level_Election_Results</a>.
        </li>
        <li>
          Who holds each seat now from <a href="https://github.com/unitedstates/congress-legislators">congress-legislators</a>.
        </li>
        <li>
          Poll closing times from <a href="https://www.270towin.com/content/local-poll-closing-times-november-2026-general-election/">270toWin</a>.
        </li>
        <li>
          Ballot measure summaries from <a href="https://ballotpedia.org/2026_ballot_measures">Ballotpedia</a>.
        </li>
      </ul>

      <h2>Candidate photos</h2>
      <p>
        From <a href="https://commons.wikimedia.org">Wikimedia Commons</a>, each under its own free license, and the official congressional portraits collected by{" "}
        <a href="https://github.com/unitedstates/images">unitedstates/images</a> (public domain). A photo is shown only when we&apos;re certain it&apos;s the right person;
        everyone else is shown by initials.
      </p>
    </article>
  );
}
