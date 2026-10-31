"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { MockElection } from "./MockElection";

const MODES = [
  { href: "/midterms", label: "Overview" },
  { href: "/midterms/near-you", label: "Near you" },
  { href: "/midterms/senate", label: "Senate" },
  { href: "/midterms/house", label: "House" },
  { href: "/midterms/governor", label: "Governor" },
  { href: "/midterms/measures", label: "Ballot measures" },
  { href: "/midterms/early-vote", label: "Early vote" },
  { href: "/midterms/forecast", label: "Forecast" },
  { href: "/midterms/dashboards", label: "Dashboards" },
  { href: "/midterms/search", label: "Search" },
  // Only offered on wide screens (see .mt-mode-wide), where the three dashboards fit side by side.
  { href: "/midterms/side-by-side", label: "Side by side", wide: true },
] as const;

export type ModeHref = (typeof MODES)[number]["href"];

const noSubscribe = () => () => {};
const findSlot = () => document.getElementById("header-slot");

/**
 * The tracker's screens: the overview, one election-night screen per office, and all three side by side.
 * On wide screens the tabs move up into the site header to save vertical space; the in-page copy is then hidden.
 */
export function ModeNav({ current }: { current?: ModeHref }) {
  // The header's slot is outside React's tree for this page; read it once the page is in the browser.
  const slot = useSyncExternalStore(noSubscribe, findSlot, () => null);
  const tabs = (moved: boolean) => (
    <nav className={`mt-modes${moved ? " in-header" : slot ? " moved" : ""}`} aria-label="Results by office">
      {MODES.map((m) => (
        <Link key={m.href} href={m.href} className={"wide" in m ? "mt-mode-wide" : undefined} aria-current={m.href === current ? "page" : undefined}>
          {m.label}
        </Link>
      ))}
    </nav>
  );
  return (
    <>
      {tabs(false)}
      {slot && createPortal(tabs(true), slot)}
      {process.env.NODE_ENV === "development" && <MockElection />}
    </>
  );
}
