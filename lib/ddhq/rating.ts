import type { Rating } from "../midterms/races";
import type { DdhqForecast } from "./votes";

/** DDHQ's published category, not a rating recomputed by Ballotwise's model. */
export function publishedRating(value: unknown, forecast: readonly DdhqForecast[]): Rating | null | undefined {
  if (typeof value !== "string" || !forecast.length) return undefined;
  const label = value.toLowerCase().replace(/[\s-]/g, "");
  if (label === "safe") return null;
  if (label === "tossup") return "tossup";
  if (label !== "lean" && label !== "likely") return undefined;
  const favorite = [...forecast].sort((a, b) => b.probability - a.probability)[0];
  return `${label}-${favorite.party.toLowerCase()}` as Rating;
}
