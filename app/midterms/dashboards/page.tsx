import type { Metadata } from "next";
import { DashboardsHome } from "@/components/midterms/decision/Pages";
import "../midterms.css";

export const metadata: Metadata = { title: "Dashboards: 2026 midterms" };

export default function Page() {
  return <DashboardsHome />;
}
