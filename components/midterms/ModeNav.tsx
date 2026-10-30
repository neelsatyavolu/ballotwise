import Link from "next/link";

const MODES = [
  { href: "/midterms", label: "Overview" },
  { href: "/midterms/senate", label: "Senate" },
  { href: "/midterms/house", label: "House" },
  { href: "/midterms/governor", label: "Governor" },
  { href: "/midterms/measures", label: "Ballot measures" },
  { href: "/midterms/forecast", label: "Forecast" },
  // Only offered on wide screens (see .mt-mode-wide), where the three dashboards fit side by side.
  { href: "/midterms/side-by-side", label: "Side by side", wide: true },
] as const;

/** The tracker's screens: the overview, one election-night screen per office, and all three side by side. */
export function ModeNav({ current }: { current: (typeof MODES)[number]["href"] }) {
  return (
    <nav className="mt-modes" aria-label="Results by office">
      {MODES.map((m) => (
        <Link key={m.href} href={m.href} className={"wide" in m ? "mt-mode-wide" : undefined} aria-current={m.href === current ? "page" : undefined}>
          {m.label}
        </Link>
      ))}
    </nav>
  );
}
