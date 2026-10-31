import type { Metadata } from "next";
import { ModeNav } from "@/components/midterms/ModeNav";
import { PastMap } from "@/components/midterms/past/PastMap";
import "../midterms.css";
import "./past.css";

export const metadata: Metadata = {
  title: "Past results: precinct maps of 2016 to 2024",
  description: "Every precinct's vote for president in 2016, 2020 and 2024, and for Senate and governor in 2018, on one zoomable map.",
};

export default function Page() {
  return (
    <div className="wrap mt mt-past-page">
      <ModeNav current="/midterms/past" />
      <PastMap />
    </div>
  );
}
