"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { DEFAULT_FILTERS, explore, flipTo, isWatch, raceFill } from "@/lib/midterms/explore";
import { holderOf } from "@/lib/midterms/holders";
import { colorOf, compareRaces, OFFICE_LABEL, pct, raceLabel, STATE_NAMES, timeAgo, type Office, type Overview, type RaceSummary } from "@/lib/midterms/view";
import { AiDashboards } from "./AiDashboard";
import { BalanceBar } from "./Balance";
import { ChatDock, type ChatHandle } from "./ChatDock";
import { ElectionMode, ElectionToggle, useElectionMode } from "./ElectionMode";
import { useClock, useDashboards, useLive, useStars } from "./hooks";
import { ForecastTip, WatchNote } from "./ForecastTip";
import { electionModeDefault } from "@/lib/midterms/polls";
import { NationMap, type NationFill } from "./maps";
import { ModeNav } from "./ModeNav";
import { RaceCard } from "./RaceCard";
import { RaceSearch } from "./RaceSearch";
import { RaceRows, type Star } from "./RaceRows";
import { useSimulation } from "./useSimulation";
import { CheckedAgo, LiveDot } from "./CheckedAgo";
import { SinceBanner } from "./SinceBanner";
import { reportingText } from "./reporting";
import { OverviewSkeleton } from "./Skeleton";
import { replayTour, Tour } from "./Tour";

type Tab = "key" | "mine" | "ai" | "all";
const TABS: { id: Tab; label: string }[] = [
  { id: "key", label: "Key races" },
  { id: "mine", label: "My races" },
  { id: "ai", label: "My dashboards" },
  { id: "all", label: "All races" },
];
const OFFICES: Office[] = ["senate", "governor", "house", "measure"];
const PAGE = 60;
/** Cards per office in the overview's key races before "Show more". */
const SECTION = 10;

/** One office's key races as cards, the first ten with the rest a tap away. */
function Section({ title, races, star }: { title: string; races: RaceSummary[]; star: Star }) {
  const [all, setAll] = useState(false);
  if (!races.length) return null;
  return (
    <section className="mt-group">
      <h2>{title}</h2>
      <Grid races={all ? races : races.slice(0, SECTION)} star={star} />
      {races.length > SECTION && (
        <button type="button" className="btn quiet small" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show ${races.length - SECTION} more`}
        </button>
      )}
    </section>
  );
}

function Grid({ races, star }: { races: RaceSummary[]; star: Star }) {
  return (
    <ul className="mt-grid">
      {races.map((r) => (
        <RaceCard key={r.id} race={r} starred={star.ids ? star.ids.includes(r.id) : null} onStar={star.toggle} />
      ))}
    </ul>
  );
}

/** What kind of flip a race shows: a called gain, a lead in an uncalled count, or only the pre-election favorite. */
function flipLabel(r: RaceSummary, holder: string, to: string): string {
  if (r.candidates.some((c) => c.winner)) return `Called gain, ${holder} → ${to}`;
  if (r.total > 0) return `Leading in a potential flip, ${holder} → ${to}`;
  return `Pre-election favorite would flip it, ${holder} → ${to}`;
}

function mapTip(r: RaceSummary) {
  const flip = flipTo(r);
  const holder = holderOf(r);
  return (
    <>
      <b>{raceLabel(r)}</b>
      {r.candidates.slice(0, 2).map((c) => (
        <div key={c.name}>
          <span className="swatch" style={{ background: colorOf(c) }} /> {c.name} {r.total ? pct(c.pct) : ""}
        </div>
      ))}
      {flip && holder && <div>{flipLabel(r, holder, flip)}</div>}
      <span className="muted">{reportingText(r).long}</span>
      <WatchNote race={r} />
    </>
  );
}

const MAP_OFFICES = ["senate", "governor", "house"] as const;
const MAP_TITLE = { senate: "Senate map", governor: "Governor map", house: "House map" } as const;

/** Where a race sits on the overview map: its state, or "PA-7" for a House district. */
const mapKey = (r: RaceSummary) => (r.office === "house" ? `${r.state}-${r.district ?? 0}` : r.state);

/** Senate, governor or House races on a US map, each state or district shaded by who leads, striped where it would change party. */
function RaceMap({ races, updatedAt }: { races: RaceSummary[]; updatedAt: number | null }) {
  const router = useRouter();
  const [office, setOffice] = useState<(typeof MAP_OFFICES)[number]>("senate");
  // From election day on, the map drops the forecast and fills in only as results arrive.
  const results = electionModeDefault(useClock(60_000));
  const fills = useMemo(() => {
    const out = new Map<string, NationFill>();
    // Ohio and Florida hold Senate specials; a state's regular race, if any, sets its color.
    for (const r of races.filter((x) => x.office === office).sort((a, b) => Number(/special/i.test(a.title)) - Number(/special/i.test(b.title)))) {
      if (out.has(mapKey(r))) continue;
      out.set(mapKey(r), { fill: raceFill(r, results), tip: r.total ? mapTip(r) : <ForecastTip race={r} updatedAt={updatedAt} />, flip: !!flipTo(r) && (!results || r.total > 0), watch: results && isWatch(r) });
    }
    return out;
  }, [races, office, results, updatedAt]);
  const idByKey = useMemo(() => new Map(races.filter((r) => r.office === office).map((r) => [mapKey(r), r.id])), [races, office]);

  return (
    <section className="mt-nation" data-tour="map">
      <div className="mt-section-head tight">
        <h2>{MAP_TITLE[office]}</h2>
        <div className="mt-seg" role="group" aria-label="Map shows">
          {MAP_OFFICES.map((o) => (
            <button key={o} type="button" aria-pressed={office === o} onClick={() => setOffice(o)}>
              {OFFICE_LABEL[o]}
            </button>
          ))}
        </div>
      </div>
      <NationMap fills={fills} districts={office === "house"} label={`Map of 2026 ${office} races`} onPick={(key) => idByKey.has(key) && router.push(`/midterms/${idByKey.get(key)}`)} />
      {results ? (
        <p className="muted small mt-legend">
          <span><i style={{ background: "var(--rate-safe-d)" }} /> Dem won</span>
          <span><i style={{ background: "var(--rate-safe-r)" }} /> Rep won</span>
          <span><i style={{ background: "var(--rule-strong)" }} /> No votes yet</span>
          <span><i className="flip" /> Called gain or leading in a potential flip</span>
          <span>Called races in full color; uncalled ones by who leads, darker = wider lead, early counts palest.</span>
        </p>
      ) : (
        <p className="muted small mt-legend">
          <span><i style={{ background: "var(--dem)" }} /> Dem</span>
          <span><i style={{ background: "var(--rep)" }} /> Rep</span>
          <span><i style={{ background: "var(--tossup)" }} /> Toss-up</span>
          <span><i style={{ background: "var(--rule-strong)" }} /> No market or polls</span>
          <span><i className="flip" /> Pre-election favorite would change party</span>
          <span>Market or poll rating: paler = less certain, full color = safe.</span>
        </p>
      )}
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
    <div className="stack mt-in">
      <section className="mt-other" aria-labelledby="other-races">
        <h2 id="other-races">Other races</h2>
        <p className="muted small">Mayors, county seats, school boards, judges and local questions: anything civicAPI covers, with the same live results.</p>
        <RaceSearch />
      </section>
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
  const live = useLive<Overview>("/api/midterms");
  const { error, now } = live;
  const data = useSimulation(live.data);
  const favorites = useStars();
  const dashboards = useDashboards();
  const [tab, setTab] = useState<Tab>(initialState ? "all" : "key");
  const [chatOpen, setChatOpen] = useState(false);
  const election = useElectionMode();
  const chat = useRef<ChatHandle>(null);
  const star: Star = { ids: favorites.ids, toggle: favorites.toggle };

  const races = data?.races;
  const counting = !!races?.some((r) => r.total > 0);
  // Once votes are in, uncalled races come first, closest first, and called ones last: the explorer's "closest first".
  const key = useMemo(() => {
    const rated = (races ?? []).filter((r) => r.rating);
    return counting ? explore(rated, { ...DEFAULT_FILTERS, office: "all" }, null) : rated.sort(compareRaces);
  }, [races, counting]);
  const mine = useMemo(() => {
    const byId = new Map((races ?? []).map((r) => [r.id, r]));
    return (favorites.ids ?? []).map((id) => byId.get(id)).filter((r): r is RaceSummary => !!r);
  }, [races, favorites.ids]);
  const tossups = key.filter((r) => r.rating === "tossup").map((r) => r.id);
  const openDashboard = dashboards.list?.find((d) => d.id === dashboards.openId) ?? dashboards.list?.[0] ?? null;

  const ask = (text: string, fresh: boolean) => chat.current?.ask(text, fresh);

  return (
    <div className={`wrap mt${election.on ? " mt-el-on" : ""}`}>
      <ModeNav current="/midterms" />
      <header className="mt-hero">
        <h1>Midterms 2026</h1>
        <span className="mt-kicker">{counting ? `Live results, checked every ${Math.round(live.interval / 1000)} seconds` : "Tuesday, Nov 3 · first polls close at 6:00 PM ET"}</span>
        {data && (
          <span className="mt-updated small">
            <LiveDot at={data.fetchedAt} stale={data.stale} idle={!counting} /> {counting ? "" : "No votes counted yet · "}Checked <CheckedAgo at={data.fetchedAt} />
            {data.stale && " · source is slow"}
          </span>
        )}
        {election.on && (
          <button type="button" className="btn secondary small mt-ask" onClick={() => setChatOpen(true)}>
            <span aria-hidden>✦</span> Ask Grok
          </button>
        )}
        <ElectionToggle on={election.on} onChange={election.set} />
      </header>
      {error && <p className="error">{data ? `${error} Showing the last results we got.` : error}</p>}
      {!data && !error && <OverviewSkeleton />}

      {data && races && (
        <SinceBanner races={races}>
      {election.on && <ElectionMode data={data} stars={favorites} />}
      {!election.on && (
        <>
          <div className="mt-balances mt-in" data-tour="balance">
            <BalanceBar title="Senate" office="senate" tally={data.balance.senate} />
            <BalanceBar title="House" office="house" tally={data.balance.house} />
            <BalanceBar title="Governors" office="governor" tally={data.balance.governor} />
          </div>

          <div className="tabs" role="tablist" data-tour="tabs">
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
            <div className="stack mt-in">
              <div className="mt-overview">
                <RaceMap races={races} updatedAt={data.ratings.updatedAt} />
                <section className="mt-closest" data-tour="races">
                  <div className="mt-section-head tight">
                    <h2>Key races</h2>
                    {favorites.ids && key.length > 0 && (
                      <button type="button" className="btn quiet" onClick={() => favorites.addMany(key.map((r) => r.id))}>
                        Star all {key.length}
                      </button>
                    )}
                  </div>
                  {key.length ? <RaceRows races={key} star={star} /> : <p className="mt-empty small">No race has a market or polling rating yet. Key races fill in as the ratings arrive.</p>}
                  <p className="muted small">
                    Ratings come live from <a href="https://kalshi.com">Kalshi</a> and <a href="https://polymarket.com">Polymarket</a> prices, or the <a href="https://votehub.com/polls">VoteHub</a> polling average where no market trades
                    {data.ratings.updatedAt ? `, updated ${timeAgo(data.ratings.updatedAt, now)}` : ""}.
                  </p>
                </section>
              </div>
              {(["senate", "governor", "house"] as const).map((o) => (
                <Section key={o} title={OFFICE_LABEL[o]} races={key.filter((r) => r.office === o)} star={star} />
              ))}
            </div>
          )}

          {tab === "mine" && (
            <div className="stack mt-in">
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
              {favorites.guest && (
                <p className="muted small">
                  Your stars are saved in this browser. <Link href="/signin?next=/midterms">Sign in</Link> to keep them on every device; they&apos;ll move into your account.
                </p>
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
            <Link href="/midterms/credits">Sources and credits</Link>
            <button type="button" className="mt-tour-replay" onClick={replayTour}>Take the tour</button>
          </p>
        </>
      )}
        </SinceBanner>
      )}

      {/* Outside the fading sections, so its fixed layers aren't placed against one mid-animation. */}
      {data && !election.on && <Tour />}

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
