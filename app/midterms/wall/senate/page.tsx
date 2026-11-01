import type { Metadata } from "next";
import { TrackerShell } from "@/components/midterms/Tracker";
import { Wall } from "@/components/midterms/Wall";
import "../../midterms.css";
import "../wall.css";

export const metadata: Metadata = { title: "Senate wall: 2026 live results" };

export default function Page() {
  return (
    <TrackerShell map nav={false}>
      <Wall office="senate" />
    </TrackerShell>
  );
}
