import type { Metadata } from "next";
import { OfficeView } from "@/components/midterms/OfficeView";
import { TrackerShell } from "@/components/midterms/Tracker";
import "../midterms.css";

export const metadata: Metadata = { title: "Governor: 2026 live results" };

export default async function Page({ searchParams }: PageProps<"/midterms/governor">) {
  const state = (await searchParams).state;
  return (
    <TrackerShell map skeleton="office" current="/midterms/governor">
      <OfficeView office="governor" initialState={typeof state === "string" && /^[A-Z]{2}$/.test(state) ? state : null} />
    </TrackerShell>
  );
}
