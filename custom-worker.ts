// The Next.js app (built by OpenNext) handles requests; this file adds the background research queue
// and the scheduled refresh of midterm race ratings.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- `.open-next/worker.js` exists only after `opennextjs-cloudflare build`.
// @ts-ignore
import { default as nextHandler } from "./.open-next/worker.js";
import type { Db } from "./lib/auth/accounts";
import { failJob, jobSchema, PermanentJobError, readableError, runJob, type Job, type JobDeps } from "./lib/ballot/jobs";
import { bareRaces, recordResults } from "./lib/midterms/catalog";
import { refreshOdds } from "./lib/midterms/odds";
import { apnsConfig, dispatchPushes } from "./lib/push/dispatch";

type Env = CloudflareEnv & { GROK_TOKEN_KEY?: string; APNS_KEY?: string; APNS_KEY_ID?: string; APNS_TEAM_ID?: string; APNS_TOPIC?: string };
const MAX_ATTEMPTS = 3;
const OLD_HOST = "ballotwise.n3el.dev";
const NEW_ORIGIN = "https://ballotwise.xanom.co";

function deps(env: Env): JobDeps {
  return {
    db: env.DB as unknown as Db,
    tokenKey: env.GROK_TOKEN_KEY ?? "",
    enqueue: async (jobs: Job[]) => {
      if (jobs.length > 0) await env.RESEARCH_QUEUE.sendBatch(jobs.map((body) => ({ body })));
    },
  };
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // The site moved; keep old links (including emailed reset links) working.
    const url = new URL(request.url);
    if (url.hostname === OLD_HOST) return Response.redirect(NEW_ORIGIN + url.pathname + url.search, 308);
    return nextHandler.fetch(request, env, ctx);
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const d = deps(env);
    // A ballot's races are sent together, so running a batch side by side starts them all at once
    // instead of waiting for the queue to add consumers one at a time.
    await Promise.all(batch.messages.map((message) => handle(message, d)));
  },

  /**
   * Every 5 minutes (wrangler.jsonc): record race calls and vote history from the current results, so they don't
   * depend on page views, send the iOS app's push alerts for what changed, then re-rate the midterm races from
   * current market prices and polls. Recording goes first so all three share one civicAPI fetch.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = Date.now();
    const db = env.DB as unknown as Db;
    const apns = apnsConfig(env);
    ctx.waitUntil(
      recordResults(db, now)
        .then((races) => (apns ? dispatchPushes(db, apns, races, now).catch((err) => console.error("push alerts failed:", err instanceof Error ? err.message : err)) : undefined))
        .catch((err) => console.error("midterms results recording failed:", err instanceof Error ? err.message : err))
        .then(() => bareRaces(now, db))
        .then((races) => refreshOdds(db, races, now))
        .catch((err) => console.error("midterms odds refresh failed:", err instanceof Error ? err.message : err)),
    );
  },
} satisfies ExportedHandler<Env>;

/** Runs one job and acks or retries its message. Never throws, so one failure doesn't touch the rest of the batch. */
async function handle(message: Message<unknown>, d: JobDeps): Promise<void> {
  const parsed = jobSchema.safeParse(message.body);
  if (!parsed.success) {
    message.ack();
    return;
  }
  try {
    await runJob(parsed.data, d);
    message.ack();
  } catch (err) {
    const final = err instanceof PermanentJobError || message.attempts >= MAX_ATTEMPTS;
    console.error(`research job ${parsed.data.type} failed (attempt ${message.attempts}${final ? ", giving up" : ""}):`, err instanceof Error ? err.message : err);
    if (final) {
      await failJob(parsed.data, readableError(err), d).catch(() => {});
      message.ack();
    } else {
      // Back off so a Grok rate limit has time to clear.
      message.retry({ delaySeconds: 60 * message.attempts });
    }
  }
}
