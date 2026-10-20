import Link from "next/link";

const MODES = [
  { href: "/midterms", label: "Overview" },
  { href: "/midterms/senate", label: "Senate" },
  { href: "/midterms/house", label: "House" },
  { href: "/midterms/governor", label: "Governor" },
  { href: "/midterms/measures", label: "Ballot measures" },
] as const;

/** The tracker's screens: the overview plus one election-night screen per office. */
export function ModeNav({ current }: { current: (typeof MODES)[number]["href"] }) {
  return (
    <nav className="mt-modes" aria-label="Results by office">
      {MODES.map((m) => (
        <Link key={m.href} href={m.href} aria-current={m.href === current ? "page" : undefined}>
          {m.label}
        </Link>
      ))}
    </nav>
  );
}
