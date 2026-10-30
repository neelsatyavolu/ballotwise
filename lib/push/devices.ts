import { z } from "zod";
import type { Db } from "../auth/accounts";
import type { Alerts, Device } from "./alerts";

/** A device can follow this many starred races. */
export const MAX_STARRED = 200;

export const registerSchema = z.object({
  // APNs tokens are hex; 32 bytes today, but Apple says not to hard-code the length.
  token: z.string().regex(/^[0-9a-f]{64,200}$/i, "Invalid device token."),
  environment: z.enum(["sandbox", "production"]),
  alerts: z.object({ starred: z.boolean(), control: z.boolean(), allCalls: z.boolean(), pollClose: z.boolean() }),
  starred: z.array(z.number().int().positive()).max(MAX_STARRED),
  homeState: z.string().regex(/^[A-Z]{2}$/).nullable(),
});
export type Registration = z.infer<typeof registerSchema>;

type Row = { token: string; environment: Device["environment"]; alerts: string; starred: string; home_state: string | null };

/** Adds a device or replaces its settings. `userId` links it to the signed-in account, when there is one. */
export async function saveDevice(db: Db, reg: Registration, userId: string | null, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_devices (token, environment, user_id, alerts, starred, home_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (token) DO UPDATE SET environment = excluded.environment, user_id = excluded.user_id, alerts = excluded.alerts,
         starred = excluded.starred, home_state = excluded.home_state, updated_at = excluded.updated_at`,
    )
    .bind(reg.token.toLowerCase(), reg.environment, userId, JSON.stringify(reg.alerts), JSON.stringify([...new Set(reg.starred)]), reg.homeState, now, now)
    .run();
}

export async function deleteDevices(db: Db, tokens: readonly string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db.batch(tokens.map((t) => db.prepare("DELETE FROM push_devices WHERE token = ?").bind(t.toLowerCase())));
}

const OFF: Alerts = { starred: false, control: false, allCalls: false, pollClose: false };

/** Every registered device. A row that doesn't parse gets no alerts rather than failing the run. */
export async function listDevices(db: Db): Promise<Device[]> {
  const { results } = await db.prepare("SELECT token, environment, alerts, starred, home_state FROM push_devices").all<Row>();
  return results.map((r) => {
    const alerts = registerSchema.shape.alerts.safeParse(safeJson(r.alerts));
    const starred = registerSchema.shape.starred.safeParse(safeJson(r.starred));
    return { token: r.token, environment: r.environment, alerts: alerts.success ? alerts.data : OFF, starred: starred.success ? starred.data : [], homeState: r.home_state };
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
