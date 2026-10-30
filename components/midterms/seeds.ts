/** One live answer embedded in the first HTML, plus the ETag the matching API route would send. */
export type LiveSeed = { data: unknown; etag: string | null };

/** What a tracker page can paint before the browser asks for anything. Missing pieces stay null and load as before. */
export type TrackerSeeds = {
  overview: LiveSeed | null;
  forecast: LiveSeed | null;
  extra: Record<string, LiveSeed>;
};

export const EMPTY_SEEDS: TrackerSeeds = { overview: null, forecast: null, extra: {} };
