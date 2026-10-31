import type { ForecastOverview } from "../../app/api/midterms/forecast/route";
import type { DdhqRace } from "./votes";

/** Private, request-scoped data from the three published DDHQ forecast pages. */
export type DdhqForecastBundle = {
  races: { key: string; race: DdhqRace }[];
  overview: ForecastOverview & { source: "ddhq" };
};
