import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RaceView } from "@/components/midterms/RaceView";
import { TrackerShell } from "@/components/midterms/Tracker";
import "../midterms.css";

export const metadata: Metadata = { title: "Live race results" };

export default async function Page({ params }: PageProps<"/midterms/[id]">) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  return (
    <TrackerShell kind="race" arg={String(id)} skeleton="race">
      <RaceView key={id} id={id} />
    </TrackerShell>
  );
}
