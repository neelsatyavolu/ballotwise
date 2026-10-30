// Rendered inside the tracker's client components.
import { useState, type CSSProperties, type ReactNode } from "react";
import { photoOf } from "@/lib/midterms/photos";
import type { RaceSummary } from "@/lib/midterms/view";
import { partyColor } from "./party";

/**
 * A candidate's round avatar in a ring of their party's color: their photo when we have one we're sure of,
 * otherwise (or if the image fails to load) `children`, usually their initials.
 */
export function Avatar({ race, candidate, className, children }: { race: Pick<RaceSummary, "office" | "state" | "district">; candidate: { name: string; party: string }; className?: string; children: ReactNode }) {
  const url = photoOf(race, candidate.name);
  const [failed, setFailed] = useState(false);
  const photo = url && !failed;
  return (
    <span className={`mt-avatar${photo ? " has-photo" : ""}${className ? ` ${className}` : ""}`} style={{ "--p": partyColor(candidate) } as CSSProperties} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny remote avatars; next/image would proxy every one */}
      {photo ? <img src={url} alt="" width={20} height={20} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : children}
    </span>
  );
}

/** Credit for the candidate photos, for a page's source note. Commons images carry their own free licenses; campaign headshots belong to the campaigns. */
export function PhotoCredit() {
  return (
    <>
      {" "}Candidate photos from <a href="https://commons.wikimedia.org">Wikimedia Commons</a> (each under its own free license), the official congressional portraits collected by <a href="https://github.com/unitedstates/images">unitedstates/images</a>, and campaign headshots via <a href="https://ballotpedia.org">Ballotpedia</a>.
    </>
  );
}
