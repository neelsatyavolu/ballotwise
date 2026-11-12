import { appEnv } from "../env";
import type { XanomConfig } from "./flow";

/** The iOS app's custom URL scheme; the callback hands it a one-time ticket at ballotwise://xanom. */
export const IOS_CALLBACK = "ballotwise://xanom";

/** Xanom settings from the Worker's env, or null when sign-in with Xanom isn't set up here. */
export function xanomConfig(): XanomConfig | null {
  const env = appEnv();
  const issuer = env.XANOM_ISSUER?.replace(/\/+$/, "");
  const clientId = env.XANOM_CLIENT_ID;
  const clientSecret = env.XANOM_CLIENT_SECRET;
  if (!issuer || !clientId || !clientSecret || !env.APP_URL) return null;
  return { issuer, clientId, clientSecret, redirectUri: `${env.APP_URL}/api/xanom/callback` };
}
