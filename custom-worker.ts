// The Next.js app (built by OpenNext) handles requests; this file adds the background research queue.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- `.open-next/worker.js` exists only after `opennextjs-cloudflare build`.
// @ts-ignore
import { default as nextHandler } from "./.open-next/worker.js";
import type { Db } from "./lib/auth/accounts";
import { failJob, jobSchema, PermanentJobError, readableError, runJob, type Job, type JobDeps } from "./lib/ballot/jobs";

type Env = CloudflareEnv & { GROK_TOKEN_KEY?: string };
const MAX_ATTEMPTS = 3;

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
  fetch: nextHandler.fetch,

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const d = deps(env);
    for (const message of batch.messages) {
      const parsed = jobSchema.safeParse(message.body);
      if (!parsed.success) {
        message.ack();
        continue;
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
  },
} satisfies ExportedHandler<Env>;
