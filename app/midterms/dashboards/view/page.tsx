import type { Metadata } from "next";
import { Suspense } from "react";
import { SharedDashboard } from "@/components/midterms/decision/Pages";
import "../../midterms.css";

export const metadata: Metadata = { title: "Shared dashboard: 2026 midterms" };

export default function Page() {
  return (
    <Suspense>
      <SharedDashboard />
    </Suspense>
  );
}
