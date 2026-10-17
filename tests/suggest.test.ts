import { describe, expect, it } from "vitest";
import { toSuggestion, toSuggestions } from "../lib/ballot/suggest";

const house = { properties: { countrycode: "US", housenumber: "655", street: "Hale Street", city: "Palo Alto", state: "California", postcode: "94301" } };

describe("address suggestions", () => {
  it("formats a US house as a Census-friendly address", () => {
    expect(toSuggestion(house)).toEqual({ address: "655 Hale Street, Palo Alto, CA 94301", line1: "655 Hale Street", line2: "Palo Alto, CA 94301" });
  });
  it("skips results outside the US or without a house number", () => {
    expect(toSuggestion({ properties: { ...house.properties, countrycode: "CA", state: "Ontario" } })).toBeNull();
    expect(toSuggestion({ properties: { ...house.properties, housenumber: undefined } })).toBeNull();
  });
  it("falls back to town names and drops duplicates", () => {
    const town = { properties: { ...house.properties, city: undefined, town: "Rensselaerville", state: "New York", postcode: undefined } };
    expect(toSuggestions([house, house, town]).map((s) => s.address)).toEqual(["655 Hale Street, Palo Alto, CA 94301", "655 Hale Street, Rensselaerville, NY"]);
  });
});
