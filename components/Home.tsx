"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAccount } from "@/components/AccountProvider";
import { GrokConnect } from "@/components/GrokConnect";
import { Specimen } from "@/components/Specimen";
import { api, newGuideId } from "@/lib/client";
import type { GuideSummary } from "@/lib/guides";

const EXAMPLES = ["California governor 2026", "Seattle city council", "Texas Senate race", "Los Angeles mayor 2026"];

export function Home({ initialQuery }: { initialQuery: string }) {
  const { user, grok, loading } = useAccount();
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [guides, setGuides] = useState<GuideSummary[] | null>(null);

  useEffect(() => {
    if (!user) return;
    api<{ guides: GuideSummary[] }>("/api/guides").then((r) => setGuides(r.guides)).catch(() => setGuides([]));
  }, [user]);

  function start(q: string) {
    const trimmed = q.trim();
    if (trimmed.length < 3) return;
    if (!user) {
      router.push(`/signup?next=${encodeURIComponent(`/?q=${trimmed}`)}`);
      return;
    }
    router.push(`/guide/${newGuideId()}?q=${encodeURIComponent(trimmed)}`);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    start(query);
  }

  const ready = user && grok === "connected";

  return (
    <div className="wrap">
      <section className="hero">
        <div className="hero-grid">
        <div className="hero-copy">
        <h1>See every candidate on the same page.</h1>
        <p className="lede">
          Type in any race on your ballot. Ballotwise looks up every candidate the same way, links each fact to where it came
          from, and shows who agrees with you most.
        </p>
        {!loading && user && grok !== "connected" && <GrokConnect />}
        {!loading && user && grok === "connected" && (
          <p className="notice">
            <Link href="/ballot">Add your address</Link> to get every race on your ballot, and take the{" "}
            <Link href="/interview">10-minute interview</Link> to see who agrees with you most in each one.
          </p>
        )}
        <form className="search" onSubmit={submit} role="search">
          <label htmlFor="q" style={{ position: "absolute", left: -9999 }}>Election or race</label>
          <input
            id="q"
            className="input"
            placeholder="A race, like Denver mayor"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={Boolean(user) && !ready}
          />
          <button className="btn" type="submit" disabled={query.trim().length < 3 || (Boolean(user) && !ready)}>
            Look up
          </button>
        </form>
        <div className="examples">
          <span>Try</span>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="chip" onClick={() => (ready || !user ? start(ex) : setQuery(ex))}>
              {ex}
            </button>
          ))}
        </div>
        {!loading && !user && (
          <p className="hint">
            Make a free account to save your races, add your address, and see your best match. You&apos;ll also need a Grok
            account. Have an account? <Link href="/signin">Sign in</Link>.
          </p>
        )}
        </div>
        <Specimen />
        </div>
      </section>

      {user && guides && guides.length > 0 && (
        <section className="guides read">
          <h2>Races you looked up</h2>
          <ul className="guide-list">
            {guides.map((g) => (
              <li key={g.id}>
                <Link href={`/guide/${g.id}`}>{g.title}</Link>
                <span className="small muted">{g.electionDate ?? "Date not set"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="principles" aria-label="How Ballotwise stays neutral">
        <div>
          <h3>Every fact has a link</h3>
          <p>Each fact links to where it came from. When we can&apos;t find where a candidate stands, we say so instead of guessing.</p>
        </div>
        <div>
          <h3>Same questions for everyone</h3>
          <p>Each candidate is looked up on their own with the same questions. Names are shuffled, and there are no party colors.</p>
        </div>
        <div>
          <h3>You decide the match</h3>
          <p>Your match is simple math on your own answers. You can see how it was worked out and change anything.</p>
        </div>
      </section>
    </div>
  );
}
