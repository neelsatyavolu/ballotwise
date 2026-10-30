import { Suspense, type ReactNode } from "react";
import { headers } from "next/headers";
import { isDocumentRequest } from "@/lib/midterms/documentRequest";
import { loadSeeds, type SeedKind } from "@/lib/midterms/pageData";
import { ModeNav, type ModeHref } from "./ModeNav";
import { SeedProvider } from "./SeedProvider";
import { ColumnsSkeleton, OfficeSkeleton, OverviewSkeleton, RaceSkeleton } from "./Skeleton";

type Skeleton = "overview" | "office" | "columns" | "race" | "slim";

/** Shown while the server reads the cached results, so the header and tabs are up before the numbers arrive. */
export function TrackerFallback({ current, skeleton = "slim" }: { current?: ModeHref; skeleton?: Skeleton }) {
  return (
    <div className="wrap mt">
      <ModeNav current={current} />
      {skeleton === "overview" ? <OverviewSkeleton /> : skeleton === "office" ? <OfficeSkeleton /> : skeleton === "columns" ? <ColumnsSkeleton /> : skeleton === "race" ? <RaceSkeleton /> : <p className="muted">Loading results…</p>}
    </div>
  );
}

async function Seeds({ kind, arg, children }: { kind: SeedKind; arg: string; children: ReactNode }) {
  const seeds = await loadSeeds(kind, arg);
  // One timestamp for every "checked Ns ago" on this page, taken as the HTML is rendered.
  return <SeedProvider value={seeds} renderedAt={Date.now()}>{children}</SeedProvider>;
}

/**
 * Streams the tabs immediately, then sends the page with its results already in the HTML.
 * `map` starts the nation outline download with the document, ahead of the script that draws it.
 */
export async function TrackerShell({ kind = "tracker", arg = "", map = false, skeleton = "slim", current, children }: { kind?: SeedKind; arg?: string; map?: boolean; skeleton?: Skeleton; current?: ModeHref; children: ReactNode }) {
  // Client navigations already have the outline in memory, so a preload there is a wasted request.
  const preload = map && isDocumentRequest(await headers());
  return (
    <>
      {preload ? <link rel="preload" href="/midterms/maps/US.json" as="fetch" crossOrigin="anonymous" /> : null}
      <Suspense fallback={<TrackerFallback current={current} skeleton={skeleton} />}>
        <Seeds kind={kind} arg={arg}>{children}</Seeds>
      </Suspense>
    </>
  );
}
