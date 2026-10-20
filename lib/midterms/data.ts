import baselineJson from "./baseline2024.json";
import ratingsJson from "./ratings.json";
import type { RatedRace } from "./races";

/** Consensus Cook / Inside Elections / Sabato ratings for competitive races. See ratings.json for sources and date. */
export const RATINGS = ratingsJson.races as RatedRace[];
export const RATINGS_AS_OF = ratingsJson.asOf;
export const RATING_SOURCES = ratingsJson.sources;
/** 2024 presidential margin by county FIPS, Democratic minus Republican, in points. */
export const BASELINE_2024 = baselineJson as Record<string, number>;
