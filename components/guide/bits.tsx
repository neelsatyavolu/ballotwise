import { STANCE_MAX, STANCE_MIN, type Sourced } from "@/lib/schema";

const POINTS = Array.from({ length: STANCE_MAX - STANCE_MIN + 1 }, (_, i) => STANCE_MIN + i);

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Small links after a claim, labelled by site. `compact` shows numbers instead, for tight table cells. */
export function Sources({ urls, compact = false }: { urls: readonly string[]; compact?: boolean }) {
  if (urls.length === 0) return null;
  if (compact) {
    return (
      <span className="sources compact">
        {urls.map((url, i) => (
          <a key={url} className="src" href={url} target="_blank" rel="noopener noreferrer" title={hostOf(url)} aria-label={`Source ${i + 1}: ${hostOf(url)}`}>
            {i + 1}
          </a>
        ))}
      </span>
    );
  }
  return (
    <span className="sources">
      {urls.map((url, i) => (
        <a key={url} className="src" href={url} target="_blank" rel="noopener noreferrer" title={hostOf(url)} aria-label={`Source ${i + 1}: ${hostOf(url)}`}>
          {hostOf(url).split(".").slice(-2, -1)[0] ?? i + 1}
        </a>
      ))}
    </span>
  );
}

export function Claim({ claim }: { claim: Sourced }) {
  return (
    <li>
      <span className="claim">{claim.text}</span> <Sources urls={claim.sources} />
    </li>
  );
}

/** A read-only row of five ovals with one filled. Null fills none. Estimated stances are drawn dashed and lighter. `mine` rings the voter's own answer in red. */
export function StanceOvals({ stance, label, voter = false, estimated = false, mine = null }: { stance: number | null; label: string; voter?: boolean; estimated?: boolean; mine?: number | null }) {
  return (
    <span className={`scale${estimated ? " estimated" : ""}`} role="img" aria-label={estimated ? `Estimated. ${label}` : label}>
      {POINTS.map((p) => (
        <span key={p} className={`oval${voter ? " voter" : ""}${stance === p ? " filled" : ""}${mine === p ? " mine" : ""}`} />
      ))}
    </span>
  );
}

/** Plain-language reading of a stance on an issue's A–B scale. */
export function describeStance(stance: number | null, sideA: string, sideB: string): string {
  if (stance === null) return "Unknown";
  if (stance === 0) return "In between";
  const side = stance < 0 ? sideA : sideB;
  return `${Math.abs(stance) === 2 ? "Strongly" : "Leans"}: ${side}`;
}

export { POINTS };
