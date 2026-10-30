import type { Metadata } from "next";
import { SideBySide } from "@/components/midterms/SideBySide";
import "../midterms.css";

export const metadata: Metadata = { title: "Senate, House and Governors side by side: 2026 live results" };

export default function Page() {
  return <SideBySide />;
}
