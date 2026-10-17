import { Home } from "@/components/Home";

export default async function Page({ searchParams }: PageProps<"/">) {
  const q = (await searchParams).q;
  return <Home initialQuery={typeof q === "string" ? q.slice(0, 200) : ""} />;
}
