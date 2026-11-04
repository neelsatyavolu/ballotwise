"use client";

// The Near you screen: every race on the ballot at the voter's saved address, live, with a map of their state framed
// on their county. The address is the one the ballot page keeps, and can be added or changed here.
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useAccount } from "@/components/AccountProvider";
import { AddressInput } from "@/components/AddressInput";
import { api, ApiError } from "@/lib/client";
import type { LocalAnswer } from "@/lib/midterms/local";
import { trackedAt } from "@/lib/midterms/nearYou";
import { SANTA_CLARA_RESULTS, type Overview, type RaceSummary } from "@/lib/midterms/view";
import { CheckedAgo, LiveDot } from "./CheckedAgo";
import { useLive, useStars } from "./hooks";
import { ModeNav } from "./ModeNav";
import { NearYouMap } from "./NearYouMap";
import { RaceCard } from "./RaceCard";
import { OfficeSkeleton } from "./Skeleton";

/** Cards a long section shows before "Show more". */
const SHOWN = 8;

type Part = { key: "ticket" | "legislature" | "local" | "nearby" | "measures"; title: string; note?: string; races: RaceSummary[]; empty?: string };

function Ask({ title, text, href, action }: { title: string; text: string; href: string; action: string }) {
  return (
    <div className="panel stack mt-in">
      <h2>{title}</h2>
      <p>{text}</p>
      <p>
        <Link href={href} className="btn">{action}</Link>
      </p>
    </div>
  );
}

/** Adds or changes the saved address. It doesn't need Grok: without it only the districts are kept. */
function AddressForm({ onSaved, onCancel }: { onSaved: () => void; onCancel?: () => void }) {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/midterms/local", { method: "PUT", body: { address } });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save your address.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel stack mt-in" onSubmit={submit}>
      <h2>{onCancel ? "Change your address" : "Add your address"}</h2>
      <div className="field">
        <label htmlFor="ny-address">Your home address (where you&apos;re registered to vote)</label>
        <AddressInput id="ny-address" value={address} onChange={setAddress} />
        <span className="hint">
          We use it to find your districts and the races on your ballot. It&apos;s saved to your account, it&apos;s the same address your ballot page uses, and no one else can see it.
        </span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn" type="submit" disabled={busy || address.trim().length < 8}>{busy ? "Finding your districts…" : "Show my races"}</button>
        {onCancel && <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function Section({ part, stars, onStar }: { part: Part; stars: number[] | null; onStar: (id: number) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? part.races : part.races.slice(0, SHOWN);
  return (
    <section id={`ny-${part.key}`} className="ny-section">
      <h2>
        {part.title} <span className="ny-count">{part.races.length}</span>
      </h2>
      {part.note && <p className="muted small">{part.note}</p>}
      {part.races.length ? (
        <ul className="mt-grid">
          {/* Stars are for the tracked races; legislative and local races have none. */}
          {shown.map((r) => <RaceCard key={r.id} race={r} starred={stars && !r.local ? stars.includes(r.id) : null} onStar={onStar} />)}
        </ul>
      ) : (
        <p className="mt-empty small">{part.empty}</p>
      )}
      {part.races.length > SHOWN && (
        <button type="button" className="btn quiet small" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show ${part.races.length - SHOWN} more`}
        </button>
      )}
    </section>
  );
}

function Shell({ children, head }: { children: ReactNode; head?: ReactNode }) {
  return (
    <div className="wrap mt">
      <ModeNav current="/midterms/near-you" />
      <header className="mt-hero">
        <h1>Near you</h1>
        {head}
      </header>
      {children}
    </div>
  );
}

export function NearYouView() {
  const { user, loading } = useAccount();
  // Saving an address bumps `version`, so the next answer is fetched fresh rather than revalidated.
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const live = useLive<LocalAnswer>(user ? `/api/midterms/local${version ? `?v=${version}` : ""}` : null);
  const overview = useLive<Overview>(user ? "/api/midterms" : null);
  const favorites = useStars();

  if (loading) return <Shell><OfficeSkeleton /></Shell>;
  if (!user) return <Shell><Ask title="Follow the races on your ballot" text="Sign in and add your home address to see your governor, Senate, House, legislative, city and school races in one place, live on election night, with a map of your county." href="/signin?next=/midterms/near-you" action="Sign in" /></Shell>;
  if (!live.data) return <Shell>{live.error ? <p className="error">{live.error}</p> : <OfficeSkeleton />}</Shell>;

  const { local, fetchedAt, stale } = live.data;
  const saved = () => {
    setEditing(false);
    setVersion((v) => v + 1);
  };
  if (!local) return <Shell><AddressForm onSaved={saved} /></Shell>;

  const county = local.source === "county";
  const ddhq = local.source === "ddhq";
  const { ticket, measures } = trackedAt(local, overview.data?.races ?? []);
  const parts: Part[] = [
    { key: "ticket", title: "Top of the ticket", races: ticket, empty: overview.data ? "No governor, Senate or House race found for your address." : "Loading…" },
    { key: "legislature", title: "State legislature", races: local.legislature, empty: "No state legislative race found for your districts this year." },
    {
      key: "local",
      title: county || ddhq ? "City and school" : "Local",
      races: local.yours,
      empty: county ? "Santa Clara County lists no city or school race for your address this year." : ddhq ? "Decision Desk HQ lists no city, school or county race for your address this year." : `Local races for your address come from civicAPI by district; the ones in your area are below.`,
    },
    {
      key: "nearby",
      title: county || ddhq ? "Depends on your district" : "In your area",
      races: local.nearby,
      note: county || ddhq
        ? "Each of these is for one council district or trustee area. The Census doesn't say which one your address is in; your sample ballot does."
        : "Races civicAPI lists for your city and county. Some are for a district or ward you may not live in; your sample ballot says which are yours.",
    },
    { key: "measures", title: "Statewide measures", races: measures },
  ];
  // Sections with nothing to show drop out, except the ones whose absence says something.
  const shown = parts.filter((p) => p.races.length || p.key === "ticket" || p.key === "local");
  const counting = shown.some((p) => p.races.some((r) => r.total > 0));

  return (
    <Shell
      head={
        <>
          <span className="mt-kicker">{local.area}</span>
          {!editing && (
            <button type="button" className="btn quiet small" onClick={() => setEditing(true)}>
              Change address
            </button>
          )}
          <span className="mt-updated small">
            <LiveDot at={fetchedAt} stale={stale} idle={!counting} /> {counting ? "" : "No votes counted yet · "}Checked <CheckedAgo at={fetchedAt} />
            {stale && " · source is slow"}
          </span>
        </>
      }
    >
      {live.error && <p className="error small">{live.error} Showing the last results we got.</p>}
      {editing && <AddressForm onSaved={saved} onCancel={() => setEditing(false)} />}
      {local.state && <NearYouMap state={local.state} fips={local.countyFips} raceId={ticket[0]?.id ?? null} />}
      <div className="ny-flow">
        {shown.map((p) => <Section key={p.key} part={p} stars={favorites.ids} onStar={favorites.toggle} />)}
      </div>
      <p className="muted small mt-source">
        Matched from your saved address, which your <Link href="/ballot">ballot page</Link> uses too. Local results from{" "}
        {ddhq ? <a href="https://votes.decisiondeskhq.com">Decision Desk HQ</a> : county ? <a href={SANTA_CLARA_RESULTS}>Santa Clara County</a> : <a href="https://civicapi.org">civicAPI</a>}; the rest from civicAPI{ddhq ? ", with Decision Desk HQ's counts for statewide measures where it has more" : ""}. <Link href="/midterms/credits">Sources and credits</Link>
      </p>
    </Shell>
  );
}
