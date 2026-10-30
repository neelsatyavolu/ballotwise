"use client";

// The overview's "Near you" tab: live results for the races near the address saved on the voter's ballot page.
import Link from "next/link";
import { useAccount } from "@/components/AccountProvider";
import type { LocalAnswer } from "@/lib/midterms/local";
import { SANTA_CLARA_RESULTS } from "@/lib/midterms/view";
import { CheckedAgo, LiveDot } from "./CheckedAgo";
import { useLive } from "./hooks";
import { RaceRows, type Star } from "./RaceRows";

// Stars are for the tracked races only, so local rows have none.
const NO_STARS: Star = { ids: null, toggle: () => {} };

function Ask({ title, text, href, action }: { title: string; text: string; href: string; action: string }) {
  return (
    <div className="panel stack">
      <h2>{title}</h2>
      <p>{text}</p>
      <p>
        <Link href={href} className="btn">{action}</Link>
      </p>
    </div>
  );
}

export function NearYou() {
  const { user, loading } = useAccount();
  const live = useLive<LocalAnswer>(user ? "/api/midterms/local" : null);
  if (loading) return null;
  if (!user) return <Ask title="Follow the races on your ballot" text="Sign in and add your home address to see your city, county and school races here, live on election night." href="/signin?next=/midterms" action="Sign in" />;
  if (!live.data) return live.error ? <p className="error">{live.error}</p> : null;

  const { local, fetchedAt, stale } = live.data;
  if (!local) return <Ask title="Add your address" text="Your city, county and school races show here once your account has your home address. It stays private to you." href="/ballot" action="Add your address" />;
  const county = local.source === "county";
  const counting = [...local.yours, ...local.nearby].some((r) => r.total > 0);

  return (
    <div className="stack mt-in">
      <div className="mt-section-head tight">
        <h2>Races near {local.area}</h2>
        <span className="small muted">
          <LiveDot at={fetchedAt} stale={stale} idle={!counting} /> Checked <CheckedAgo at={fetchedAt} />
          {stale && " · source is slow"}
        </span>
      </div>
      {live.error && <p className="error small">{live.error} Showing the last results we got.</p>}
      {!local.yours.length && !local.nearby.length && (
        <p className="mt-empty small">
          {county ? "Santa Clara County lists no city or school race for your address this year." : `civicAPI doesn't list any Nov 3 races for ${local.area} yet. Local results fill in as counties load their feeds.`}
        </p>
      )}
      {local.yours.length > 0 && (
        <section className="mt-group">
          <h3>On your ballot</h3>
          <RaceRows races={local.yours} star={NO_STARS} rated={false} />
        </section>
      )}
      {local.nearby.length > 0 && (
        <section className="mt-group">
          <h3>{county ? "Depends on your district" : "In your area"}</h3>
          <p className="muted small">
            {county
              ? "Each of these is for one council district or trustee area. The Census doesn't say which one your address is in; your sample ballot does."
              : "Races civicAPI lists for your city and county. Some are for a district or ward you may not live in; your sample ballot says which are yours."}
          </p>
          <RaceRows races={local.nearby} star={NO_STARS} rated={false} />
        </section>
      )}
      <p className="muted small">
        Matched from the address on your <Link href="/ballot">ballot page</Link>, where you can change it. Results from{" "}
        {county ? <a href={SANTA_CLARA_RESULTS}>Santa Clara County</a> : <a href="https://civicapi.org">civicAPI</a>}.
      </p>
    </div>
  );
}
