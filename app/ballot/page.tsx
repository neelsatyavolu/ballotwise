import type { Metadata } from "next";
import { BallotView } from "@/components/BallotView";

export const metadata: Metadata = { title: "My ballot" };

export default function Page() {
  return <BallotView />;
}
