import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, MIN_AGE, OPERATOR, TERMS_DATE } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function Privacy() {
  return (
    <article className="wrap prose">
      <h1>Privacy Policy</h1>
      <p className="muted">Last updated {TERMS_DATE}</p>
      <p>
        Ballotwise is run by {OPERATOR} (&ldquo;we&rdquo;). This policy explains what we collect when you use ballotwise.xanom.co, why,
        who else receives it, and how to get it deleted. Your interview answers say what you think about political issues, so we
        treat them as sensitive and use them only to show you your own matches.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your email address and a scrambled form of your password (a salted scrypt hash). We never store or see the password itself.</li>
        <li><strong>Address:</strong> the home address you enter, the standardized version the US Census returns, and the districts it falls in.</li>
        <li><strong>Interview:</strong> your answers to the values interview, and the summary of your views written from them.</li>
        <li><strong>Your ballot and guides:</strong> the races we find for you, races you search for, your answers on each race&apos;s issues, and which races you have marked as voted.</li>
        <li><strong>Grok connection:</strong> the sign-in tokens that let us use your Grok account for you. They are encrypted before they are stored. We never see your Grok password.</li>
        <li><strong>Security records:</strong> failed sign-ins and password reset requests, stored only as a one-way hash of your email so we can slow down password guessing. They are deleted within an hour.</li>
        <li><strong>One cookie:</strong> a sign-in cookie that keeps you signed in for up to 30 days. We use no advertising, analytics or tracking cookies.</li>
        <li><strong>Page views:</strong> a cookieless counter records the page you open (without anything after the &ldquo;?&rdquo; and with ids blanked out), the site that sent you, your country, and your browser and device type. It stores no IP address or account details and can&apos;t link your visits from one day to the next.</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to run Ballotwise for you: to find the races on your ballot, research them, show where each candidate or side stands, place
        your interview answers on each race&apos;s issues, send password reset emails, and keep your account secure. We don&apos;t sell
        your information, share it for advertising, or use it to build profiles of voters. We don&apos;t contact you for marketing.
      </p>

      <h2>Who else receives it</h2>
      <p>These services handle parts of your information so Ballotwise can work:</p>
      <ul>
        <li>
          <strong>xAI (Grok).</strong> Research runs on your own Grok account. To find your ballot, we send Grok your standardized address
          and districts. Your interview runs through Grok, and the summary of your views is sent to Grok to place them on each
          race&apos;s issues. What xAI does with requests on your account is covered by{" "}
          <a href="https://x.ai/legal/privacy-policy" target="_blank" rel="noreferrer">xAI&apos;s privacy policy</a>.
        </li>
        <li><strong>US Census Bureau geocoder.</strong> Receives the address you enter, to match it to your districts.</li>
        <li><strong>Photon (komoot).</strong> Receives what you type in the address box, to suggest matching addresses.</li>
        <li><strong>Resend.</strong> Receives your email address when you ask for a password reset, to send the email.</li>
        <li><strong>Cloudflare.</strong> Hosts Ballotwise and its database, so everything above is stored on Cloudflare&apos;s servers in the United States.</li>
      </ul>
      <p>
        We may also disclose information if the law requires it, such as in response to a valid court order, and we will tell you if
        we are allowed to.
      </p>

      <h2>What is shared between voters</h2>
      <p>
        To save time, research about a race (who is running, what the office does, and each candidate&apos;s or side&apos;s profile) is
        shared with other voters who have the same race, for up to three days. The list of contests found in a county is shared with
        later lookups in that county. None of this contains anything about you: no address, answers, or account details. Your
        interview, your matches and your answers are never shared with other voters or used in anyone else&apos;s research.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your information until you delete your account. Sign-in sessions end after 30 days and reset links after one hour.
        When you delete your account, everything listed above is removed from our database at once. Copies can remain in our hosting
        provider&apos;s database backups for up to 30 days before they are overwritten.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li><strong>See and change:</strong> your address, interview and answers are all shown in the app, and you can change or redo them there.</li>
        <li><strong>Delete:</strong> you can <Link href="/account">delete your account</Link> at any time. This also disconnects Grok.</li>
        <li><strong>Get a copy:</strong> email us and we will send you the information we hold about you.</li>
      </ul>
      <p>
        California residents have the right to know what personal information we collect, to correct and delete it, to limit how
        sensitive information is used, and not to be treated differently for using these rights. We don&apos;t sell or share personal
        information as California law defines those terms, and we use your interview answers only to provide the service. To make a
        request, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We may need to confirm the request comes from the
        account holder. People in other places can make the same requests and we will honor them.
      </p>

      <h2>Security</h2>
      <p>
        All traffic uses HTTPS. Passwords are hashed, Grok tokens are encrypted, and sign-ins are rate limited. No system is perfectly
        secure. If a breach affects your information, we will tell you as the law requires.
      </p>

      <h2>Age</h2>
      <p>
        Ballotwise is for people {MIN_AGE} and older. We don&apos;t knowingly collect information from anyone younger. If you believe
        someone under {MIN_AGE} has an account, email us and we will delete it.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy in a way that matters, we will update the date above and ask you to accept the new version the next
        time you sign in.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. See also our{" "}
        <Link href="/terms">Terms of Service</Link>.
      </p>
    </article>
  );
}
