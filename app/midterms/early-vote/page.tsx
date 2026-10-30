import type { Metadata } from "next";
import { EarlyVoteView } from "@/components/midterms/EarlyVoteView";
import { TrackerShell } from "@/components/midterms/Tracker";
import { isState } from "@/lib/midterms/earlyVote";
import "../midterms.css";

export const metadata: Metadata = {
  title: "Early vote: 2026 ballots cast by state",
  description: "How many people have voted early in each state: mail ballots returned, in-person early votes, party registration and demographics, by county, against 2024.",
};

export default async function Page({ searchParams }: PageProps<"/midterms/early-vote">) {
  const state = (await searchParams).state;
  const postal = typeof state === "string" && isState(state.toUpperCase()) ? state.toUpperCase() : null;
  return (
    <TrackerShell kind="early" arg={postal ?? ""} current="/midterms/early-vote">
      <EarlyVoteView initialState={postal} />
    </TrackerShell>
  );
}
