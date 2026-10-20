import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { db } from "@/lib/env";
import { CivicError, overview, UNAVAILABLE } from "@/lib/midterms/catalog";

export async function GET() {
  try {
    return NextResponse.json(await overview(db(), Date.now(), (work) => getCloudflareContext().ctx.waitUntil(work)), { headers: { "cache-control": "public, max-age=15" } });
  } catch (err) {
    console.error("midterms overview failed:", err);
    return NextResponse.json({ error: err instanceof CivicError ? UNAVAILABLE : "Couldn't load results. Try again." }, { status: 503 });
  }
}
