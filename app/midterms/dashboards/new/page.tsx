import type { Metadata } from "next";
import { Suspense } from "react";
import { NewDashboard } from "@/components/midterms/decision/Pages";
import { TrackerShell } from "@/components/midterms/Tracker";
import "../../midterms.css";

export const metadata: Metadata = { title: "New dashboard: 2026 midterms" };

export default function Page() {
  return (
    <TrackerShell current="/midterms/dashboards">
      <Suspense>
        <NewDashboard />
      </Suspense>
    </TrackerShell>
  );
}
