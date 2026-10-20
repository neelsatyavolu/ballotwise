import type { Metadata } from "next";
import { OfficeView } from "@/components/midterms/OfficeView";
import "../midterms.css";

export const metadata: Metadata = { title: "House: 2026 live results" };

export default async function Page({ searchParams }: PageProps<"/midterms/house">) {
  const state = (await searchParams).state;
  return <OfficeView office="house" initialState={typeof state === "string" && /^[A-Z]{2}$/.test(state) ? state : null} />;
}
