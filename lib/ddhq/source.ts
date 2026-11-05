// Where a connected account's results come from: Decision Desk HQ's count, civicAPI's, or whichever has more votes in
// (auto: a race or county takes civicAPI's count only while it's recent and ahead of DDHQ's; see applyDesk).
export const RESULTS_SOURCES = ["auto", "ddhq", "civic"] as const;
export type ResultsSource = (typeof RESULTS_SOURCES)[number];
export const RESULTS_SOURCE_LABEL: Record<ResultsSource, string> = { auto: "Auto", ddhq: "DDHQ only", civic: "civicAPI only" };
export const isResultsSource = (value: unknown): value is ResultsSource => RESULTS_SOURCES.includes(value as ResultsSource);
