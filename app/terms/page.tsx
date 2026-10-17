import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, MIN_AGE, OPERATOR, TERMS_DATE } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service" };

export default function Terms() {
  return (
    <article className="wrap prose">
      <h1>Terms of Service</h1>
      <p className="muted">Last updated {TERMS_DATE}</p>
      <p>
        These terms are an agreement between you and {OPERATOR} (&ldquo;we&rdquo;), who runs Ballotwise. By creating an account or using
        Ballotwise, you agree to them and to our <Link href="/privacy">Privacy Policy</Link>. If you don&apos;t agree, don&apos;t use
        Ballotwise.
      </p>

      <h2>Who can use Ballotwise</h2>
      <p>
        You must be at least {MIN_AGE} years old. You need to give a real email address, keep your password to yourself, and use only
        your own account. You are responsible for what happens on your account.
      </p>

      <h2>What Ballotwise is, and isn&apos;t</h2>
      <p>
        Ballotwise uses AI (Grok) to search the web and summarize races, candidates and ballot measures, with links to its sources. It
        then shows which candidates or sides are closest to the answers you give. Please keep in mind:
      </p>
      <ul>
        <li><strong>It can be wrong.</strong> AI research can miss things, misread sources, or be out of date. Check anything that matters to your vote against the linked sources and your official voter guide.</li>
        <li><strong>It isn&apos;t official.</strong> Ballotwise is not affiliated with any election office, government agency, campaign, candidate or party. Your county elections office is the authority on what is on your ballot, deadlines, and how and where to vote.</li>
        <li><strong>It doesn&apos;t endorse anyone.</strong> A match shows how your answers compare with what we found. It is not a recommendation from us, and how you vote is your decision.</li>
        <li><strong>Estimates are labeled.</strong> When a stance has to be estimated, we say so and explain what the estimate rests on.</li>
      </ul>
      <p>
        See <Link href="/method">How it works</Link> for how races are researched and kept balanced.
      </p>

      <h2>Your Grok account</h2>
      <p>
        Research runs on your own Grok account, which you connect. That account is governed by xAI&apos;s terms, and any usage limits or
        charges on it are between you and xAI. You can disconnect it by deleting your Ballotwise account or by revoking access in your
        Grok settings.
      </p>

      <h2>Your information</h2>
      <p>
        Your interview answers and the choices you make stay yours. You let us store and process them only to run Ballotwise for you,
        as described in the <Link href="/privacy">Privacy Policy</Link>. Research about a race contains nothing about you and may be
        shared with other voters who have the same race.
      </p>

      <h2>Acceptable use</h2>
      <p>Don&apos;t:</p>
      <ul>
        <li>break the law, or use Ballotwise to mislead voters, suppress votes, or interfere with an election;</li>
        <li>present Ballotwise research or matches as official, or as an endorsement from us or from anyone else;</li>
        <li>access or collect data from Ballotwise with bots or scrapers, or make so many requests that it slows the service for others;</li>
        <li>try to get into other people&apos;s accounts, get around security or rate limits, or disrupt the service;</li>
        <li>create accounts in bulk or for someone else without their permission.</li>
      </ul>

      <h2>Content and sources</h2>
      <p>
        Research summaries link to third-party websites that we don&apos;t control and aren&apos;t responsible for. Quotes and facts
        belong to their sources. You may share what Ballotwise shows you for personal, non-commercial use, as long as you don&apos;t
        present it as official. The Ballotwise name, design and software are ours.
      </p>

      <h2>Ending your account</h2>
      <p>
        You can <Link href="/account">delete your account</Link> at any time. We may suspend or close an account that breaks these
        terms. We may also change or stop offering Ballotwise, and will try to give notice before shutting it down.
      </p>

      <h2>Disclaimers</h2>
      <p>
        Ballotwise is free and provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, including
        accuracy, completeness, fitness for a particular purpose, or uninterrupted availability, to the fullest extent the law allows.
      </p>

      <h2>Limit of liability</h2>
      <p>
        To the fullest extent the law allows, we are not liable for indirect, incidental, special or consequential damages, or for
        decisions you make based on Ballotwise. Our total liability for any claim about Ballotwise is limited to $50. Some places
        don&apos;t allow these limits, so they may not all apply to you.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the State of California, without regard to its conflict-of-law rules. Any dispute will
        be decided in the state or federal courts in Santa Clara County, California, unless the law where you live gives you the right
        to bring it elsewhere.
      </p>

      <h2>Changes</h2>
      <p>
        If we change these terms in a way that matters, we will update the date above and ask you to accept the new version the next
        time you sign in. If you don&apos;t accept, you can delete your account.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </article>
  );
}
