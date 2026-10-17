"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "@/components/AccountProvider";
import { GrokConnect } from "@/components/GrokConnect";
import { api, ApiError, shuffled, streamResearch } from "@/lib/client";
import type { Progress } from "@/lib/grok/research";
import type { GuideData, GuideRecord, GuideStatus } from "@/lib/guides";
import { effectiveAnswers, headlineMatch, interviewMatchPhase, joinNames, type Answer, type Answers, type Overrides } from "@/lib/match";
import type { Suggested } from "@/lib/values";
import { isMeasure, profileStances, seatsOf, type Profile, type Race, type RaceResult } from "@/lib/schema";
import { Sources } from "./bits";
import { Compare } from "./Compare";
import { Interview } from "./Interview";
import { Profiles } from "./Profiles";
import { Results } from "./Results";

type Task = { label: string; state: "running" | "done" | "failed"; detail: string };
type Phase =
  | { kind: "loading" }
  | { kind: "researching" }
  | { kind: "queued"; title: string; status: GuideStatus; error: string | null }
  | { kind: "choose"; options: Extract<RaceResult, { kind: "choose" }>["options"] }
  | { kind: "none"; reason: string }
  | { kind: "error"; message: string; needsGrok: boolean }
  | { kind: "ready" };
type Tab = "compare" | "profiles" | "match";

const CONCURRENCY = 4;
const POLL_MS = 6000;

function progressText(p: Progress): string {
  return p.type === "search" ? `Searching: ${p.query}` : "Writing up what it found";
}

export function GuideView({ id, query }: { id: string; query: string | null }) {
  const router = useRouter();
  const { user, loading: accountLoading, grok, values } = useAccount();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [race, setRace] = useState<Race | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [answers, setAnswers] = useState<Answers>({});
  const [overrides, setOverrides] = useState<Overrides>({});
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const [tab, setTab] = useState<Tab>("compare");
  const [interviewDone, setInterviewDone] = useState(false);
  const [editing, setEditing] = useState(false);
  /** While checking guesses, the editor shows only these issues. */
  const [checking, setChecking] = useState<string[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [searched, setSearched] = useState(query ?? "");
  const [origin, setOrigin] = useState<"search" | "ballot">("search");
  const [background, setBackground] = useState<{ status: GuideStatus; failed: Record<string, string> } | null>(null);
  const [voted, setVotedState] = useState(false);
  const [suggested, setSuggested] = useState<Suggested | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchAttempt, setMatchAttempt] = useState(0);
  const [waitedMs, setWaitedMs] = useState(0);
  const started = useRef(false);

  const setTask = (key: string, task: Partial<Task>) =>
    setTasks((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { label: key, state: "running", detail: "" }), ...task } }));

  // Shuffled once per visit, like ballots that rotate candidate order.
  // Measures keep Yes before No, as on the ballot.
  const order = useMemo(() => (race ? (isMeasure(race) ? race.candidates : shuffled(race.candidates)) : []), [race]);

  const researchCandidate = useCallback(async (r: Race, candidateId: string) => {
    const name = r.candidates.find((c) => c.id === candidateId)?.name ?? candidateId;
    setTask(candidateId, { label: name, state: "running", detail: "Starting research" });
    try {
      const profile = await streamResearch<Profile>("/api/candidate", { race: r, candidateId }, (p) => setTask(candidateId, { detail: progressText(p) }));
      setProfiles((prev) => ({ ...prev, [candidateId]: profile }));
      setTask(candidateId, { state: "done", detail: "Done" });
    } catch (err) {
      setTask(candidateId, { state: "failed", detail: err instanceof ApiError ? err.message : "Research failed." });
    }
  }, []);

  const researchAll = useCallback(
    async (r: Race) => {
      const queue = [...r.candidates.map((c) => c.id)];
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) await researchCandidate(r, next);
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    },
    [researchCandidate],
  );

  const lookUp = useCallback(
    async (q: string) => {
      setSearched(q);
      setPhase({ kind: "researching" });
      setTasks({});
      setTask("race", { label: "Finding the race and who's running", state: "running", detail: `Looking up “${q}”` });
      try {
        const result = await streamResearch<RaceResult>("/api/race", { query: q }, (p) => setTask("race", { detail: progressText(p) }));
        if (result.kind === "choose") return setPhase({ kind: "choose", options: result.options });
        if (result.kind === "none") return setPhase({ kind: "none", reason: result.reason });
        setTask("race", { state: "done", detail: `${result.race.candidates.length} candidates, ${result.race.issues.length} issues` });
        setRace(result.race);
        setPhase({ kind: "ready" });
        await researchAll(result.race);
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        setPhase({ kind: "error", message: err instanceof Error ? err.message : "Lookup failed.", needsGrok: status === 401 });
      }
    },
    [researchAll],
  );

  /** Applies a saved guide. On a refresh only background research is merged, so answers in progress stay. */
  const apply = useCallback((rec: GuideRecord, first: boolean) => {
    setOrigin(rec.origin);
    setVotedState(rec.voted);
    setSuggested(rec.suggested);
    setMatchError(rec.status === "ready" && rec.error ? rec.error : null);
    setBackground(rec.origin === "ballot" ? { status: rec.status, failed: rec.failedCandidates } : null);
    if (!rec.data) {
      setPhase({ kind: "queued", title: rec.title, status: rec.status, error: rec.error });
      return;
    }
    const data = rec.data;
    if (first) {
      setSearched(data.query);
      setRace(data.race);
      setProfiles(data.profiles);
      setAnswers(data.answers);
      setOverrides(data.overrides);
      setInterviewDone(Object.keys(data.answers).length > 0);
      if (rec.origin === "search") {
        for (const c of data.race.candidates.filter((c) => !data.profiles[c.id])) {
          setTask(c.id, { label: c.name, state: "failed", detail: "This didn't finish last time." });
        }
      }
    } else {
      setRace((prev) => prev ?? data.race);
      setProfiles((prev) => ({ ...data.profiles, ...prev }));
    }
    setPhase({ kind: "ready" });
  }, []);

  // Open a saved guide, or start researching a new one.
  useEffect(() => {
    if (accountLoading || started.current) return;
    if (!user) {
      router.replace(`/signin?next=${encodeURIComponent(`/guide/${id}${query ? `?q=${encodeURIComponent(query)}` : ""}`)}`);
      return;
    }
    started.current = true;
    api<GuideRecord>(`/api/guides/${id}`)
      .then((rec) => apply(rec, true))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404 && query) void lookUp(query);
        else setPhase({ kind: "error", message: err instanceof Error ? err.message : "Couldn't open this guide.", needsGrok: false });
      });
  }, [accountLoading, user, id, query, router, lookUp, apply]);

  // Ballot guides research on the server; check back until they finish.
  const researchDone = race !== null && race.candidates.every((c) => profiles[c.id] || background?.failed[c.id]);
  const awaitingMatch = values === "done" && suggested === null && researchDone && !matchError;
  const pending = (origin === "ballot" && background !== null && (background.status === "queued" || background.status === "researching")) || awaitingMatch;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      api<GuideRecord>(`/api/guides/${id}`).then((rec) => apply(rec, false)).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, id, apply]);

  useEffect(() => {
    if (!awaitingMatch) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setWaitedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, [awaitingMatch, matchAttempt]);

  // Save answers and research. Debounced so clicking through the interview is one write.
  useEffect(() => {
    if (!race || Object.keys(profiles).length === 0) return;
    if (Object.values(tasks).some((t) => t.state === "running")) return;
    const timer = setTimeout(() => {
      const data: GuideData = { query: searched, race, profiles, answers, overrides };
      api(`/api/guides/${id}`, { method: "PUT", body: data })
        .then(() => setSaveError(null))
        .catch((err) => setSaveError(err instanceof ApiError ? err.message : "Couldn't save this guide."));
    }, 800);
    return () => clearTimeout(timer);
  }, [id, searched, race, profiles, answers, overrides, tasks]);

  const onAnswer = (issueId: string, answer: Answer) => setAnswers((prev) => ({ ...prev, [issueId]: answer }));
  const onOverride = (candidateId: string, issueId: string, stance: number | null | undefined) =>
    setOverrides((prev) => {
      const own = { ...(prev[candidateId] ?? {}) };
      if (stance === undefined) delete own[issueId];
      else own[issueId] = stance;
      return { ...prev, [candidateId]: own };
    });

  async function toggleVoted() {
    const next = !voted;
    setVotedState(next);
    await api(`/api/guides/${id}`, { method: "PATCH", body: { voted: next } }).catch(() => setVotedState(!next));
  }

  async function retryBackground() {
    await api(`/api/guides/${id}/retry`, { method: "POST" }).catch(() => {});
    setBackground((b) => (b ? { status: "researching", failed: {} } : b));
  }

  async function retryMatch() {
    setMatchError(null);
    setWaitedMs(0);
    setMatchAttempt((n) => n + 1);
    await api(`/api/guides/${id}/retry`, { method: "POST", body: { kind: "match" } }).catch(() => {});
    api<GuideRecord>(`/api/guides/${id}`).then((rec) => apply(rec, false)).catch(() => {});
  }

  const taskList = Object.entries(tasks);
  const progress = taskList.length > 0 && (phase.kind === "researching" || taskList.some(([, t]) => t.state !== "done")) && (
    <div className="panel progress" aria-live="polite" style={{ marginBottom: 28 }}>
      {taskList.map(([key, t]) => (
        <div className="progress-row" key={key}>
          <span className={t.state === "running" ? "spinner" : t.state === "done" ? "done-dot" : "fail-dot"} aria-hidden />
          <div>
            <div className="label">{t.label}</div>
            <div className="detail">{t.detail}</div>
            {t.state === "failed" && race && key !== "race" && (
              <button type="button" className="btn quiet small" onClick={() => researchCandidate(race, key)}>Try again</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  const backgroundPanel = race && background && (pending || Object.keys(background.failed).length > 0) && (
    <div className="panel progress" aria-live="polite" style={{ marginBottom: 28 }}>
      {race.candidates.map((c) => {
        const done = Boolean(profiles[c.id]);
        const failed = background.failed[c.id];
        return (
          <div className="progress-row" key={c.id}>
            <span className={done ? "done-dot" : failed ? "fail-dot" : "spinner"} aria-hidden />
            <div>
              <div className="label">{c.name}</div>
              <div className="detail">{done ? "Done" : failed ?? "Looking it up. You can close this page."}</div>
            </div>
          </div>
        );
      })}
      {!pending && (
        <button type="button" className="btn secondary" onClick={retryBackground}>Try the missing ones again</button>
      )}
    </div>
  );

  if (phase.kind === "loading") return <div className="wrap"><p className="muted">Opening guide…</p></div>;

  if (phase.kind === "queued") {
    const failed = phase.status === "failed";
    return (
      <div className="wrap read stack">
        <p className="small muted"><Link href="/ballot">My ballot</Link></p>
        <h1>{phase.title}</h1>
        {failed ? (
          <>
            <p className="error">{phase.error ?? "Research didn't finish."}</p>
            <button type="button" className="btn" onClick={() => { void retryBackground(); setPhase({ ...phase, status: "queued", error: null }); }}>Try again</button>
          </>
        ) : (
          <div className="panel progress">
            <div className="progress-row">
              <span className="spinner" aria-hidden />
              <div>
                <div className="label">{phase.status === "queued" ? "In line" : "Looking it up"}</div>
                <div className="detail">We&apos;re looking this race up. You can close this page; it&apos;ll be on your ballot when it&apos;s ready.</div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div className="wrap read stack">
        <h1>That didn&apos;t work</h1>
        <p className="error">{phase.message}</p>
        {phase.needsGrok && grok !== "connected" ? <GrokConnect /> : null}
        <div style={{ display: "flex", gap: 12 }}>
          {searched && <button type="button" className="btn" onClick={() => lookUp(searched)}>Try again</button>}
          <Link href="/" className="btn secondary">Search again</Link>
        </div>
      </div>
    );
  }

  if (phase.kind === "researching") {
    return (
      <div className="wrap read">
        <h1 style={{ marginBottom: 20 }}>Researching “{searched}”</h1>
        {progress}
        <p className="small muted">Grok is searching the web right now. Finding the race takes about a minute, then the candidates take about another minute.</p>
      </div>
    );
  }

  if (phase.kind === "choose") {
    return (
      <div className="wrap read stack">
        <h1>Which race?</h1>
        <p className="muted">“{searched}” could mean more than one race. Pick one.</p>
        <ul className="guide-list">
          {phase.options.map((o) => (
            <li key={o.query}>
              <button type="button" className="btn quiet" style={{ fontFamily: "var(--serif)", fontSize: 18 }} onClick={() => lookUp(o.query)}>{o.label}</button>
              <span className="small muted">{o.date ?? ""}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (phase.kind === "none" || !race) {
    return (
      <div className="wrap read stack">
        <h1>No race found</h1>
        <p>{phase.kind === "none" ? phase.reason : "Try a more specific search."}</p>
        <Link href="/" className="btn secondary">Search again</Link>
      </div>
    );
  }

  const allDone = researchDone;
  const effective = effectiveAnswers(answers, suggested);
  const hasAnswers = Object.values(effective).some((a) => a.stance !== null);
  const notes = Object.fromEntries(Object.entries(suggested ?? {}).filter(([id]) => !answers[id]).map(([id, s]) => [id, { why: s.why, inferred: s.inferred === true }]));
  // Answers inferred from the interview rather than stated in it, which the voter hasn't confirmed or changed.
  const guesses = race.issues.filter((i) => notes[i.id]?.inferred && suggested?.[i.id]?.stance != null).map((i) => i.id);
  const stances = Object.fromEntries(Object.entries(profiles).map(([id, p]) => [id, profileStances(p)]));
  const headline = allDone && hasAnswers ? headlineMatch(order, stances, race.issues.map((i) => i.id), effective, overrides, seatsOf(race)) : null;
  const showResults = !editing && (interviewDone || (hasAnswers && suggested !== null));

  return (
    <div className="wrap">
      <header className="race-head">
        {origin === "ballot" && <p className="small"><Link href="/ballot">My ballot</Link></p>}
        <div className="race-title-row">
          <h1>{race.title}</h1>
          <button type="button" className={`voted-toggle${voted ? " on" : ""}`} aria-pressed={voted} onClick={toggleVoted}>
            <span className={`oval voter${voted ? " filled" : ""}`} aria-hidden />
            {voted ? "Voted" : "Mark as voted"}
          </button>
        </div>
        <div className="race-meta">
          <span>{race.election}</span>
          {race.date && <span>{new Date(`${race.date}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</span>}
          <span>{race.jurisdiction}</span>
          {race.votingRule && <span>{race.votingRule}</span>}
        </div>
        <p className="race-office">
          {race.office.text} <Sources urls={race.office.sources} />
        </p>
        <p className="shuffle-note">
          {isMeasure(race)
            ? "Each side is described from its own campaign's materials and the official analysis."
            : "Candidates are listed in random order. Party is shown the way it appears on the ballot."}
        </p>
        {saveError && <p className="error small">{saveError}</p>}
      </header>

      <MatchCard
        headline={headline}
        researchDone={allDone}
        values={values}
        fromInterview={suggested !== null}
        matchError={matchError}
        waitedMs={waitedMs}
        onRetry={retryMatch}
        onSeeWhy={() => {
          setTab("match");
          setEditing(false);
          if (hasAnswers) setInterviewDone(true);
        }}
      />

      <div className="tabs" role="tablist">
        {([["compare", "Compare"], ["profiles", isMeasure(race) ? "Each side" : "Candidates"], ["match", "Your match"]] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {progress}
      {backgroundPanel}

      <div role="tabpanel">
        {tab === "compare" && <Compare issues={race.issues} candidates={order} profiles={profiles} />}
        {tab === "profiles" && <Profiles candidates={order} profiles={profiles} measure={isMeasure(race)} />}
        {tab === "match" &&
          (!allDone && !interviewDone ? (
            <p className="muted read">Your match will show up once every candidate has been looked up, so they&apos;re all compared fairly.</p>
          ) : showResults ? (
            <Results
              issues={race.issues}
              candidates={order}
              profiles={profiles}
              answers={effective}
              notes={notes}
              overrides={overrides}
              onOverride={onOverride}
              guesses={guesses.length}
              onCheckGuesses={() => { setChecking(guesses); setInterviewDone(false); setEditing(true); }}
              onRetake={() => { setChecking(null); setInterviewDone(false); setEditing(true); }}
            />
          ) : (
            <Interview
              key={checking ? "checking" : "all"}
              issues={checking ? race.issues.filter((i) => checking.includes(i.id)) : race.issues}
              answers={effective}
              notes={notes}
              onAnswer={onAnswer}
              onFinish={() => { setChecking(null); setInterviewDone(true); setEditing(false); }}
            />
          ))}
      </div>

      {race.sources.length > 0 && (
        <p className="small muted" style={{ marginTop: 40 }}>
          {isMeasure(race) ? "Measure details from" : "Candidate list from"} <Sources urls={race.sources} />
        </p>
      )}
    </div>
  );
}

function MatchCard(props: {
  headline: ReturnType<typeof headlineMatch>;
  researchDone: boolean;
  values: string;
  fromInterview: boolean;
  matchError: string | null;
  waitedMs: number;
  onRetry: () => void;
  onSeeWhy: () => void;
}) {
  const { headline, researchDone, values, fromInterview, matchError, waitedMs, onRetry, onSeeWhy } = props;
  if (!researchDone) return null;
  const phase = interviewMatchPhase({ hasMatch: Boolean(headline), fromInterview, matchError, values, waitedMs });
  if (headline && phase === "ready") {
    const [first] = headline.picks;
    const several = headline.picks.length > 1;
    const label = several
      ? `Your ${headline.picks.length} best matches`
      : headline.closeCall ? "Too close to call" : "Your best match";
    const names = several ? joinNames(headline.picks.map((p) => p.name)) : headline.closeCall ? `${first.name} and ${headline.runnerUpName}` : first.name;
    const agreement = several
      ? `They agree with you ${joinNames(headline.picks.map((p) => `${p.score}%`))} of the way${
          headline.closeCall ? `. ${headline.runnerUpName} is close behind at ${headline.runnerUpScore}%.` : headline.runnerUpScore !== null ? ` (next closest: ${headline.runnerUpScore}%).` : "."
        }`
      : headline.closeCall
        ? `They agree with you ${first.score}% and ${headline.runnerUpScore}% of the way.`
        : `Agrees with you ${first.score}% of the way${headline.runnerUpScore !== null ? ` (next closest: ${headline.runnerUpScore}%)` : ""}.`;
    return (
      <section className="match-card" aria-label="Your match">
        <div>
          <p className="match-card-label">{label}</p>
          <p className="match-card-name">{names}</p>
          <p className="small match-card-sub">
            {agreement} {fromInterview ? "Based on your interview." : "Based on your answers."} This isn&apos;t advice on how to vote.
          </p>
        </div>
        <button type="button" className="btn" onClick={onSeeWhy}>See why</button>
      </section>
    );
  }
  if (phase === "matching") {
    return (
      <section className="match-card quiet">
        <span className="spinner" aria-hidden /> <p>Matching your interview answers to this race…</p>
      </section>
    );
  }
  if (phase === "failed" || phase === "slow") {
    return (
      <section className="match-card quiet">
        <p className="error">{phase === "failed" ? (matchError ?? "Couldn't match your answers.") : "Matching is taking too long."}</p>
        <button type="button" className="btn secondary" onClick={onRetry}>Try again</button>
      </section>
    );
  }
  if (phase === "prompt") {
    return (
      <section className="match-card quiet">
        <p>
          <Link href="/interview">Take the 10-minute interview</Link> once to see your best match in every race, or answer this
          race&apos;s questions under Your match.
        </p>
      </section>
    );
  }
  if (phase === "insufficient") {
    return (
      <section className="match-card quiet">
        <p>Not enough information to match this race from your interview.</p>
      </section>
    );
  }
  return null;
}
