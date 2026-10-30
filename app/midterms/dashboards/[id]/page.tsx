import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardPage } from "@/components/midterms/decision/Pages";
import { TrackerShell } from "@/components/midterms/Tracker";
import "../../midterms.css";

export const metadata: Metadata = { title: "Dashboard: 2026 midterms" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <TrackerShell current="/midterms/dashboards">
      <Suspense>
        <DashboardPage id={id} />
      </Suspense>
    </TrackerShell>
  );
}
