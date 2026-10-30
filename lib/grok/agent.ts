import { z, type ZodType } from "zod";
import type { GrokTokens } from "./oauth";
import { callGrok, ResearchError, type FunctionCall, type InputItem, type Progress } from "./research";

/** One function the model can call. `label` names the lookup for the person waiting ("Pennsylvania Senate polls"). */
export type AgentTool<A = unknown> = {
  name: string;
  description: string;
  args: ZodType<A>;
  label: (args: A) => string;
  run: (args: A) => Promise<unknown>;
};

/** Rounds of tool calls before the model must answer with what it has. */
export const MAX_ROUNDS = 8;
/** A tool's output is cut to this many characters, so one big answer can't crowd out the conversation. */
export const MAX_OUTPUT_CHARS = 60_000;
/** Numbers in tool output keep three decimals: the model gains nothing from 0.52341234. */
const roundNumbers = (_key: string, value: unknown) => (typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 1000) / 1000 : value);

/** A tool definition in the Responses API's form, its parameters generated from the zod schema. */
export function toolSpec(tool: AgentTool<never>) {
  const parameters = Object.fromEntries(Object.entries(z.toJSONSchema(tool.args, { io: "input" })).filter(([key]) => key !== "$schema"));
  return { type: "function", name: tool.name, description: tool.description, parameters };
}

/** Runs one call. A bad argument or a failing tool goes back to the model as an error it can read and work around. */
async function runCall(call: FunctionCall, tools: readonly AgentTool<never>[], onProgress: (p: Progress) => void): Promise<string> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return JSON.stringify({ error: `There is no tool named ${call.name}.` });
  let raw: unknown;
  try {
    raw = JSON.parse(call.arguments || "{}");
  } catch {
    return JSON.stringify({ error: "The arguments were not valid JSON." });
  }
  const args = (tool.args as ZodType).safeParse(raw);
  if (!args.success) return JSON.stringify({ error: `Invalid arguments: ${args.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}` });
  onProgress({ type: "lookup", label: (tool.label as (a: unknown) => string)(args.data) });
  try {
    const out = JSON.stringify(await (tool.run as (a: unknown) => Promise<unknown>)(args.data), roundNumbers) ?? "null";
    return out.length > MAX_OUTPUT_CHARS ? `${out.slice(0, MAX_OUTPUT_CHARS)}… [cut: ask for less, e.g. a lower limit]` : out;
  } catch (err) {
    console.error(`chat tool ${call.name} failed:`, err);
    return JSON.stringify({ error: err instanceof Error ? err.message : "That lookup failed." });
  }
}

/**
 * A conversation turn in which the model may call `tools` (and search the web) as many rounds as it needs, up to
 * MAX_ROUNDS, before answering in plain text. Each round's calls run in parallel.
 */
export async function converse(
  tokens: GrokTokens,
  instructions: string,
  messages: readonly InputItem[],
  tools: readonly AgentTool<never>[],
  onProgress: (p: Progress) => void,
): Promise<string> {
  const specs = [...tools.map(toolSpec), { type: "web_search" }];
  let input: InputItem[] = [{ role: "system", content: instructions }, ...messages];
  for (let round = 0; ; round++) {
    // On the last round tools stay listed (the input refers to them) but can't be called.
    const last = round >= MAX_ROUNDS;
    const reply = await callGrok(tokens, { input, tools: specs, ...(last && { tool_choice: "none" }) }, onProgress);
    // A reply without calls always has text (callGrok refuses an empty one).
    if (reply.text && (!reply.calls.length || last)) return reply.text;
    if (last) throw new ResearchError("It kept looking things up without answering. Try a narrower question.", 502);
    const outputs = await Promise.all(reply.calls.map((call) => runCall(call, tools, onProgress)));
    input = [...input, ...reply.calls, ...reply.calls.map((call, i) => ({ type: "function_call_output" as const, call_id: call.call_id, output: outputs[i] }))];
  }
}
