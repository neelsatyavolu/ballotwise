import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { suggestAddresses } from "@/lib/ballot/suggest";

/** Address autocomplete for the ballot form. Signed-in only, so the free geocoder isn't open to the world. */
export async function GET(req: NextRequest) {
  if (!(await currentUser())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 4) return NextResponse.json({ suggestions: [] });

  // Cloudflare's IP location ranks nearby matches first; it is used for this request only and not stored.
  const cf = getCloudflareContext().cf as { latitude?: string; longitude?: string; country?: string } | undefined;
  const near = cf?.country === "US" && cf.latitude && cf.longitude ? { lat: Number(cf.latitude), lon: Number(cf.longitude) } : undefined;
  try {
    return NextResponse.json({ suggestions: await suggestAddresses(q, near) }, { headers: { "cache-control": "private, max-age=300" } });
  } catch (err) {
    console.error("address suggestions failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ suggestions: [] });
  }
}
