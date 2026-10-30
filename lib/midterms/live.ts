// Rules for the tracker's polling client, kept free of React so they can be tested on their own.

const fetchedAtOf = (data: unknown): number | null => {
  const at = (data as { fetchedAt?: unknown } | null)?.fetchedAt;
  return typeof at === "number" ? at : null;
};

/**
 * Whether `next` should replace `held`. Polls land on different server instances whose copies of the results can
 * differ in age, so an answer older than the one on screen is dropped rather than letting counts go backwards.
 */
export function isNewer(held: unknown, next: unknown): boolean {
  const a = fetchedAtOf(held);
  const b = fetchedAtOf(next);
  return a === null || b === null || b >= a;
}
