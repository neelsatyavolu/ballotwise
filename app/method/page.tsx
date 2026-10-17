import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How it works" };

export default function Method() {
  return (
    <article className="wrap prose">
      <h1>How Ballotwise researches a race</h1>
      <p className="muted" style={{ marginTop: 12, fontSize: 19 }}>
        An AI voter guide is only as fair as its method, so here is the whole method.
      </p>

      <h2>Finding the race</h2>
      <p>
        When you search, Grok runs live web searches to identify the contest, its date, and the qualified candidates, preferring
        official election offices and Ballotpedia. If your search covers several contests, you pick one. Grok also chooses the
        4–6 issues that office actually decides and words each as a tradeoff between two positions reasonable people hold.
        Which side is listed first is decided by a coin flip for every issue, so neither camp is always on the left.
      </p>

      <h2>Researching each candidate</h2>
      <p>
        Every candidate gets the same request, sent separately, so the model never writes one profile while looking at another.
        It is told to describe positions the way the candidate does, quote them where possible, avoid loaded adjectives, and
        never infer a position from party.
      </p>
      <ul>
        <li>Every claim must carry a source link. Claims without one are dropped.</li>
        <li>Links are checked against the pages Grok actually retrieved during that search. Citations to anything else are removed, and a claim left with no source goes with them.</li>
        <li>A position without a source shows as “No sourced position” rather than a guess.</li>
      </ul>

      <h2>Showing it fairly</h2>
      <ul>
        <li>Candidates appear in a random order that changes on every visit, as many states rotate names on ballots.</li>
        <li>No party colors and no photos. Party is plain text, as listed on the ballot.</li>
        <li>Each position is drawn on the same five-oval scale between the issue&apos;s two sides.</li>
      </ul>

      <h2>Finding your match</h2>
      <p>
        The interview asks where you stand on each issue and how much it matters. The match is arithmetic, not AI: for each issue,
        agreement is 100% when your oval and the candidate&apos;s are the same and 0% when they are at opposite ends, and issues
        are weighted 1, 2 or 3 by how much they matter to you. Issues where a candidate has no sourced position are left out of
        their score, and the page says how much of your answer it covers.
      </p>
      <p>
        If you think a position is wrong, correct it in the results table. The score updates, and your correction is marked as
        yours. The result says who lines up with what you told it. It is not advice on how to vote.
      </p>

      <h2>Limits</h2>
      <ul>
        <li>AI can still misread a source. Follow the links on anything that matters to your vote.</li>
        <li>Coverage is thinner for local races with little press, and research reflects what is online on the day you search.</li>
        <li>Ballot measures aren&apos;t covered yet.</li>
        <li>Check your official sample ballot and your election office for dates, deadlines, and where to vote.</li>
      </ul>

      <h2>Your ballot</h2>
      <p>
        If you add your address, the US Census geocoder matches it to your congressional, state legislative, county, city and
        school districts. Grok then searches official election sources for the contests in those districts over the next 12
        months, and each contest is researched in the background the same way as a search. Districts the Census doesn&apos;t
        publish, such as city council wards, are confirmed from official sources or left out. Your official sample ballot is
        still the final word.
      </p>

      <h2>Your data</h2>
      <p>
        Your account holds your email, a scrambled version of your password, your address if you add one, and your guides,
        including your answers and which contests you&apos;ve marked as voted. None of it is shown to anyone else. Research runs
        on your own Grok account through xAI&apos;s sign-in, and that connection is stored encrypted so research can continue
        while you&apos;re away. <Link href="/">Back to search</Link>
      </p>
    </article>
  );
}
