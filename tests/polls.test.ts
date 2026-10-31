import { describe, expect, it } from "vitest";
import { closeWaves, countdown, ELECTION_DAY_START, electionModeDefault, formatTime, nextWave, POLL_CLOSE, setTimeZone, stampTime, stateCloses, stateFinal } from "../lib/midterms/polls";

const at = (iso: string) => Date.parse(iso);

describe("poll closing schedule", () => {
  it("covers all 50 states and DC", () => {
    expect(Object.keys(POLL_CLOSE)).toHaveLength(51);
  });

  it("puts each state at the hour most of its polls close, in Eastern time on Nov 3", () => {
    // EST (UTC-5) applies: daylight time ends Nov 1, 2026.
    expect(stateCloses("GA")).toBe(at("2026-11-04T00:00:00Z"));
    expect(stateCloses("NC")).toBe(at("2026-11-04T00:30:00Z"));
    expect(stateCloses("CA")).toBe(at("2026-11-04T04:00:00Z"));
    expect(stateCloses("ZZ")).toBeNull();
  });

  it("groups states into waves in time order, listing split states again when their last polls close", () => {
    const waves = closeWaves();
    expect(waves[0]).toEqual({ at: at("2026-11-03T23:00:00Z"), states: [{ state: "IN", part: "most" }, { state: "KY", part: "most" }] });
    expect(waves.map((w) => w.at)).toEqual([...waves.map((w) => w.at)].sort((a, b) => a - b));
    const seven = waves.find((w) => w.at === at("2026-11-04T00:00:00Z"))!;
    expect(seven.states).toContainEqual({ state: "FL", part: "most" });
    expect(seven.states).toContainEqual({ state: "IN", part: "rest" });
    expect(seven.states).toContainEqual({ state: "GA", part: "all" });
    expect(waves.at(-1)).toEqual({ at: at("2026-11-04T06:00:00Z"), states: [{ state: "AK", part: "rest" }] });
  });

  it("finds the next wave still to close, or null once every poll has closed", () => {
    expect(nextWave(at("2026-10-24T12:00:00Z"))?.at).toBe(at("2026-11-03T23:00:00Z"));
    expect(nextWave(at("2026-11-04T00:00:00Z"))?.at).toBe(at("2026-11-04T00:30:00Z"));
    expect(nextWave(at("2026-11-04T06:00:00Z"))).toBeNull();
  });
});

describe("electionModeDefault", () => {
  it("turns on from the start of Nov 3 Eastern", () => {
    expect(ELECTION_DAY_START).toBe(at("2026-11-03T05:00:00Z"));
    expect(electionModeDefault(ELECTION_DAY_START - 1)).toBe(false);
    expect(electionModeDefault(ELECTION_DAY_START)).toBe(true);
    expect(electionModeDefault(at("2026-11-06T12:00:00Z"))).toBe(true);
  });
});

describe("countdown", () => {
  it("counts down in hours, minutes and seconds, adding days when far off", () => {
    expect(countdown(3_909_000)).toBe("01:05:09");
    expect(countdown(3 * 86_400_000 + 59_000)).toBe("3d 00:00:59");
    expect(countdown(-5000)).toBe("00:00:00");
  });
});

describe("formatTime", () => {
  it("shows Eastern clock times", () => {
    expect(formatTime(at("2026-11-04T00:30:00Z"))).toBe("7:30 PM ET");
    expect(formatTime(at("2026-11-04T05:00:00Z"))).toBe("12:00 AM ET");
  });
});

describe("stampTime", () => {
  it("adds the date only off Nov 3", () => {
    expect(stampTime(at("2026-11-04T02:29:00Z"))).toBe("9:29 PM");
    expect(stampTime(at("2026-11-04T05:40:00Z"))).toBe("Nov 4, 12:40 AM");
  });
});

describe("stateFinal", () => {
  it("is the later close for split states", () => {
    expect(stateFinal("FL")).toBe(at("2026-11-04T01:00:00Z"));
    expect(stateFinal("GA")).toBe(stateCloses("GA"));
  });
});

describe("times in the viewer's zone", () => {
  it("shows times, days and the zone's name in the zone set, Eastern by default", () => {
    try {
      setTimeZone("America/Los_Angeles");
      expect(formatTime(at("2026-11-04T00:30:00Z"))).toBe("4:30 PM PT");
      // 12:40 AM Eastern on Nov 4 is still Nov 3 in California.
      expect(stampTime(at("2026-11-04T05:40:00Z"))).toBe("9:40 PM");
      setTimeZone("Europe/London");
      expect(formatTime(at("2026-11-04T00:30:00Z"))).toBe("12:30 AM GMT");
    } finally {
      setTimeZone("America/New_York");
    }
    expect(formatTime(at("2026-11-04T00:30:00Z"))).toBe("7:30 PM ET");
  });
});
