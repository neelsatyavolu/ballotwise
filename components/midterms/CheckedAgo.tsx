// Rendered inside the tracker's client components.
import { electionModeDefault } from "@/lib/midterms/polls";
import { timeAgo } from "@/lib/midterms/view";
import { useClock } from "./hooks";

/** "14s ago", ticking every second on its own so the page around it doesn't re-render with it. */
export function CheckedAgo({ at }: { at: number }) {
  const now = useClock(1000);
  return <>{timeAgo(at, now)}</>;
}

/**
 * Past this long without fresh results, the live dot turns amber. On election night the server refreshes every 30
 * seconds and pages ask every 15, so a healthy copy is at most about 45 seconds old.
 */
const STALE_MS = 50_000;

/** The live dot: green while results are fresh, amber once the last good check is over 50 seconds old or the source is slow. */
export function LiveDot({ at, stale, idle }: { at: number; stale?: boolean; idle?: boolean }) {
  const now = useClock(5000);
  // Before election night the server refreshes less often and nothing is counting, so age alone isn't a warning.
  const old = electionModeDefault(now) && now - at > STALE_MS;
  return <span className={`mt-dot${stale || old ? " stale" : ""}${idle ? " idle" : ""}`} title={old ? `No fresh results for ${timeAgo(at, now).replace(" ago", "")}` : undefined} aria-hidden />;
}
