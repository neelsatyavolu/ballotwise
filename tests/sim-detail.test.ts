import { describe, expect, it } from "vitest";
import { stateCloses } from "../lib/midterms/polls";
import type { CountyResult, RaceDetail } from "../lib/midterms/races";
import { simulateDetail } from "../lib/midterms/sim";
import { votesLeft } from "../lib/midterms/votesLeft";

const HOUR = 3_600_000;

/** A county that voted Harris by `margin` points in 2024 out of `total` votes. */
const county = (fips: string, total: number, margin: number): CountyResult => ({
  fips,
  name: `County ${fips}`,
  reporting: 0,
  total: 0,
  candidates: [],
  baseline2024: margin,
  pres2024: { harris: Math.round((total * (100 + margin)) / 200), trump: Math.round((total * (100 - margin)) / 200), total },
});

const RACE: RaceDetail = {
  id: 4242,
  office: "senate",
  state: "GA",
  district: null,
  title: "Georgia US Senate",
  reporting: 0,
  total: 0,
  rating: "tossup",
  signal: null,
  candidates: [
    { name: "Dee Diaz", party: "Democratic", votes: 0, pct: 0, winner: false, incumbent: false },
    { name: "Rex Ray", party: "Republican", votes: 0, pct: 0, winner: false, incumbent: false },
  ],
  pollsClose: null,
  updated: null,
  // A big blue city, suburbs and a lot of red rural counties.
  counties: [county("13121", 500_000, 46), county("13135", 400_000, 15), ...Array.from({ length: 12 }, (_, i) => county(String(13001 + i * 2), 60_000, -45))],
};

const dLead = (votes: (party: string) => number, total: number) => ((votes("Democratic") - votes("Republican")) / total) * 100;
const votesIn = (r: RaceDetail) => (party: string) => r.candidates.find((c) => c.party === party)!.votes;

describe("simulateDetail", () => {
  const close = stateCloses("GA")!;
  const ended = simulateDetail(RACE, close + 30 * HOUR);
  const finalLead = dLead(votesIn(ended), ended.total);

  it("adds the counties up to the race's count", () => {
    for (const hours of [0.5, 1.5, 4]) {
      const r = simulateDetail(RACE, close + hours * HOUR);
      const counted = r.counties.reduce((s, c) => s + c.total, 0);
      expect(Math.abs(counted - r.total) / r.total).toBeLessThan(0.01);
      const countyLead = dLead((p) => r.counties.reduce((s, c) => s + (c.candidates.find((x) => x.party === p)?.votes ?? 0), 0), counted);
      expect(countyLead).toBeCloseTo(dLead(votesIn(r), r.total), 0);
    }
  });

  it("leaves votes out where they lean, so the votes-left estimate points to where the race ends", () => {
    const r = simulateDetail(RACE, close + 1.5 * HOUR);
    expect(r.reporting).toBeGreaterThan(40);
    expect(r.reporting).toBeLessThan(90);
    const est = votesLeft({ ...r, candidates: r.candidates.map((c) => ({ ...c, winner: false })) })!;
    const share = (party: string) => (est.leader.party === party ? est.leader.votes : est.runnerUp.party === party ? est.runnerUp.votes : 0);
    const projected = dLead((p) => votesIn(r)(p) + share(p), r.total + est.left);
    // The count so far wanders from the final result; what's left makes up the difference.
    expect(Math.abs(dLead(votesIn(r), r.total) - finalLead)).toBeGreaterThan(1);
    expect(Math.abs(projected - finalLead)).toBeLessThan(1);
  });
});
