import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How it works" };

export default function Method() {
  return (
    <article className="wrap prose">
      <h1>How Ballotwise works</h1>
      <p className="lede-sm" style={{ marginTop: 10 }}>
        A voter guide is only fair if you can check how it was made. Here is everything we do.
      </p>

      <h2>Finding the race</h2>
      <p>
        When you search, Grok looks up the race on the web: the date, who&apos;s running, and what the office does. It prefers
        official election websites and Ballotpedia. It also picks the 4 to 6 issues that office actually deals with, and words each
        one as a choice between two reasonable views. Which view is shown on the left is decided by a coin flip, so one side
        isn&apos;t always first.
      </p>

      <h2>Looking up each candidate</h2>
      <p>
        Each candidate is looked up on their own, with the exact same questions, so the AI never writes about one candidate while
        looking at another. It&apos;s told to describe positions the way the candidate does, use their own words when it can, avoid
        loaded language, and never guess a position from someone&apos;s party.
      </p>
      <ul>
        <li>Every fact needs a link to where it came from. Facts without one are dropped.</li>
        <li>We check each link against the pages Grok actually opened. Links to anything else are removed.</li>
        <li>If we can&apos;t find where a candidate stands on an issue, we estimate it from their own other positions, record and endorsements (never from party alone), draw it with dashed ovals, and say what the estimate rests on.</li>
      </ul>

      <h2>Ballot measures</h2>
      <p>
        Propositions and local measures are looked up the same way. We start with the official ballot label and the
        analyst&apos;s summary of what the measure would change. Then the Yes side and the No side are each looked up on their own,
        from their own ballot argument, campaign, funding and endorsements, and placed on the same issues. Your match tells you
        which side is closer to your answers.
      </p>

      <h2>Keeping it fair</h2>
      <ul>
        <li>Candidates are listed in a new random order every time you visit.</li>
        <li>No party colors and no photos. Party is shown the way it appears on the ballot.</li>
        <li>Everyone&apos;s positions are shown on the same five-circle scale between the two views.</li>
      </ul>

      <h2>Your best match</h2>
      <p>
        The 10-minute interview asks what you want from government and how much each thing matters to you. For each race, the AI
        places your answers on that race&apos;s issues without seeing any candidates. Where your answers don&apos;t cover an
        issue, it makes a mild, low-weight inference from your related views, marks it as inferred and says what it rests on. You
        can change any answer.
      </p>
      <p>
        The match itself is simple math, not AI. On each issue, you and a candidate agree 100% if you picked the same circle and 0%
        if you picked opposite ends. Issues that matter more to you count more. Estimated stances count
        toward the score; if not even an estimate is possible, that issue is left out of their score, and the page tells you how much of your answers the score is based on.
      </p>
      <p>
        You can change any of your answers in a race, or fix a candidate&apos;s position if you think we got it wrong. The score
        updates right away. Your match shows who agrees with you most. It isn&apos;t advice on how to vote.
      </p>

      <h2>Your ballot</h2>
      <p>
        If you add your address, the US Census Bureau&apos;s free lookup tells us your districts: U.S. House, state legislature,
        county, city, and school district. Grok then searches official election sources for the races in those districts over the
        next 12 months, and looks up each race the same way as a search. Some districts, like city council wards, aren&apos;t in
        the Census data. We only include those races when Grok can confirm them from an official source. Your official sample
        ballot is always the final word.
      </p>

      <h2>What it can get wrong</h2>
      <ul>
        <li>AI can misread a source. Follow the links on anything that matters to your vote.</li>
        <li>Small local races have less written about them, so there&apos;s less to go on.</li>
        <li>Ballot measures aren&apos;t covered yet.</li>
        <li>Check your county election office for dates, deadlines, and where to vote.</li>
      </ul>

      <h2>Your information</h2>
      <p>
        Your account keeps your email, your password (scrambled so no one can read it), your address if you add one, your races,
        your answers, and which races you&apos;ve marked as voted. No one else can see any of it. The research runs on your own Grok
        account, and we keep that connection encrypted. <Link href="/">Back to search</Link>
      </p>
    </article>
  );
}
