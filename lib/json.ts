/** Pulls the JSON object out of a model reply that may wrap it in prose or a code fence. */
export function extractJson(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : reply;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Reply contained no JSON object.");
  // Grok's inline citation markers, e.g. [[1]](https://...), are not valid JSON.
  const body = candidate.slice(start, end + 1).replace(/\[\[\d+\]\]\([^)\s]*\)/g, "");
  return JSON.parse(body);
}
