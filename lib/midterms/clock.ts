// The tracker's sense of "now". Development previews of election night shift it; in production it is the real time.
import { ELECTION_DAY_START } from "./polls";

/**
 * Development only: `?sim=21.5` previews 9:30 p.m. Eastern on election night. The previewed time, or null outside a
 * preview (always in production, and on the server).
 */
export function simAt(): number | null {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return null;
  const hours = Number(new URLSearchParams(window.location.search).get("sim"));
  return Number.isFinite(hours) && hours > 0 ? ELECTION_DAY_START + hours * 3_600_000 : null;
}

// Set as the module loads, so the first render of a preview already runs on the previewed clock.
const previewed = simAt();
let offset = previewed === null ? 0 : previewed - Date.now();

export const clockNow = () => Date.now() + offset;

/** Development only: pretend it is `at`. */
export function pretendTime(at: number) {
  offset = at - Date.now();
}
