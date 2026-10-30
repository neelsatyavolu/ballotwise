import type { Metadata } from "next";
import { ForecastTab } from "@/components/midterms/ForecastTab";
import "../../midterms.css";

export const metadata: Metadata = { title: "2026 governor forecast" };

export default function Page() {
  return <ForecastTab view="governor" />;
}
