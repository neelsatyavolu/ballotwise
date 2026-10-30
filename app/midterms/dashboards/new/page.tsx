import type { Metadata } from "next";
import { Suspense } from "react";
import { NewDashboard } from "@/components/midterms/decision/Pages";
import "../../midterms.css";

export const metadata: Metadata = { title: "New dashboard: 2026 midterms" };

export default function Page() {
  return (
    <Suspense>
      <NewDashboard />
    </Suspense>
  );
}
