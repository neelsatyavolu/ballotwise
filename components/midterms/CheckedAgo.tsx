// Rendered inside the tracker's client components.
import { timeAgo } from "@/lib/midterms/view";
import { useClock } from "./hooks";

/** "14s ago", ticking every second on its own so the page around it doesn't re-render with it. */
export function CheckedAgo({ at }: { at: number }) {
  const now = useClock(1000);
  return <>{timeAgo(at, now)}</>;
}
