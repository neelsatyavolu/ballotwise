import type { Metadata } from "next";
import { MidtermsHome } from "@/components/midterms/MidtermsHome";
import { TrackerShell } from "@/components/midterms/Tracker";
import "./midterms.css";

export const metadata: Metadata = {
  title: "Midterms 2026 live results",
  description: "Live results for every 2026 House, Senate and Governor race and statewide ballot measure, with county maps and a dashboard of the races you follow.",
};

export default async function Page({ searchParams }: PageProps<"/midterms">) {
  const state = (await searchParams).state;
  return (
    <TrackerShell map skeleton="overview" current="/midterms">
      <MidtermsHome initialState={typeof state === "string" && /^[A-Z]{2}$/.test(state) ? state : null} />
    </TrackerShell>
  );
}
