import { ResearchError, type Progress } from "./grok/research";

/** One line of the newline-delimited JSON stream the research routes send to the browser. */
export type StreamLine<T> = Progress | { type: "result"; data: T } | { type: "error"; error: string; status: number };

/**
 * Streams progress while `work` runs, then the result or a readable error.
 * Long Grok searches stay visible to the person and never sit on an idle connection.
 */
export function ndjsonResponse<T>(work: (progress: (p: Progress) => void) => Promise<T>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: StreamLine<T>) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      try {
        send({ type: "result", data: await work(send) });
      } catch (err) {
        const status = err instanceof ResearchError ? err.status : 500;
        if (!(err instanceof ResearchError)) console.error("research failed:", err);
        send({ type: "error", status, error: err instanceof ResearchError ? err.message : "Something went wrong. Try again." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
