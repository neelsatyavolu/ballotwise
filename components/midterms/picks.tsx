"use client";

// The voter's best matches from their Ballotwise guides, marked on the tracker's candidate tables.
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { useAccount } from "@/components/AccountProvider";
import { api } from "@/lib/client";
import { sameCandidate, type GuidePick, type RacePick } from "@/lib/midterms/picks";

const NONE: GuidePick[] = [];

/** Fetched once per signed-in user and shared by every table on the page. */
let held: { userId: string; picks: GuidePick[] } | null = null;
let loadingFor: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load(userId: string) {
  if (held?.userId === userId || loadingFor === userId) return;
  loadingFor = userId;
  api<{ picks: GuidePick[] }>("/api/midterms/picks")
    .then((r) => {
      held = { userId, picks: r.picks };
      listeners.forEach((l) => l());
    })
    // No picks is the same as none made: the tables just show no tag.
    .catch((err) => console.warn("Couldn't load your picks:", err))
    .finally(() => {
      if (loadingFor === userId) loadingFor = null;
    });
}

/** The signed-in voter's guide matches for election day; empty for guests and until they load. */
export function usePicks(): GuidePick[] {
  const { user } = useAccount();
  const snapshot = useSyncExternalStore(subscribe, () => held, () => null);
  const userId = user?.id ?? null;
  useEffect(() => {
    if (userId) load(userId);
  }, [userId]);
  return userId && snapshot?.userId === userId ? snapshot.picks : NONE;
}

/** What the tag's tooltip says: the score, and the runner-up when the guide called it too close. */
export function pickNote({ pick }: RacePick, name: string): string {
  const { match } = pick;
  const score = match.picks.find((p) => sameCandidate(p.name, name))?.score ?? match.picks[0].score;
  const many = match.picks.length > 1 ? ` (one of your ${match.picks.length} best matches)` : "";
  const close = match.closeCall && match.runnerUpName ? `. Too close to call: ${match.runnerUpName} is at ${match.runnerUpScore}%` : "";
  return `Your best match in your Ballotwise guide${many}: ${score}% agreement${close}. Open the guide.`;
}

/** The small "Your match" tag beside a picked candidate (or naming them, as `label`), linking to the guide it came from. */
export function PickTag({ found, name, label = "Your match" }: { found: RacePick; name: string; label?: string }) {
  return (
    <Link href={`/guide/${found.pick.guideId}`} className="mt-pick" title={pickNote(found, name)} aria-label={`${label}. ${pickNote(found, name)}`}>
      {label}
    </Link>
  );
}
