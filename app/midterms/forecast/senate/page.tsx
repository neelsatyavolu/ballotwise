import type { Metadata } from "next";
import { ForecastTab } from "@/components/midterms/ForecastTab";
import { TrackerShell } from "@/components/midterms/Tracker";
import "../../midterms.css";

export const metadata: Metadata = { title: "2026 Senate forecast" };

export default function Page() {
  return (
    <TrackerShell current="/midterms/forecast">
      <ForecastTab view="senate" />
    </TrackerShell>
  );
}
