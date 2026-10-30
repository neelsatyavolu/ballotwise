"use client";

// The overview's "Near you" tab: live results for the races on the ballot at the address saved on the voter's ballot page.
import Link from "next/link";
import type { ReactNode } from "react";
import { useAccount } from "@/components/AccountProvider";
import type { LocalAnswer } from "@/lib/midterms/local";
import { SANTA_CLARA_RESULTS, type Office, type RaceSummary } from "@/lib/midterms/view";
import { CheckedAgo, LiveDot } from "./CheckedAgo";
import { useLive } from "./hooks";
import { RaceRows, type Star } from "./RaceRows";

// Stars are for the tracked races only, so legislative and local rows have none.
const NO_STARS: Star = { ids: null, toggle: () => {} };
/** Top of the ticket first, as on a ballot. */
const TICKET: Office[] = ["governor", "senate", "house"];

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

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-group">
      <h3>{title}</h3>
      {note && <p className="muted small">{note}</p>}
      {children}
    </section>
  );
}

/** `races` are the overview's tracked races, which carry ratings, calls and stars; the tab picks out this address's. */
export function NearYou({ races, star }: { races: readonly RaceSummary[]; star: Star }) {
  const { user, loading } = useAccount();
  const live = useLive<LocalAnswer>(user ? "/api/midterms/local" : null);
  if (loading) return null;
  if (!user) return <Ask title="Follow the races on your ballot" text="Sign in and add your home address to see your governor, Senate, House, legislative, city and school races here, live on election night." href="/signin?next=/midterms" action="Sign in" />;
  if (!live.data) return live.error ? <p className="error">{live.error}</p> : null;

  const { local, fetchedAt, stale } = live.data;
  if (!local) return <Ask title="Add your address" text="Your governor, Senate, House, legislative, city and school races show here once your account has your home address. It stays private to you." href="/ballot" action="Add your address" />;
  const county = local.source === "county";
  const mine = races.filter((r) => r.state === local.state && (r.office !== "house" || r.district === local.house));
  const ticket = mine.filter((r) => r.office !== "measure").sort((a, b) => TICKET.indexOf(a.office) - TICKET.indexOf(b.office));
  const measures = mine.filter((r) => r.office === "measure");
  const counting = [...mine, ...local.legislature, ...local.yours, ...local.nearby].some((r) => r.total > 0);

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
      {ticket.length > 0 && (
        <Group title="Governor, Senate and House">
          <RaceRows races={ticket} star={star} />
        </Group>
      )}
      {local.legislature.length > 0 && (
        <Group title="State legislature">
          <RaceRows races={local.legislature} star={NO_STARS} rated={false} />
        </Group>
      )}
      <Group title={county ? "City and school" : "Local"}>
        {local.yours.length > 0 && <RaceRows races={local.yours} star={NO_STARS} rated={false} />}
        {!local.yours.length && !local.nearby.length && (
          <p className="mt-empty small">
            {county ? "Santa Clara County lists no city or school race for your address this year." : `civicAPI doesn't list any Nov 3 local races for ${local.area} yet. Local results fill in as counties load their feeds.`}
          </p>
        )}
      </Group>
      {local.nearby.length > 0 && (
        <Group
          title={county ? "Depends on your district" : "In your area"}
          note={
            county
              ? "Each of these is for one council district or trustee area. The Census doesn't say which one your address is in; your sample ballot does."
              : "Races civicAPI lists for your city and county. Some are for a district or ward you may not live in; your sample ballot says which are yours."
          }
        >
          <RaceRows races={local.nearby} star={NO_STARS} rated={false} />
        </Group>
      )}
      {measures.length > 0 && (
        <Group title="Statewide ballot measures">
          <RaceRows races={measures} star={star} rated={false} />
        </Group>
      )}
      <p className="muted small">
        Matched from the address on your <Link href="/ballot">ballot page</Link>, where you can change it. Local results from{" "}
        {county ? <a href={SANTA_CLARA_RESULTS}>Santa Clara County</a> : <a href="https://civicapi.org">civicAPI</a>}; the rest from civicAPI.
      </p>
    </div>
  );
}
