import type { Districts } from "./ballot/census";
import type { KnownContest } from "./cache";
import { isMeasure, type CandidateRef, type Race } from "./schema";

const NEUTRALITY = `You write for a nonpartisan voter guide. Rules that override everything else:
- Report, don't judge. No adjectives that praise or criticize (e.g. "extreme", "common-sense", "radical", "bold", "controversial"). No predictions about who will win, no polling horse-race talk.
- Describe positions the way the candidate or measure's own materials describe them, attributed ("Says she will...", "Voted for..."). Use their own words in quotes when you can.
- Treat every candidate with the same depth and the same template. If you could not find something for one candidate, leave it empty rather than filling it with guesses or with opponents' characterizations.
- Every factual claim needs a source URL you actually retrieved with web search. Prefer primary sources: candidate websites, official voter guides and secretary of state pages, legislative vote records, campaign finance filings, Ballotpedia, and established news outlets. Never cite opinion pieces or partisan advocacy sites for facts.
- If something is uncertain or contested, say so plainly rather than resolving it.
- Output must be a single JSON object and nothing else. No markdown, no citation markers inside strings.`;

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const RACE_INSTRUCTIONS = `${NEUTRALITY}

Your job: identify one specific contest or ballot measure from a person's search, list who is running (or the measure's Yes and No sides), and choose the issues voters weigh in it.`;

export function racePrompt(query: string): string {
  return `Today is ${today()}. The person searched for: ${JSON.stringify(query)}

Search the web to identify the single contest they mean.
- If the search names a whole election with many contests (e.g. "San Jose election" or "2026 California ballot"), or could mean several different contests, return {"kind":"choose","options":[...]} with 2-8 specific contests. Each option has a short "label", a precise "query" that would identify only that contest, and "date" (YYYY-MM-DD or null). Prefer upcoming contests, then the most recent.
- If the search is for a ballot measure (a state proposition, or a county, city, school or district measure), return the measure in the shape described under "Ballot measures" below.
- If nothing matching can be found, return {"kind":"none","reason":"..."} in one sentence telling them what to try instead.
- Otherwise return {"kind":"race","race":{...}} with this shape:
{
  "title": "Office name and district, e.g. 'California Governor'",
  "election": "Election name, e.g. 'California General Election'",
  "date": "YYYY-MM-DD or null",
  "jurisdiction": "Where, e.g. 'State of California'",
  "office": { "text": "One or two sentences on what this office does and its term length.", "sources": ["url"] },
  "votingRule": "How the contest works if notable (e.g. 'Top two from the primary', 'Vote for up to 3', 'Ranked choice'), else null",
  "seats": 1,
  "candidates": [{ "id": "kebab-case-name", "name": "Full name as on ballot", "party": "Party as listed on the ballot or null for nonpartisan", "ballotDesignation": "Ballot designation/occupation or null", "incumbent": false }],
  "issues": [{ "id": "kebab-case", "title": "2-4 words", "question": "A neutral question about a real tradeoff", "sideA": "One reasonable position", "sideB": "The opposing reasonable position" }],
  "sources": ["urls you used to establish the candidate list"]
}
Candidate list: use the certified/qualified list for that contest. If the general election list isn't set yet, use the candidates who qualified for the next ballot and note the stage in "election". Include every qualified candidate, not only major-party ones.
Seats: the number of seats this contest fills, which is how many candidates each voter may vote for. It is 1 for most offices; at-large school boards and councils often fill 2-4 at once. Check the official sample ballot ("Vote for no more than 2").
Issues: 4-6 issues that this specific office actually decides and that the candidates disagree on or have spoken about. Phrase each as one tradeoff on a single dimension where both sides are positions reasonable people hold, worded with equal care and similar length. Keep sideA and sideB to one short plain-language clause each (under 90 characters), not a bundle of several policies. Describe the policy choice, not any candidate's platform. Do not frame either side as obviously right. Do not use party or candidate names in issues.

Ballot measures: return {"kind":"race","race":{...}} with the same shape, filled in this way:
- "kind": "measure"
- "title": the measure's ballot number and short name, e.g. "Proposition 33: Rent Control" or "Measure A: Library Parcel Tax"
- "office": { "text": "Two or three neutral sentences on what the measure would change and what the law is now, from the official ballot label and the legislative or city analyst's analysis. Include the fiscal impact if one is published.", "sources": ["url"] }
- "votingRule": what it takes to pass if not a simple majority (e.g. "Needs two-thirds approval"), else null
- "seats": 1
- "candidates": exactly two, in this order: { "id": "yes", "name": "Yes on <number>", "party": null, "ballotDesignation": "A yes vote means: <one plain sentence from the official ballot label or analysis>", "incumbent": false } and the same for "no" ("No on <number>", "A no vote means: ...")
- "issues": 3-5 tradeoffs the measure actually decides, in the same style as for candidate contests
- "sources": the official ballot label, measure text or analyst's analysis you used`;
}

export const PROFILE_INSTRUCTIONS = `${NEUTRALITY}

Your job: write one candidate's profile (or one side of a ballot measure) for a side-by-side comparison. Every candidate or side in the contest gets this exact same request, separately.`;

function issueScale(race: Race): string {
  return race.issues.map((i) => `- id "${i.id}": ${i.question}\n  -2 = strongly: ${i.sideA}\n  +2 = strongly: ${i.sideB}`).join("\n");
}

export function profilePrompt(race: Race, candidate: CandidateRef): string {
  if (isMeasure(race)) return measureSidePrompt(race, candidate);
  const issues = issueScale(race);
  return `Today is ${today()}.
Contest: ${race.title} — ${race.election}${race.date ? ` (${race.date})` : ""}, ${race.jurisdiction}.
Candidate: ${candidate.name}${candidate.party ? ` (${candidate.party})` : ""}${candidate.incumbent ? ", incumbent" : ""}.

Search the web for this candidate's own statements, official voter-guide statement, record in office, campaign finance, and endorsements. Then return:
{
  "summary": "Two neutral sentences: who they are and what they say they would focus on.",
  "background": [{ "text": "A fact about career or prior offices", "sources": ["url"] }],
  "positions": [{ "issueId": "id from the list", "stance": -2..2 or null, "summary": "What they have said or done on this, attributed", "quote": "Their exact words stating their own position, or null. Never a quote that is mainly about an opponent.", "sources": ["url"] }],
  "record": [{ "text": "A concrete vote, action, or result in a previous office", "sources": ["url"] }],
  "funding": { "text": "Total raised and main sources, with the filing period", "sources": ["url"] } or null,
  "endorsements": [{ "text": "Notable endorser or group of endorsers", "sources": ["url"] }],
  "website": "official campaign site URL or null"
}

Issues, each scored from -2 to +2:
${issues}

Scoring rules: 0 means a stated middle position, not "unknown". Use null when they haven't taken a public position you can source; never infer a stance from party. Include one entry per issue. Keep each list to the 3-5 most informative items. "record" is empty for candidates who have not held office.`;
}

/** One side of a ballot measure, researched with the same template as a candidate so the two sides are compared the same way. */
function measureSidePrompt(race: Race, side: CandidateRef): string {
  const yes = side.id === "yes";
  return `Today is ${today()}.
Ballot measure: ${race.title} — ${race.election}${race.date ? ` (${race.date})` : ""}, ${race.jurisdiction}.
What it does: ${race.office.text}
Side: ${side.name}. ${side.ballotDesignation ?? ""}

Search the web for the official ballot argument ${yes ? "in favor of" : "against"} this measure, the main campaign committee ${yes ? "supporting" : "opposing"} it, its campaign finance filings, and who has endorsed a ${yes ? "yes" : "no"} vote. Describe only this side's own case, attributed ("Supporters say..."), never the other side's characterization of it. Then return:
{
  "summary": "Two neutral sentences: what a ${yes ? "yes" : "no"} vote does and the main reason this side gives.",
  "background": [{ "text": "One argument this side makes, attributed to who makes it", "sources": ["url"] }],
  "positions": [{ "issueId": "id from the list", "stance": -2..2 or null, "summary": "Where a ${yes ? "yes" : "no"} vote lands on this issue, from the measure text, official analysis, or this side's arguments", "quote": "Exact words from this side's official argument or campaign, or null", "sources": ["url"] }],
  "record": [{ "text": "A concrete effect if this side wins, from the official analysis (what ${yes ? "changes" : "stays the same"}, costs, who is affected)", "sources": ["url"] }],
  "funding": { "text": "The main ${yes ? "yes" : "no"} committee's total raised and largest donors, with the filing period", "sources": ["url"] } or null,
  "endorsements": [{ "text": "Notable endorser or group of endorsers of a ${yes ? "yes" : "no"} vote", "sources": ["url"] }],
  "website": "the main ${yes ? "yes" : "no"} campaign's site URL or null"
}

Issues, each scored from -2 to +2:
${issueScale(race)}

Scoring rules: score where a ${yes ? "yes" : "no"} vote puts things on each issue. 0 means the measure doesn't move the issue either way. Use null only if you can't tell from a source. Include one entry per issue. Keep each list to the 3-5 most informative items. If no organized campaign exists on this side, say so in the summary and leave funding null.`;
}

export const BALLOT_INSTRUCTIONS = `${NEUTRALITY}

Your job: list the contests and ballot measures that will appear on one voter's ballot.`;

export function ballotPrompt(matchedAddress: string, districts: Districts, known: readonly KnownContest[] = []): string {
  const lines = [
    `State: ${districts.state}`,
    districts.county && `County: ${districts.county}`,
    districts.place && `City or place: ${districts.place}`,
    districts.congressional && `U.S. House: ${districts.congressional}`,
    districts.stateSenate && `State senate: ${districts.stateSenate}`,
    districts.stateHouse && `State house/assembly: ${districts.stateHouse}`,
    districts.schoolDistrict && `School district: ${districts.schoolDistrict}`,
  ].filter(Boolean);
  const reuse = known.length
    ? `\nContests already found for other addresses in this county. Some may not be on this address's ballot. When one of them is, copy its label and query exactly:\n${known.map((c) => `- ${JSON.stringify({ label: c.label, query: c.query, date: c.date })}`).join("\n")}\n`
    : "";
  return `Today is ${today()}. Voter address: ${matchedAddress}
Districts from the US Census geocoder:
${lines.join("\n")}
${reuse}
Search official sources (the county elections office and its sample ballot, the secretary of state's candidate and measure lists, Ballotpedia's sample ballot for this area) and list everything this address votes on in elections from today through the next 12 months: every contest between candidates and every ballot measure.
- Include federal, statewide, state legislative, county, city, school board, judicial and special-district contests, but only the districts this address is in. For districts not listed above (city council ward, county supervisor district, judicial or special districts), find which one covers this address from an official source; if you can't confirm it, leave that contest out.
- Include ballot measures: statewide propositions, and county, city, school and special-district measures for districts this address is in. Mark these "kind":"measure"; contests between candidates are "kind":"office".
- Leave out uncontested retention votes you can't confirm, elections whose candidate filing hasn't closed, and measures that haven't qualified for the ballot.
- Each item needs a short "label" (e.g. "U.S. House, California District 34" or "Proposition 33: Rent Control") and a "query" precise enough to identify only that contest or measure, including the election date (e.g. "California 34th congressional district general election November 3 2026").
- "level" is who votes on it: a statewide proposition is "state", a city measure is "city", a school bond is "school".

Return:
{"elections":[{"name":"Election name","date":"YYYY-MM-DD","contests":[{"label":"...","query":"...","level":"federal|state|county|city|school|judicial|special-district","kind":"office|measure"}]}]}
Return {"elections":[]} if no election with known candidates or measures is scheduled for this address in that window.`;
}
