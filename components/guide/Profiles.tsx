import type { CandidateRef, Profile, Sourced } from "@/lib/schema";
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

// A measure's two sides use the candidate template; these are the headings its sections are researched under.
const LABELS = {
  office: { background: "Background", record: "Record in office", noRecord: "Hasn't held office, or nothing found.", funding: "No campaign finance filing found." },
  measure: { background: "Arguments", record: "If this side wins", noRecord: "Nothing found.", funding: "No campaign committee filing found." },
};

export function Profiles({ candidates, profiles, measure = false }: { candidates: CandidateRef[]; profiles: Record<string, Profile | undefined>; measure?: boolean }) {
  const labels = LABELS[measure ? "measure" : "office"];
  const cols = { "--cols": Math.min(candidates.length, 3) } as React.CSSProperties;
  return (
    <div className="profiles" style={cols}>
      {candidates.map((c) => {
        const p = profiles[c.id];
        return (
          <article className="profile" key={c.id}>
            <header>
              <h2>{c.name}</h2>
              <p className="party">
                {measure ? c.ballotDesignation : [c.party ?? "No party listed", c.incumbent ? "Incumbent" : null, c.ballotDesignation].filter(Boolean).join(", ")}
              </p>
            </header>
            {!p ? (
              <p className="unknown">Looking up…</p>
            ) : (
              <>
                <p>{p.summary}</p>
                <Section title={labels.background} items={p.background} empty="Nothing found." />
                <Section title={labels.record} items={p.record} empty={labels.noRecord} />
                <Section title="Funding" items={p.funding ? [p.funding] : []} empty={labels.funding} />
                <Section title="Endorsements" items={p.endorsements} empty="No endorsements found." />
                {p.website && (
                  <p className="small">
                    Campaign site: <a href={p.website} target="_blank" rel="noopener noreferrer">{hostOf(p.website)}</a>
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
