"use client";
// The companion screen's other view: every race on the voter's ballot (the Near you page's: governor, Senate, House,
// legislature, city and school, measures) as compact cards filling the window, a screenful at a time.

import Link from "next/link";
import { useMemo, useRef } from "react";
import { useAccount } from "@/components/AccountProvider";
import type { LocalAnswer } from "@/lib/midterms/local";
import { ballotRaces } from "@/lib/midterms/nearYou";
import type { RaceSummary } from "@/lib/midterms/view";
import { useLive } from "./hooks";
import { RaceCard } from "./RaceCard";
import { useRotatingFit } from "./useRotatingFit";

const noop = () => {};

export function CompanionNearYou({ races }: { races: readonly RaceSummary[] }) {
  const { user } = useAccount();
  const live = useLive<LocalAnswer>(user ? "/api/midterms/local" : null);
  const local = live.data?.local ?? null;
  const list = useMemo(() => (local ? ballotRaces(local, races) : []), [local, races]);
  const grid = useRef<HTMLUListElement>(null);
  useRotatingFit(grid, undefined, list.length > 0);
  if (!user) return <p className="mt-cny-note">Sign in and add your address on <Link href="/midterms/near-you">Near you</Link> to see the races on your ballot here.</p>;
  if (!live.data) return <p className="mt-cny-note muted">{live.error ?? "Loading your races…"}</p>;
  if (!local) return <p className="mt-cny-note">Add your address on <Link href="/midterms/near-you">Near you</Link> to see the races on your ballot here.</p>;
  return (
    <section className="mt-cny" aria-label="The races on your ballot">
      <div className="mt-section-head tight">
        <h2>Your ballot · {local.area}</h2>
        <span className="muted small">{list.length} races</span>
      </div>
      <ul className="mt-grid mt-cny-cards" ref={grid}>
        {list.map((r) => (
          <RaceCard key={r.id} race={r} starred={null} onStar={noop} limit={3} />
        ))}
      </ul>
    </section>
  );
}
