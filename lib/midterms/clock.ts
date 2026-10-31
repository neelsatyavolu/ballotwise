// The tracker's sense of "now". Previews of election night shift it, in this browser only; otherwise it is the real time.
import { ELECTION_DAY_START } from "./polls";

const HOUR = 3_600_000;
const dev = () => process.env.NODE_ENV === "development" && typeof window !== "undefined";

/** Development only: `?sim=21.5` previews 9:30 p.m. Eastern on election night, held at that moment. */
function fixedPreview(): number | null {
  if (!dev()) return null;
  const hours = Number(new URLSearchParams(window.location.search).get("sim"));
  return Number.isFinite(hours) && hours > 0 ? ELECTION_DAY_START + hours * HOUR : null;
}

/** Accounts that can start a mock night on the live site. */
export const MOCK_ELECTION_EMAILS: readonly string[] = ["neel@xanom.co"];

/**
 * A mock election night that runs, in development or for the accounts in MOCK_ELECTION_EMAILS in production (see
 * MockElection). `start` is the night's time when it began, `at` the real time it began and `speed` how many night
 * seconds pass each real second. Kept for the tab, so it carries across pages. It changes only what this browser shows.
 */
export type Mock = { start: number; at: number; speed: number };
const MOCK_KEY = "mt-mock";

export function readMock(): Mock | null {
  if (typeof window === "undefined") return null;
  try {
    const m: unknown = JSON.parse(sessionStorage.getItem(MOCK_KEY) ?? "null");
    const ok = !!m && typeof m === "object" && ["start", "at", "speed"].every((k) => Number.isFinite((m as Record<string, unknown>)[k]));
    return ok ? (m as Mock) : null;
  } catch {
    return null;
  }
}

/** Run a mock night from `hours` after midnight Eastern on Nov 3 (null stops it), then reload. */
export function setMock(hours: number | null, speed = 1) {
  try {
    if (hours === null) sessionStorage.removeItem(MOCK_KEY);
    else sessionStorage.setItem(MOCK_KEY, JSON.stringify({ start: ELECTION_DAY_START + hours * HOUR, at: Date.now(), speed } satisfies Mock));
  } catch {
    // Storage off: nothing to run.
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("sim");
  window.location.assign(url);
}

/** Run exactly this mock night (a main screen's, on its companion), reloading only when it differs from this tab's. */
export function adoptMock(m: Mock | null) {
  if (JSON.stringify(m) === JSON.stringify(readMock())) return;
  try {
    if (m) sessionStorage.setItem(MOCK_KEY, JSON.stringify(m));
    else sessionStorage.removeItem(MOCK_KEY);
  } catch {
    return;
  }
  window.location.reload();
}

// Set as the module loads, so the first render of a preview already runs on the previewed clock. A `?sim=` link
// outranks a running mock.
const previewed = fixedPreview();
const mock = previewed === null ? readMock() : null;
let offset = previewed === null ? 0 : previewed - Date.now();

export const clockNow = () => (mock ? mock.start + (Date.now() - mock.at) * mock.speed : Date.now()) + offset;

/**
 * The time a preview shows, or null outside one (always on the server). A `?sim=` preview (development only) stays at
 * its moment; a mock night moves with the clock.
 */
export function simAt(): number | null {
  return fixedPreview() ?? (mock ? clockNow() : null);
}

/** Development only: pretend it is `at`. */
export function pretendTime(at: number) {
  offset += at - clockNow();
}
