import { STANCE_MAX, STANCE_MIN, type Sourced } from "@/lib/schema";

const POINTS = Array.from({ length: STANCE_MAX - STANCE_MIN + 1 }, (_, i) => STANCE_MIN + i);

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Small numbered links after a claim. Numbering is per claim; the hover title shows the site. */
export function Sources({ urls }: { urls: readonly string[] }) {
  if (urls.length === 0) return null;
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

/** A read-only row of five ovals with one filled. Null fills none. */
export function StanceOvals({ stance, label, voter = false }: { stance: number | null; label: string; voter?: boolean }) {
  return (
    <span className="scale" role="img" aria-label={label}>
      {POINTS.map((p) => (
        <span key={p} className={`oval${voter ? " voter" : ""}${stance === p ? " filled" : ""}`} />
      ))}
    </span>
  );
}

/** Plain-language reading of a stance on an issue's A–B scale. */
export function describeStance(stance: number | null, sideA: string, sideB: string): string {
  if (stance === null) return "No sourced position";
  if (stance === 0) return "In between";
  const side = stance < 0 ? sideA : sideB;
  return `${Math.abs(stance) === 2 ? "Strongly" : "Leans"}: ${side}`;
}

export { POINTS };
