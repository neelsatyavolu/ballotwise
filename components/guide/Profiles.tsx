import type { CandidateRef, Profile, RaceKind, Sourced } from "@/lib/schema";
import { Claim, hostOf } from "./bits";

function Section({ title, items, empty }: { title: string; items: Sourced[]; empty: string }) {
  return (
    <section>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="unknown small">{empty}</p>
      ) : (
        <ul>{items.map((c) => <Claim key={c.text} claim={c} />)}</ul>
      )}
    </section>
  );
}

// A measure's two sides and judges use the candidate template; these are the headings their sections are researched under.
const LABELS: Record<RaceKind, { background: string; record: string; noRecord: string; funding: string }> = {
  office: { background: "Background", record: "Record in office", noRecord: "Hasn't held office, or nothing found.", funding: "No campaign finance filing found." },
  measure: { background: "Arguments", record: "If this side wins", noRecord: "Nothing found.", funding: "No campaign committee filing found." },
  judicial: { background: "Background", record: "Notable rulings", noRecord: "No notable rulings found.", funding: "No campaign finance filing found." },
};

function designation(c: CandidateRef, kind: RaceKind): string {
  if (kind === "measure") return c.ballotDesignation ?? "";
  // Most judicial contests are nonpartisan, so a missing party isn't worth a line.
  const party = kind === "judicial" ? c.party : (c.party ?? "No party listed");
  return [party, c.incumbent ? "Incumbent" : null, c.ballotDesignation].filter(Boolean).join(", ");
}

export function Profiles({ candidates, profiles, kind = "office" }: { candidates: CandidateRef[]; profiles: Record<string, Profile | undefined>; kind?: RaceKind }) {
  const labels = LABELS[kind];
  const cols = { "--cols": Math.min(candidates.length, 3) } as React.CSSProperties;
  return (
    <div className="profiles" style={cols}>
      {candidates.map((c) => {
        const p = profiles[c.id];
        return (
          <article className="profile" key={c.id}>
            <header>
              <h2>{c.name}</h2>
              <p className="party">{designation(c, kind)}</p>
            </header>
            {!p ? (
              <p className="unknown">Looking up…</p>
            ) : (
              <>
                <p>{p.summary}</p>
                <Section title={labels.background} items={p.background} empty="Nothing found." />
                <Section title={labels.record} items={p.record} empty={labels.noRecord} />
                {kind === "judicial" && <Section title="Evaluations" items={p.evaluations ?? []} empty="No published evaluation found." />}
                <Section title="Funding" items={p.funding ? [p.funding] : []} empty={labels.funding} />
                <Section title="Endorsements" items={p.endorsements} empty="No endorsements found." />
                {p.website && (
                  <p className="small">
                    {kind === "judicial" ? "Website" : "Campaign site"}: <a href={p.website} target="_blank" rel="noopener noreferrer">{hostOf(p.website)}</a>
                  </p>
                )}
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
