import { z } from "zod";
import type { Db } from "./auth/accounts";
import { getCached, putCached } from "./cache";
import { ask } from "./grok/research";
import type { GrokTokens } from "./grok/oauth";
import type { Issue } from "./schema";

/**
 * The values interview: one conversation per account, summarized in the voter's own words.
 * The summary is mapped onto each race's issues without the candidates in view, and the match stays arithmetic.
 */

export const MAX_QUESTIONS = 14;

const text = (max: number) => z.string().trim().min(1).max(max);

export const summarySchema = z.object({
  overview: text(500),
  priorities: z
    .array(z.object({ topic: text(60), weight: z.union([z.literal(1), z.literal(2), z.literal(3)]), view: text(320), quote: z.string().trim().max(320).nullable() }))
    .min(1)
    .max(12),
  dealbreakers: z.array(text(200)).max(6),
  leadership: z.string().trim().max(320).nullable(),
});
export type ValuesSummary = z.infer<typeof summarySchema>;

const turnSchema = z.union([
  z.object({ done: z.literal(false), message: text(500), suggestions: z.array(text(80)).max(4), progress: z.number().min(0).max(1) }),
  z.object({ done: z.literal(true), summary: summarySchema }),
]);

export type TranscriptEntry = { role: "interviewer"; text: string; suggestions: string[]; progress: number } | { role: "voter"; text: string };
export type ValuesState = { transcript: TranscriptEntry[]; summary: ValuesSummary | null; startedAt: number | null };

export const INTERVIEW_INSTRUCTIONS = `You are the values interviewer for Ballotwise, a nonpartisan voter guide. In about ten minutes (8 to ${MAX_QUESTIONS} questions), learn what this person actually wants from government, so their answers can later be compared with candidates' sourced positions in federal, state and local races.

Rules:
- One question at a time, in plain language, at most two short sentences. Be warm and brief. Never praise, agree with, disagree with, or comment on their views.
- Never mention parties, candidates, politicians, ideology labels (left, right, liberal, conservative, progressive, MAGA and so on) or media figures. If they use a label, ask what they specifically want.
- Ask about concrete tradeoffs, not slogans. Cover the range: cost of living and taxes, housing and development, public safety and policing, health care, schools, environment and energy, immigration, government spending and services, rights and civil liberties, transportation, and what they want in a leader (experience, style, independence). Go deeper where they care; after one quick check, skip what they don't.
- Follow up on vague answers ("it depends" on what?) and learn how much each topic matters to them.
- Offer 2 to 4 short suggested replies that span the reasonable range in balanced wording. Vary which view comes first. They can always answer in their own words.
- "progress" is your estimate from 0 to 1 of how complete the picture is.
- Finish when the picture is clear, after ${MAX_QUESTIONS} questions, or when told to. The summary uses their own words where possible, never infers views they did not state, and weights each priority 1 to 3 by how strongly they expressed it.

Reply with one JSON object and nothing else, either
{"done": false, "message": "your next question", "suggestions": ["..."], "progress": 0.3}
or
{"done": true, "summary": {"overview": "two or three sentences in second person", "priorities": [{"topic": "Housing", "weight": 3, "view": "what they want", "quote": "their words or null"}], "dealbreakers": ["..."], "leadership": "what they want in a leader, or null"}}`;

function toMessages(transcript: TranscriptEntry[]) {
  return transcript.map((e) =>
    e.role === "interviewer"
      ? { role: "assistant" as const, content: JSON.stringify({ done: false, message: e.text, suggestions: e.suggestions, progress: e.progress }) }
      : { role: "user" as const, content: e.text },
  );
}

export const questionsAsked = (t: TranscriptEntry[]) => t.filter((e) => e.role === "interviewer").length;

/** The next interviewer turn, or the summary when the interview is complete or the voter asked to finish. */
export async function nextTurn(tokens: GrokTokens, transcript: TranscriptEntry[], finish: boolean): Promise<TranscriptEntry | ValuesSummary> {
  const messages = toMessages(transcript);
  if (messages.length === 0) messages.push({ role: "user", content: "I'm ready to start." });
  if (finish || questionsAsked(transcript) >= MAX_QUESTIONS) {
    messages.push({ role: "user", content: "Please end the interview now and return the summary of what I said." });
  }
  const turn = await ask(tokens, INTERVIEW_INSTRUCTIONS, messages, turnSchema);
  if (turn.done) return turn.summary;
  return { role: "interviewer", text: turn.message, suggestions: turn.suggestions, progress: turn.progress };
}

// Storage

export async function getValues(db: Db, userId: string): Promise<ValuesState> {
  const row = await db
    .prepare("SELECT transcript, summary, started_at AS startedAt FROM voter_profiles WHERE user_id = ?")
    .bind(userId)
    .first<{ transcript: string; summary: string | null; startedAt: number }>();
  if (!row) return { transcript: [], summary: null, startedAt: null };
  return { transcript: JSON.parse(row.transcript), summary: row.summary ? JSON.parse(row.summary) : null, startedAt: row.startedAt };
}

export async function saveValues(db: Db, userId: string, transcript: TranscriptEntry[], summary: ValuesSummary | null, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO voter_profiles (user_id, transcript, summary, started_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET transcript = excluded.transcript, summary = excluded.summary, updated_at = excluded.updated_at`,
    )
    .bind(userId, JSON.stringify(transcript), summary ? JSON.stringify(summary) : null, now, now)
    .run();
}

export async function resetValues(db: Db, userId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM voter_profiles WHERE user_id = ?").bind(userId),
    db.prepare("UPDATE guides SET suggested = NULL, align_requested = 0 WHERE user_id = ?").bind(userId),
  ]);
}

// Mapping the interview onto one race

export const suggestedAnswerSchema = z.object({
  stance: z.number().int().min(-2).max(2).nullable(),
  weight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  why: z.string().trim().max(320),
  /** True when the interview didn't cover this issue and the stance was inferred from the voter's related values. */
  inferred: z.boolean().optional(),
});
export type SuggestedAnswer = z.infer<typeof suggestedAnswerSchema>;
export type Suggested = Record<string, SuggestedAnswer>;

const alignSchema = z.object({ answers: z.array(suggestedAnswerSchema.extend({ issueId: z.string() })) });

export const ALIGN_INSTRUCTIONS = `You place a voter on specific issue questions using only the voter's own interview summary. You are never shown candidates, and you never infer a view from party, ideology labels, or demographics.
For each issue choose a stance from -2 (strongly side A) to +2 (strongly side B):
- If the summary speaks to the issue, use it: "inferred": false, weight 1 to 3 following how much the voter said that topic matters, and "why" is one sentence quoting or closely paraphrasing what they said.
- If the interview didn't cover it, make the most reasonable inference from what the voter did say that bears on it (for example their views on costs, the role of government, regulation, fairness, risk, or local control): "inferred": true, weight 1, and "why" is one sentence starting "Inferred from" that names the views it rests on. Use a mild stance (-1, 0 or +1) unless their related views are strong.
- Use null only if nothing the voter said bears on the issue at all, and say what was missing.
Reply with one JSON object: {"answers": [{"issueId": "...", "stance": 1, "weight": 2, "why": "...", "inferred": false}]}`;

export async function alignToIssues(tokens: GrokTokens, summary: ValuesSummary, office: string, issues: Issue[]): Promise<Suggested> {
  const list = issues.map((i) => `- id "${i.id}": ${i.question}\n  -2 = strongly: ${i.sideA}\n  +2 = strongly: ${i.sideB}`).join("\n");
  const prompt = `Office: ${office}\n\nVoter's interview summary:\n${JSON.stringify(summary, null, 2)}\n\nIssues:\n${list}`;
  const { answers } = await ask(tokens, ALIGN_INSTRUCTIONS, [{ role: "user", content: prompt }], alignSchema);
  const ids = new Set(issues.map((i) => i.id));
  return Object.fromEntries(answers.filter((a) => ids.has(a.issueId)).map(({ issueId, ...rest }) => [issueId, rest]));
}

export async function saveSuggested(db: Db, guideId: string, suggested: Suggested): Promise<void> {
  await db.prepare("UPDATE guides SET suggested = ? WHERE id = ?").bind(JSON.stringify(suggested), guideId).run();
}

/**
 * Ready guides whose interview mapping left issues blank, from before inferred answers existed.
 * Each is claimed once (for the cache lifetime), so reloading the page doesn't queue it again.
 */
export async function claimRealignment(db: Db, userId: string, now: number): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT id, suggested FROM guides WHERE user_id = ? AND status = 'ready' AND suggested LIKE '%\"stance\":null%'")
    .bind(userId)
    .all<{ id: string; suggested: string }>();
  const claimed: string[] = [];
  for (const { id, suggested } of results) {
    const answers = Object.values(JSON.parse(suggested) as Suggested);
    if (!answers.some((a) => a.stance === null && a.inferred === undefined)) continue;
    if (await getCached(db, `realign:${id}`, now)) continue;
    await putCached(db, `realign:${id}`, true, now);
    claimed.push(id);
  }
  return claimed;
}

/** Marks guides as queued for mapping and returns the ones not already queued. */
export async function claimAlignment(db: Db, guideIds: string[]): Promise<string[]> {
  const claimed: string[] = [];
  for (const id of guideIds) {
    const res = (await db.prepare("UPDATE guides SET align_requested = 1 WHERE id = ? AND align_requested = 0").bind(id).run()) as { meta?: { changes?: number }; changes?: number };
    if ((res.meta?.changes ?? res.changes ?? 0) > 0) claimed.push(id);
  }
  return claimed;
}
