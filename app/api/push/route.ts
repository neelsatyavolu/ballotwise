import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { appEnv, db } from "@/lib/env";
import { deleteDevices, registerSchema, saveDevice } from "@/lib/push/devices";

type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

/**
 * Rejects anything but JSON (so a cross-site form can't post here with the visitor's cookie) and more than a few
 * registrations a minute from one address (wrangler.jsonc `PUSH_LIMITER`), so fake tokens can't pile up.
 */
async function refuse(req: NextRequest): Promise<NextResponse | null> {
  if (!req.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "Send JSON." }, { status: 415 });
  const limiter = (appEnv() as unknown as { PUSH_LIMITER?: Limiter }).PUSH_LIMITER;
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (limiter && !(await limiter.limit({ key: ip })).success) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  return null;
}

/** Registers the iOS app's device for push alerts, or updates which alerts it wants. */
export async function POST(req: NextRequest) {
  const refused = await refuse(req);
  if (refused) return refused;
  const body = registerSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid registration." }, { status: 400 });
  // A device that wants nothing is forgotten rather than kept.
  if (!Object.values(body.data.alerts).some(Boolean)) {
    await deleteDevices(db(), [body.data.token]);
    return NextResponse.json({ ok: true });
  }
  const user = await currentUser();
  await saveDevice(db(), body.data, user?.id ?? null, Date.now());
  return NextResponse.json({ ok: true });
}

const deleteSchema = registerSchema.pick({ token: true });

/** Stops all alerts to a device. */
export async function DELETE(req: NextRequest) {
  const refused = await refuse(req);
  if (refused) return refused;
  const body = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid device token." }, { status: 400 });
  await deleteDevices(db(), [body.data.token]);
  return NextResponse.json({ ok: true });
}
