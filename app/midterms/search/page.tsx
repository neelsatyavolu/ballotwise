import type { Metadata } from "next";
import { SearchView } from "@/components/midterms/SearchView";
import { TrackerShell } from "@/components/midterms/Tracker";
import "../midterms.css";

export const metadata: Metadata = {
  title: "Search every 2026 race",
  description: "Find any race on the 2026 ballot, from Senate seats to mayors, school boards, city councils and local measures, with live results.",
};

export default async function Page({ searchParams }: PageProps<"/midterms/search">) {
  const q = (await searchParams).q;
  return (
    <TrackerShell current="/midterms/search">
      <SearchView initialQuery={typeof q === "string" ? q.slice(0, 80) : ""} />
    </TrackerShell>
  );
}
