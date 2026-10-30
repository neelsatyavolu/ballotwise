import type { Metadata } from "next";
import { NearYouView } from "@/components/midterms/NearYouView";
import "../midterms.css";
import "./near-you.css";

export const metadata: Metadata = {
  title: "Near you: the races on your ballot, live",
  description: "Live results for every race at your address: governor, Senate, House, state legislature, city and school races and statewide measures, with a map of your county.",
};

export default function Page() {
  return <NearYouView />;
}
