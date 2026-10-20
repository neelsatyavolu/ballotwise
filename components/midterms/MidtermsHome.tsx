"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { colorOf, compareRaces, lead, OFFICE_LABEL, pct, raceLabel, ratingFill, shade, STATE_NAMES, timeAgo, type Office, type Overview, type RaceSummary } from "@/lib/midterms/view";
import { AiDashboards } from "./AiDashboard";
import { BalanceBar } from "./Balance";
import { ChatDock, type ChatHandle } from "./ChatDock";
import { useDashboards, useFavorites, useLive } from "./hooks";
import { NationMap } from "./maps";
import { ModeNav } from "./ModeNav";
import { RaceCard } from "./RaceCard";
import { RaceRows, type Star } from "./RaceRows";

type Tab = "key" | "mine" | "ai" | "all";
const TABS: { id: Tab; label: string }[] = [
  { id: "key", label: "Key races" },
  { id: "mine", label: "My races" },
  { id: "ai", label: "My dashboards" },
  { id: "all", label: "All races" },
];
const OFFICES: Office[] = ["senate", "governor", "house", "measure"];
const PAGE = 60;

function Grid({ races, star }: { races: RaceSummary[]; star: Star }) {
  return (
    <ul className="mt-grid">
      {races.map((r) => (
        <RaceCard key={r.id} race={r} starred={star.ids ? star.ids.includes(r.id) : null} onStar={star.toggle} />
      ))}
    </ul>
  );
}

function mapTip(r: RaceSummary) {
  return (
    <>
      <b>{raceLabel(r)}</b>
      {r.candidates.slice(0, 2).map((c) => (
        <div key={c.name}>
          <span className="swatch" style={{ background: colorOf(c) }} /> {c.name} {r.total ? pct(c.pct) : ""}
        </div>
      ))}
      <span className="muted">{r.reporting ? `${Math.round(r.reporting)}% reporting` : "No results yet"}</span>
    </>
  );
}

/** Senate or governor races on a US map, each state shaded by who leads. */
function RaceMap({ races }: { races: RaceSummary[] }) {
  const router = useRouter();
  const [office, setOffice] = useState<"senate" | "governor">("senate");
  const fills = useMemo(() => {
    const out = new Map<string, { fill: string; tip: React.ReactNode }>();
    // Ohio and Florida hold Senate specials; a state's regular race, if any, sets its color.
    for (const r of races.filter((x) => x.office === office).sort((a, b) => Number(/special/i.test(a.title)) - Number(/special/i.test(b.title)))) {
      if (out.has(r.state)) continue;
      const ahead = lead(r.candidates);
      out.set(r.state, { fill: ahead ? shade(colorOf(ahead.leader), ahead.margin) : ratingFill(r.rating), tip: mapTip(r) });
    }
    return out;
  }, [races, office]);
  const idByState = useMemo(() => new Map(races.filter((r) => r.office === office).map((r) => [r.state, r.id])), [races, office]);

  return (
    <section className="mt-nation">
      <div className="mt-section-head tight">
        <h2>{office === "senate" ? "Senate map" : "Governor map"}</h2>
        <div className="mt-seg" role="group" aria-label="Map shows">
          {(["senate", "governor"] as const).map((o) => (
            <button key={o} type="button" aria-pressed={office === o} onClick={() => setOffice(o)}>
              {OFFICE_LABEL[o]}
            </button>
          ))}
        </div>
      </div>
      <NationMap fills={fills} label={`Map of 2026 ${office} races`} onPick={(state) => idByState.has(state) && router.push(`/midterms/${idByState.get(state)}`)} />
      <p className="muted small mt-legend">
        <span><i style={{ background: "var(--dem)" }} /> Dem</span>
        <span><i style={{ background: "var(--rep)" }} /> Rep</span>
        <span><i style={{ background: "var(--tossup)" }} /> Toss-up</span>
        <span><i style={{ background: "var(--rule-strong)" }} /> Not competitive</span>
        <span>Before votes: market/poll rating, paler = less certain. After: who leads, darker = wider lead.</span>
      </p>
    </section>
  );
}

function AllRaces({ races, star, initialState }: { races: RaceSummary[]; star: Star; initialState: string | null }) {
  const [office, setOffice] = useState<Office | "any">("any");
  const [state, setState] = useState(initialState ?? "");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const states = useMemo(() => [...new Set(races.map((r) => r.state))].sort((a, b) => (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b)), [races]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return races
      .filter((r) => (office === "any" || r.office === office) && (!state || r.state === state))
      .filter((r) => !q || `${r.title} ${raceLabel(r)} ${r.candidates.map((c) => c.name).join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => OFFICES.indexOf(a.office) - OFFICES.indexOf(b.office) || compareRaces(a, b));
  }, [races, office, state, query]);
  const reset = () => setShown(PAGE);

  return (
    <div className="stack">
      <div className="mt-filters">
        <div className="mt-seg" role="group" aria-label="Office">
          {(["any", ...OFFICES] as const).map((o) => (
            <button key={o} type="button" aria-pressed={office === o} onClick={() => { setOffice(o); reset(); }}>
              {o === "any" ? "All" : OFFICE_LABEL[o]}
            </button>
          ))}
        </div>
        <select className="input mt-select" value={state} onChange={(e) => { setState(e.target.value); reset(); }} aria-label="State">
          <option value="">Every state</option>
          {states.map((s) => (
            <option key={s} value={s}>{STATE_NAMES[s] ?? s}</option>
          ))}
        </select>
        <input className="input mt-search" type="search" placeholder="Search races or candidates" value={query} onChange={(e) => { setQuery(e.target.value); reset(); }} aria-label="Search races or candidates" />
        <span className="muted small">{list.length} races</span>
      </div>
      <Grid races={list.slice(0, shown)} star={star} />
      {list.length > shown && (
        <button type="button" className="btn secondary" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, list.length - shown)} more
        </button>
      )}
    </div>
  );
}

export function MidtermsHome({ initialState }: { initialState: string | null }) {
  const { data, error, now } = useLive<Overview>("/api/midterms");
  const favorites = useFavorites();
  const dashboards = useDashboards();
  const [tab, setTab] = useState<Tab>(initialState ? "all" : "key");
  const [chatOpen, setChatOpen] = useState(false);
  const chat = useRef<ChatHandle>(null);
  const star: Star = { ids: favorites.ids, toggle: favorites.toggle };

  const races = data?.races;
  const key = useMemo(() => (races ?? []).filter((r) => r.rating).sort(compareRaces), [races]);
  const mine = useMemo(() => {
    const byId = new Map((races ?? []).map((r) => [r.id, r]));
    return (favorites.ids ?? []).map((id) => byId.get(id)).filter((r): r is RaceSummary => !!r);
  }, [races, favorites.ids]);
  const tossups = key.filter((r) => r.rating === "tossup").map((r) => r.id);
  const openDashboard = dashboards.list?.find((d) => d.id === dashboards.openId) ?? dashboards.list?.[0] ?? null;

  const ask = (text: string, fresh: boolean) => chat.current?.ask(text, fresh);

  return (
    <div className="wrap mt">
      <ModeNav current="/midterms" />
      <header className="mt-hero">
        <h1>Midterms 2026</h1>
        <span className="mt-kicker">Tuesday, Nov 3 · live results, every 30 seconds</span>
        {data && (
          <span className="mt-updated small">
            <span className={`mt-dot${data.stale ? " stale" : ""}`} aria-hidden /> Checked {timeAgo(data.fetchedAt, now)}
            {data.stale && " · source is slow"}
          </span>
        )}
      </header>
      {error && <p className="error">{data ? `${error} Showing the last results we got.` : error}</p>}
      {!data && !error && <p className="muted">Loading every race…</p>}

      {data && races && (
        <>
          <div className="mt-balances">
            <BalanceBar title="Senate" office="senate" tally={data.balance.senate} />
            <BalanceBar title="House" office="house" tally={data.balance.house} />
            <BalanceBar title="Governors" office="governor" tally={data.balance.governor} />
          </div>

          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" type="button" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
                {t.id === "key" && <span className="tab-count">{key.length}</span>}
                {t.id === "mine" && favorites.ids && <span className="tab-count">{mine.length}</span>}
                {t.id === "ai" && dashboards.list && <span className="tab-count">{dashboards.list.length}</span>}
                {t.id === "all" && <span className="tab-count">{races.length}</span>}
              </button>
            ))}
          </div>
          {favorites.error && <p className="error small">{favorites.error}</p>}

          {tab === "key" && (
            <div className="stack">
              <div className="mt-overview">
                <RaceMap races={races} />
                <section className="mt-closest">
                  <div className="mt-section-head tight">
                    <h2>Key races</h2>
                    {favorites.ids && (
                      <button type="button" className="btn quiet" onClick={() => favorites.addMany(key.map((r) => r.id))}>
                        Star all {key.length}
                      </button>
                    )}
                  </div>
                  <RaceRows races={key} star={star} />
                  <p className="muted small">
                    Ratings come live from <a href="https://kalshi.com">Kalshi</a> and <a href="https://polymarket.com">Polymarket</a> prices, or the <a href="https://votehub.com/polls">VoteHub</a> polling average where no market trades
                    {data.ratings.updatedAt ? `, updated ${timeAgo(data.ratings.updatedAt, now)}` : ""}.
                  </p>
                </section>
              </div>
              {(["senate", "governor", "house"] as const).map((o) => (
                <section key={o} className="mt-group">
                  <h2>{OFFICE_LABEL[o]}</h2>
                  <Grid races={key.filter((r) => r.office === o)} star={star} />
                </section>
              ))}
            </div>
          )}

          {tab === "mine" && (
            <div className="stack">
              {favorites.loading ? null : favorites.ids === null ? (
                <div className="panel stack">
                  <h2>Star races to follow them here</h2>
                  <p>Sign in to keep a list of the races you care about, on any device.</p>
                  <p>
                    <Link href="/signin?next=/midterms" className="btn">Sign in</Link>
                  </p>
                </div>
              ) : mine.length === 0 ? (
                <div className="panel stack">
                  <h2>No starred races yet</h2>
                  <p>Tap the star on any race, or start with the {tossups.length} toss-ups.</p>
                  <p>
                    <button type="button" className="btn" onClick={() => favorites.addMany(tossups)}>Star the toss-ups</button>
                  </p>
                </div>
              ) : (
                <Grid races={mine} star={star} />
              )}
            </div>
          )}

          {tab === "ai" && (
            <AiDashboards
              races={races}
              dashboards={dashboards.list}
              openId={openDashboard?.id ?? null}
              onOpen={dashboards.setOpenId}
              onRename={dashboards.rename}
              onDelete={dashboards.remove}
              onAsk={ask}
              error={dashboards.error}
              favorites={favorites.ids}
              onStar={favorites.toggle}
              onStarMany={favorites.addMany}
            />
          )}
          {tab === "all" && <AllRaces races={races} star={star} initialState={initialState} />}

          <p className="muted small mt-source">
            Live results from <a href="https://civicapi.org">civicAPI</a>, which collects them from state and county election offices. Winners are marked only when civicAPI&apos;s decision desk calls a race. 2024 county results from{" "}
            <a href="https://github.com/tonmcg/US_County_Level_Election_Results_08-24">tonmcg/US_County_Level_Election_Results</a>.
          </p>
        </>
      )}

      <ChatDock
        ref={chat}
        open={chatOpen}
        onOpenChange={setChatOpen}
        openDashboard={openDashboard}
        onChanged={(list, focusId) => {
          dashboards.applyChat(list, focusId);
          setTab("ai");
        }}
      />
    </div>
  );
}
