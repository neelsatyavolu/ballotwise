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

export function Profiles({ candidates, profiles }: { candidates: CandidateRef[]; profiles: Record<string, Profile | undefined> }) {
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
                {[c.party ?? "No party listed", c.incumbent ? "Incumbent" : null, c.ballotDesignation].filter(Boolean).join(", ")}
              </p>
            </header>
            {!p ? (
              <p className="unknown">Looking up…</p>
            ) : (
              <>
                <p>{p.summary}</p>
                <Section title="Background" items={p.background} empty="Nothing found." />
                <Section title="Record in office" items={p.record} empty="Hasn't held office, or nothing found." />
                <Section title="Funding" items={p.funding ? [p.funding] : []} empty="No campaign finance filing found." />
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
