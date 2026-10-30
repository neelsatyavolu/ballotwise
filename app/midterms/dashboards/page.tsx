import type { Metadata } from "next";
import { DashboardsHome } from "@/components/midterms/decision/Pages";
import { TrackerShell } from "@/components/midterms/Tracker";
import "../midterms.css";

export const metadata: Metadata = { title: "Dashboards: 2026 midterms" };

export default function Page() {
  return (
    <TrackerShell current="/midterms/dashboards">
      <DashboardsHome />
    </TrackerShell>
  );
}
