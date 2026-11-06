// Alaska's state House districts as map places. DDHQ reports Alaska by its 40 House districts, not by borough, and files
// them under 02001-02040, which are borough codes too (Anchorage is 02020). Here a district is 029 + its number
// ("02920"), as on the past-results map, and the maps draw Alaska by district when results come keyed that way
// (scripts/build-ak-house.mjs builds the shapes and akHouse2024.json).
import akHouse2024 from "./akHouse2024.json";

/** Each district's 2024 presidential vote as [Harris, Trump, total], on the 2022 lines the 2026 elections use. */
export const AK_HOUSE_2024: Readonly<Record<string, readonly [number, number, number]>> = akHouse2024 as unknown as Record<string, [number, number, number]>;

/** "02920" for District 20. */
export const akDistrictCode = (n: number) => `029${String(n).padStart(2, "0")}`;
export const isAkDistrictCode = (code: string | null | undefined) => /^029\d\d$/.test(code ?? "");

/** DDHQ's code for a county row, with Alaska's House districts ("State House District 20", 02020) recoded to 029 + their number. */
export function ddhqCountyCode(fips: string, name: string | undefined): string {
  const n = Number(/House District (\d+)$/i.exec(name?.trim() ?? "")?.[1]);
  return fips.startsWith("02") && n >= 1 && n <= 40 ? akDistrictCode(n) : fips;
}
