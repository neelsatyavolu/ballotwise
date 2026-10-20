import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RaceView } from "@/components/midterms/RaceView";
import "../midterms.css";

export const metadata: Metadata = { title: "Live race results" };

export default async function Page({ params }: PageProps<"/midterms/[id]">) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  return <RaceView key={id} id={id} />;
}
