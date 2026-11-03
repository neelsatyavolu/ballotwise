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
 * seconds pass each real second. Kept for the browser, so every tab runs the same night (the walls included) and starting
 * or stopping it in one tab reloads the others. It changes only what this browser shows, and ends by itself after
 * MOCK_TTL so a forgotten test can't run into the real night.
 */
export type Mock = { start: number; at: number; speed: number };
const MOCK_KEY = "mt-mock";
/** How long a mock night runs, in real time, before it ends by itself. */
export const MOCK_TTL = 4 * HOUR;
/** No mock night runs from 8 p.m. Eastern (5 p.m. Pacific) on the real election night: the screens show the count. */
export const MOCK_UNTIL = ELECTION_DAY_START + 20 * HOUR;

export function readMock(): Mock | null {
  if (typeof window === "undefined") return null;
  try {
    const m: unknown = JSON.parse(localStorage.getItem(MOCK_KEY) ?? "null");
    const ok = !!m && typeof m === "object" && ["start", "at", "speed"].every((k) => Number.isFinite((m as Record<string, unknown>)[k]));
    return ok && Date.now() - (m as Mock).at < MOCK_TTL && Date.now() < MOCK_UNTIL ? (m as Mock) : null;
  } catch {
    return null;
  }
}

/** Run a mock night from `hours` after midnight Eastern on Nov 3 (null stops it), then reload. */
export function setMock(hours: number | null, speed = 1) {
  try {
    if (hours === null) localStorage.removeItem(MOCK_KEY);
    else localStorage.setItem(MOCK_KEY, JSON.stringify({ start: ELECTION_DAY_START + hours * HOUR, at: Date.now(), speed } satisfies Mock));
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
    if (m) localStorage.setItem(MOCK_KEY, JSON.stringify(m));
    else localStorage.removeItem(MOCK_KEY);
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

// Another tab started, changed or stopped the mock night: reload onto its clock. A mock still running at MOCK_UNTIL
// reloads onto the real night.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === MOCK_KEY) window.location.reload();
  });
  if (mock && Date.now() < MOCK_UNTIL) setTimeout(() => window.location.reload(), MOCK_UNTIL - Date.now());
}

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
