import { NextResponse } from "next/server";
import photos from "@/lib/midterms/photos.json";

/**
 * The candidate photo table for the iOS app: `office:STATE:district|Name` to a coded source, which the app resolves
 * the same way lib/midterms/photos.ts does (c: congress portrait, b: our copy, w: Wikimedia Commons).
 */
export function GET() {
  return NextResponse.json(photos, { headers: { "cache-control": "public, max-age=3600" } });
}
