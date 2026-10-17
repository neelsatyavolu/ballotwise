import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Db } from "./auth/accounts";
import type { Job } from "./ballot/jobs";

// Secrets set with `wrangler secret put`, not listed in wrangler.jsonc.
type Secrets = { RESEND_API_KEY?: string; GROK_TOKEN_KEY?: string };

export function appEnv(): CloudflareEnv & Secrets {
  return getCloudflareContext().env as CloudflareEnv & Secrets;
}

export function db(): Db {
  return appEnv().DB as unknown as Db;
}

export async function enqueue(jobs: Job[]): Promise<void> {
  if (jobs.length > 0) await appEnv().RESEARCH_QUEUE.sendBatch(jobs.map((body) => ({ body })));
}
