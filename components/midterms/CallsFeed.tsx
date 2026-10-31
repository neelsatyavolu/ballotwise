"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { holderOf, outcomeOf } from "@/lib/midterms/holders";
import { callKey } from "@/lib/midterms/moments";
import { isDesk } from "@/lib/ddhq/apply";
import { stampTime } from "@/lib/midterms/polls";
import { colorOf, OFFICE_LABEL, partyOf, partyTag, type CallEvent, type Office, type RaceSummary } from "@/lib/midterms/view";
import { CallAlerts } from "./CallAlerts";
import { shortLabel } from "./PollClose";
import { useStored } from "./seen";
import { useDeskData } from "./desk";

const SHOWN = 12;
/** Seats changing party listed before "+N more", so a big night doesn't bury the feed under its chips. */
const GAINS_SHOWN = 4;

/** Call events from each race's current state, for when the overview carries no event log. */
function fromRaces(races: readonly RaceSummary[]): CallEvent[] {
  return races
    .filter((r) => r.call)
    .map((r): CallEvent => {
      const won = r.call!.withdrawn ? null : r.candidates.find((c) => c.winner);
      const kind = r.call!.withdrawn ? "withdrawal" : r.call!.replaced ? "change" : "call";
      return { id: r.call!.id, raceId: r.id, office: r.office, kind, winner: won?.name ?? null, party: won?.party ?? null, previous: r.call!.replaced, at: r.call!.at, ...(isDesk(r) ? { source: "ddhq" as const } : {}) };
    })
    .sort((a, b) => b.at - a.at);
}

/** Hold or gain for the event's own winner against the seat's holder, whatever the race shows now. */
function eventOutcome(r: RaceSummary, e: CallEvent): { side: "D" | "R" | "I"; gain: boolean } | null {
  const holder = holderOf(r);
  if (!e.winner || !e.party || !holder) return null;
  const p = partyOf(e.party);
  const side = p === "other" ? "I" : p;
  return { side, gain: side !== holder };
}

/** The winner's own margin, signed: a race can be called for someone still behind in a partial count. */
function winnerMargin(r: RaceSummary, name: string): number | null {
  const total = r.candidates.reduce((s, c) => s + c.votes, 0);
  const won = r.candidates.find((c) => c.name === name);
  if (!won || !total) return null;
  const best = Math.max(0, ...r.candidates.filter((c) => c !== won).map((c) => c.votes));
  return ((won.votes - best) / total) * 100;
}

/** Every call, changed call and withdrawal, newest first, with seats changing party pinned on top. `children` sit beside the alerts switch: election mode puts its pop-up switch there. */
type CallsFeedProps = { races: readonly RaceSummary[]; events?: CallEvent[]; counts?: Record<Office, number>; office: Office | "all"; children?: React.ReactNode };

export function CallsFeed(props: CallsFeedProps) {
  const { owner } = useDeskData();
  const privateSource = props.races.some(isDesk);
  const sourceKey = privateSource ? `ddhq:${owner}` : "public";
  return <CallList key={sourceKey} {...props} privateSource={privateSource} sourceKey={sourceKey} />;
}

function CallList({ races, events: given, counts, office, children, privateSource, sourceKey }: CallsFeedProps & { privateSource: boolean; sourceKey: string }) {
  const [all, setAll] = useState(false);
  const [allGains, setAllGains] = useState(false);
  const [everyOffice, setEveryOffice] = useState(false);
  const scope = everyOffice ? "all" : office;
  const byId = useMemo(() => new Map(races.map((r) => [r.id, r])), [races]);
  // Older events fetched on request, kept per scope, beyond the latest window the overview carries.
  const [older, setOlder] = useState<{ scope: string; events: CallEvent[] }>({ scope, events: [] });
  // Every event received from live polls this session, so older pages and the moving latest window never leave a gap.
  const live = useMemo(() => given ?? fromRaces(races), [given, races]);
  const [received, setReceived] = useState<{ from: CallEvent[]; all: CallEvent[] }>({ from: live, all: live });
  if (!privateSource && received.from !== live) setReceived({ from: live, all: [...live, ...received.all.filter((e) => !live.some((x) => x.id === e.id))] });
  const [loadError, setLoadError] = useState<string | null>(null);
  const events = useMemo(() => {
    const extra = !privateSource && older.scope === scope ? older.events : [];
    const seenIds = new Set<string>();
    return [...(privateSource ? live : received.all), ...extra]
      .filter((e) => byId.has(e.raceId) && !seenIds.has(callKey(e)) && (seenIds.add(callKey(e)), true))
      .sort((a, b) => privateSource ? b.at - a.at || b.raceId - a.raceId : b.id - a.id);
  }, [privateSource, live, received, byId, older, scope]);
  // An event is superseded only by a newer event in the same race, not by a call that's briefly pending.
  const newestByRace = useMemo(() => {
    const out = new Map<number, number>();
    for (const e of events) out.set(e.raceId, Math.max(out.get(e.raceId) ?? 0, e.id));
    return out;
  }, [events]);
  const shown = events.filter((e) => scope === "all" || e.office === scope);
  // The server's count, but never fewer than what's on screen (the two can be a poll apart).
  const total = Math.max(shown.length, !privateSource && counts ? (scope === "all" ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[scope]) : 0);
  const loadOlder = async () => {
    if (privateSource) return;
    const oldest = shown.at(-1)?.id;
    setLoadError(null);
    try {
      const r = await api<{ events: CallEvent[] }>(`/api/midterms/calls?limit=50${scope === "all" ? "" : `&office=${scope}`}${oldest ? `&before=${oldest}` : ""}`);
      setOlder((prev) => ({ scope, events: [...(prev.scope === scope ? prev.events : []), ...r.events] }));
      setAll(true);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't load older calls.");
    }
  };
  // New means after the last "Mark seen" in this browser (event ids only grow), or after this page first opened.
  // Older events loaded on request are history, never new.
  const order = (e: CallEvent) => privateSource ? e.at : e.id;
  const [opened] = useState(() => Math.max(0, ...events.map(order)));
  const [stored, setStored] = useStored(privateSource ? `mt-calls-seen:${sourceKey}` : "mt-calls-seen");
  const seenThrough = Number(stored) || opened;
  useEffect(() => {
    if (!stored && opened) setStored(String(opened));
  }, [stored, opened, setStored]);
  const isNew = (e: CallEvent) => order(e) > seenThrough;
  const fresh = shown.filter(isNew);
  const gains = races.filter((r) => (scope === "all" || r.office === scope) && outcomeOf(r)?.gain);
  const list = all ? shown : shown.slice(0, SHOWN);

  const spoken = (e: CallEvent) => {
    const r = byId.get(e.raceId)!;
    if (!e.winner) return `${shortLabel(r)}: call for ${e.previous ?? "the leader"} withdrawn`;
    const o = eventOutcome(r, e);
    return `${shortLabel(r)}: ${e.winner}${o ? `, ${o.side} ${o.gain ? "gain" : "hold"}` : ""}`;
  };

  return (
    <section className="mt-el-calls" id="latest-calls" aria-label="Latest calls" data-panel="calls">
      <div className="mt-section-head tight">
        <h2>Latest calls</h2>
        <span className="muted small">{total || "None yet"}</span>
        <CallAlerts events={live} races={races} currentOnly={privateSource} />
        {children}
      </div>
      {(fresh.length > 0 || office !== "all") && (
        <p className="mt-el-calls-meta small muted">
          {fresh.length > 0 && (
            <>
              {fresh.length} new since you looked ·{" "}
              <button type="button" className="mt-el-quiet" onClick={() => setStored(String(Math.max(seenThrough, ...events.map(order))))}>Mark seen</button>
            </>
          )}
          {fresh.length > 0 && office !== "all" && <span aria-hidden> · </span>}
          {office !== "all" && (
            <button type="button" className="mt-el-quiet" aria-pressed={everyOffice} onClick={() => setEveryOffice((v) => !v)}>
              {everyOffice ? `Only ${office === "measure" ? "measures" : OFFICE_LABEL[office]}` : "Show every office"}
            </button>
          )}
        </p>
      )}
      <p className="sr-only" aria-live="polite">{fresh.length ? `New: ${fresh.slice(0, 3).map(spoken).join("; ")}` : ""}</p>
      {gains.length > 0 && (
        <div className="mt-el-gains" aria-label="Seats changing party">
          <span className="small"><b>Changed party</b> <span className="muted">{gains.length}</span></span>
          {(allGains ? gains : gains.slice(0, GAINS_SHOWN)).map((r) => {
            const o = outcomeOf(r)!;
            return (
              <Link key={r.id} href={`/midterms/${r.id}`} className={`mt-flag gain p-${o.side}`}>
                {shortLabel(r)} · {o.side} gain
              </Link>
            );
          })}
          {gains.length > GAINS_SHOWN && (
            <button type="button" className="mt-el-quiet small" onClick={() => setAllGains((v) => !v)}>
              {allGains ? "Fewer" : `+${gains.length - GAINS_SHOWN} more`}
            </button>
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="muted small">{privateSource ? "Current calls land here, newest first, as Decision Desk HQ publishes them." : "Calls land here, newest first, as civicAPI's decision desk makes them after polls close."}</p>
      ) : (
        <ol className="mt-el-calllist">
          {list.map((e) => {
            const r = byId.get(e.raceId)!;
            const current = newestByRace.get(e.raceId) === e.id;
            const prior = e.previous;
            const outcome = eventOutcome(r, e);
            const won = e.winner ? r.candidates.find((c) => c.name === e.winner) : null;
            // The margin comes from the race's current count, so only when that count still shows this winner.
            const margin = current && won?.winner ? winnerMargin(r, e.winner!) : null;
            return (
              <li key={callKey(e)} className={`${isNew(e) ? "new" : ""}${current ? "" : " old"}`}>
                <time className="muted" dateTime={new Date(e.at).toISOString()}>{stampTime(e.at)}</time>
                <span className="mt-el-call-main">
                  <Link href={`/midterms/${r.id}`}>{shortLabel(r)}</Link>
                  {scope === "all" && <span className="muted small"> {r.office === "measure" ? "measure" : OFFICE_LABEL[r.office].toLowerCase()}</span>}
                  {e.winner ? (
                    <span className="mt-el-call-who">
                      <span className="swatch" style={{ background: won ? colorOf(won) : "var(--rule-strong)" }} aria-hidden /> {e.winner}
                      {e.party && partyTag(e.party) && <span className="muted"> ({partyTag(e.party)})</span>}
                      {margin !== null && <span className="muted"> · {margin >= 0 ? "+" : "−"}{Math.abs(margin).toFixed(1)}{r.reportingUnknown ? "" : `, ${Math.round(r.reporting)}% reporting`}</span>}
                    </span>
                  ) : (
                    <span className="mt-el-call-who warn">Call for {prior ?? "the leader"} withdrawn</span>
                  )}
                  {e.winner && prior && prior !== e.winner && <span className="mt-flag warn">Changed from {prior}</span>}
                  {!current && <span className="muted small"> · since superseded</span>}
                </span>
                {outcome && (outcome.gain ? <span className={`mt-flag gain p-${outcome.side}`}>{outcome.side} gain</span> : <span className="mt-el-hold small muted">{outcome.side} hold</span>)}
              </li>
            );
          })}
        </ol>
      )}
      {shown.length > SHOWN && (
        <button type="button" className="btn quiet small" onClick={() => setAll((v) => !v)}>
          {all ? "Show the latest only" : `Show all ${shown.length} loaded`}
        </button>
      )}
      {!privateSource && shown.length < total && (all || shown.length <= SHOWN) && (
        <button type="button" className="btn quiet small" onClick={() => void loadOlder()}>
          Load older calls ({total - shown.length} more)
        </button>
      )}
      {loadError && <p className="error small">{loadError}</p>}
      <details className="mt-el-about small muted">
        <summary>About these calls</summary>
        {privateSource ? "Senate, House and governor calls use your Decision Desk HQ session and its published call times. Withdrawn calls leave this current-call list. Ballot measures and failed DDHQ requests use civicAPI. " : "Calls come from civicAPI's decision desk, not AP or Decision Desk HQ. Times are when Ballotwise first saw each call. "}Hold and gain compare with the party holding the seat now; House seats are matched by district number, so redrawn districts compare with their current member.
      </details>
    </section>
  );
}
