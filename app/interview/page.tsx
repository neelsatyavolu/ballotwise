import type { Metadata } from "next";
import { ValuesInterview } from "@/components/ValuesInterview";

export const metadata: Metadata = { title: "Values interview" };

export default function Page() {
  return <ValuesInterview />;
}
