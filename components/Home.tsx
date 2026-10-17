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
          Type any race on your ballot. Ballotwise researches each candidate the same way, cites a source for every claim, and
          can show who lines up with the issues you care about.
        </p>
        {!loading && user && grok !== "connected" && <GrokConnect />}
        {!loading && user && grok === "connected" && (
          <p className="notice">
            Want every contest on your ballot researched for you? <Link href="/ballot">Add your address on My ballot</Link>.
          </p>
        )}
        <form className="search" onSubmit={submit} role="search">
          <label htmlFor="q" style={{ position: "absolute", left: -9999 }}>Election or race</label>
          <input
            id="q"
            className="input"
            placeholder="Office and place, like Denver mayor"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={Boolean(user) && !ready}
          />
          <button className="btn" type="submit" disabled={query.trim().length < 3 || (Boolean(user) && !ready)}>
            Look up race
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
            Create a free account and add your address to have every contest on your ballot researched and tracked. You&apos;ll
            need a Grok account for the research. <Link href="/signin">Sign in</Link> if you have one.
          </p>
        )}
        </div>
        <Specimen />
        </div>
      </section>

      {user && guides && guides.length > 0 && (
        <section className="guides read">
          <h2>Your guides</h2>
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
          <h3>Sourced or left out</h3>
          <p>Each claim links to where it came from. Citations to pages Grok never opened are removed, and a missing position says so.</p>
        </div>
        <div>
          <h3>One template for everyone</h3>
          <p>Every candidate is researched separately with the same questions, listed in shuffled order, with no party colors.</p>
        </div>
        <div>
          <h3>Your answers do the matching</h3>
          <p>The match is plain arithmetic on your answers and the sourced positions. You can see every step and correct any of it.</p>
        </div>
      </section>
    </div>
  );
}
