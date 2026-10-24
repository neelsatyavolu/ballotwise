"use client";

import { useEffect, useMemo, useState } from "react";
import { pretendTime } from "@/lib/midterms/clock";
import { ELECTION_DAY_START } from "@/lib/midterms/polls";
import type { Overview } from "@/lib/midterms/view";

type Sim = typeof import("@/lib/midterms/sim");

/** `?sim=21.5` previews 9:30 p.m. Eastern on election night. Development only; production ignores it. */
function simTime(): number | null {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return null;
  const hours = Number(new URLSearchParams(window.location.search).get("sim"));
  return Number.isFinite(hours) && hours > 0 ? ELECTION_DAY_START + hours * 3_600_000 : null;
}

/** The live overview, or in a development preview, a made-up election night at the requested hour. */
export function useSimulation(data: Overview | null): Overview | null {
  const [at] = useState(simTime);
  const [sim, setSim] = useState<Sim | null>(null);
  useEffect(() => {
    if (at === null) return;
    void import("@/lib/midterms/sim").then((mod) => {
      pretendTime(at);
      setSim(mod);
    });
  }, [at]);
  return useMemo(() => (data && sim && at !== null ? sim.simulateOverview(data, at) : data), [data, sim, at]);
}
