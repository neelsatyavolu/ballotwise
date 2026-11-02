import { callMessage } from "../push/alerts";
import type { CallEvent } from "./calls";
import type { Office, Rating, RaceSummary } from "./races";
import { partyOf } from "./view";

/**
 * Pop-ups are for the competitive Senate and House races: those rated likely, lean or toss-up. Safe seats have no
 * rating, and governors and ballot measures don't pop up. A race's rating freezes once it starts counting (see
 * refreshOdds), so by the time it's called this is still its pre-election rating.
 */
export function popsUp(office: Office, rating: Rating | null | undefined): boolean {
  return (office === "senate" || office === "house") && !!rating;
}

/** One call as the pop-up shows it: "Flip" over "Georgia Senate", then "Jon Ossoff (D) wins, taking the seat…". */
export type CallAlert = { id: number; raceId: number; kicker: string; label: string; body: string; side: "D" | "R" | "I" | null };

/** A call event in the words the phone alerts use (lib/push/alerts.ts), split into its kicker and the race. */
export function callAlert(event: CallEvent, race: RaceSummary | undefined): CallAlert {
  const { title, body } = callMessage(event, race);
  const cut = title.indexOf(": ");
  const party = event.kind === "withdrawal" || !event.party ? null : partyOf(event.party);
  return {
    id: event.id,
    raceId: event.raceId,
    kicker: cut < 0 ? "Called" : title.slice(0, cut),
    label: cut < 0 ? title : title.slice(cut + 2),
    body,
    side: event.office === "measure" || !party ? null : party === "other" ? "I" : party,
  };
}
