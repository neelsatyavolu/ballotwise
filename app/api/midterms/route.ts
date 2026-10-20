import { NextResponse } from "next/server";
import { CivicError, overview, UNAVAILABLE } from "@/lib/midterms/catalog";

export async function GET() {
  try {
    return NextResponse.json(await overview(Date.now()), { headers: { "cache-control": "public, max-age=15" } });
  } catch (err) {
    console.error("midterms overview failed:", err);
    return NextResponse.json({ error: err instanceof CivicError ? UNAVAILABLE : "Couldn't load results. Try again." }, { status: 503 });
  }
}
