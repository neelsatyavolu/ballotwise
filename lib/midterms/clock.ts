// The tracker's sense of "now". Development previews of election night shift it; in production it is the real time.
let offset = 0;

export const clockNow = () => Date.now() + offset;

/** Development only: pretend it is `at`. */
export function pretendTime(at: number) {
  offset = at - Date.now();
}
