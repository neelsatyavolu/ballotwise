import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { db } from "@/lib/env";
import { CivicError, overview, UNAVAILABLE } from "@/lib/midterms/catalog";
import { liveJson } from "@/lib/midterms/etag";

export async function GET(req: Request) {
  try {
    return await liveJson(req, await overview(db(), Date.now(), (work) => getCloudflareContext().ctx.waitUntil(work)));
  } catch (err) {
    console.error("midterms overview failed:", err);
    return NextResponse.json({ error: err instanceof CivicError ? UNAVAILABLE : "Couldn't load results. Try again." }, { status: 503 });
  }
}
