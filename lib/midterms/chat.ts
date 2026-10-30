import { converse } from "../grok/agent";
import type { GrokTokens } from "../grok/oauth";
import type { Progress } from "../grok/research";
import { chatTools, type ChatContext } from "./chatTools";
import { racesPrompt, type ChatMessage } from "./dashboard";
import { isGrid } from "./decisionView";
import { closeWaves, formatET, stampET } from "./polls";

/** A reply is cut to this length, so it still fits the history the client sends back. */
export const MAX_REPLY = 6000;

const INSTRUCTIONS = `You are the assistant on a 2026 US midterms tracker (election day Nov 3, 2026). Voters ask you about the races, forecasts, polls, prediction markets, early vote, results and calls, and you build and edit their election-night dashboards.

You get every tracked race as one line each: id|office|state|district|rating|leader|reporting|title.
Office is senate, house, governor, or measure; district is blank except for House seats (0 = at-large). Rating is the forecast's: tossup, lean-d/r/i, likely-d/r/i; blank when not competitive. Leader is the current leader and share, blank before votes; reporting is percent of the expected vote counted.
You also get the voter's starred races, their dashboards and which one is open, and when polls close.

Tools read the site's live data; use them rather than guessing, and call several at once when you can:
- find_races to filter and rank races (close counts, flips, toss-ups, a state, starred races).
- get_race for one race in depth: candidates, the forecast's inputs, forecast history, counties.
- get_race_polls, get_market_history, get_chamber_forecast, get_early_vote, get_race_calls.
- search_local_races for mayors, school boards and local measures, then get_race with the id.
- web_search for news and context the site doesn't have (candidate stances, a debate, why a market moved). Say what came from the web.
- create_dashboard, update_dashboard, delete_dashboard to change the voter's dashboards (section dashboards only; Decision View grids aren't listed and can't be edited here). Delete only when clearly asked.

How to answer:
- Lead with the answer, in a few short sentences or a short "- " list. Plain text, no Markdown headings, tables or bold.
- Give the numbers and say where each comes from: our forecast, the polling average, Kalshi/Polymarket, or the count. Chances are percents.
- If the data doesn't have something, say so rather than guess.
- Stay neutral: report forecasts and results, but never root for, endorse, or favor a candidate or party, and don't tell anyone how to vote.
- After changing a dashboard, say briefly what you did.`;

/** The poll-closing schedule, one line per time. */
function closingTimes(): string {
  return closeWaves()
    .map((w) => `${formatET(w.at)}: ${w.states.map((s) => (s.part === "all" ? s.state : `${s.state} (${s.part})`)).join(", ")}`)
    .join("\n");
}

/**
 * One chat turn: the model reads the races and the voter's dashboards, looks up whatever it needs with tools, may
 * change dashboards, and answers. Returns the reply and, when a dashboard changed, the one to show.
 */
export async function chatTurn(
  tokens: GrokTokens,
  ctx: ChatContext & { starred: readonly number[] },
  messages: readonly ChatMessage[],
  onProgress: (p: Progress) => void,
): Promise<{ reply: string; changed: boolean; focusId: string | null }> {
  // Grok arranges section dashboards; Decision View grids are edited by hand, so it doesn't see them.
  const sections = ctx.dashboards.filter((d) => !isGrid(d.layout));
  const open = sections.some((d) => d.id === ctx.openId) ? ctx.openId : null;
  let change: { focusId: string | null } | null = null;
  const tools = chatTools({ ...ctx, openId: open }, (focusId) => (change = { focusId }));
  const context = [
    `Now: ${new Date(ctx.now).toISOString()} (${stampET(ctx.now)} ET)`,
    `Races:\n${racesPrompt(ctx.races)}`,
    `Starred races: ${ctx.starred.length ? ctx.starred.join(", ") : "none"}`,
    `Dashboards:\n${JSON.stringify(sections.map((d) => ({ id: d.id, ...d.layout })))}`,
    `Open dashboard: ${open ?? "none"}`,
    `Polls close (Nov 3):\n${closingTimes()}`,
  ].join("\n\n");
  const reply = await converse(tokens, INSTRUCTIONS, [{ role: "user", content: context }, { role: "assistant", content: "Got it." }, ...messages], tools, onProgress);
  const changed = change as { focusId: string | null } | null;
  return { reply: reply.slice(0, MAX_REPLY), changed: !!changed, focusId: changed ? changed.focusId : open };
}
