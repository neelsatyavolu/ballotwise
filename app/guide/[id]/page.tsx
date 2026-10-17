import type { Metadata } from "next";
import { GuideView } from "@/components/guide/GuideView";

export const metadata: Metadata = { title: "Guide" };

export default async function Page({ params, searchParams }: PageProps<"/guide/[id]">) {
  const { id } = await params;
  const q = (await searchParams).q;
  return <GuideView key={id} id={id} query={typeof q === "string" ? q.slice(0, 200) : null} />;
}
