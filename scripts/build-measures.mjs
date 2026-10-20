// Builds lib/midterms/measures.json: a one-line summary of each statewide measure civicAPI lists for 2026-11-03,
// from Ballotpedia's "2026 ballot measures" tables. Ballotpedia blocks plain fetches, so save the page as Markdown
// first (a Firecrawl scrape of https://ballotpedia.org/2026_ballot_measures works), then run
// `node scripts/build-measures.mjs <page.md>`.
import { readFileSync, writeFileSync } from "node:fs";

const STATES = Object.fromEntries(JSON.parse(readFileSync(new URL("../lib/midterms/states.json", import.meta.url), "utf8")).map(([, abbr, name]) => [abbr, name]));

// civicAPI names a few measures differently from Ballotpedia: civicAPI name → Ballotpedia table title.
const ALIASES = {
  "Ohio State Issue 3 To require voters to present photo identification in order to vote": "Issue 3",
  "Washington Initiative Measure No. IL26-638": "Initiative 638",
  "Initiative Measure No. IL26-638": "Initiative 638",
  "Washington Initiative Measure No. IL26-001": "Initiative 1",
  "Initiative Measure No. IL26-001": "Initiative 1",
  "Washington Initiative Measure No. IP26-645": "Initiative 645",
  "Initiative Measure No. IP26-645": "Initiative 645",
  "Nebraska Proposed Amendment No. 1": "Constitutional Amendment 1",
  "Kentucky Amendment 1 Gubernatorial Pardons": "Limit Governor's Pardon Power and Commutations Near General Election Amendment",
  "Kansas Constitutional Amendment - Citizen Clarification": "Citizenship Voting Requirement Amendment",
  "Hawaii Ballot Measure 1 - Increase Time for Senate to Act on Judicial Appointments Amendment": "Question 1",
  "New Hampshire Question 1 - Eliminate the Office of Register of Probate Amendment": "Eliminate Office of Register of Probate Amendment",
  "Minnesota Amendment 1": "Alter Investment and Distribution Policies for Permanent School Fund Amendment",
  "Montana Initiative 194": "I-194",
  "Montana Constitutional Initiative 133": "CI-133",
  "Montana Constitutional Initiative 132": "CI-132",
  "Arkansas Citizenship Requirement for Voting Amendment": "Issue 1",
  "Arkansas Right to Keep and Bear Arms Amendment": "Issue 2",
  "Arkansas Creation of Economic Development Districts Amendment": "Issue 3",
  "Arkansas Natural Resources Commission Bond Measure": "Issue 4",
};

/** Rows of each state's November 3 table: title, link and description. */
function ballotpedia(markdown) {
  const rows = [];
  let state = null;
  let november = false;
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^### (.+)$/);
    if (heading) [state, november] = [heading[1].trim(), false];
    else if (line.startsWith("**")) november = /November 3/.test(line);
    else if (november && state && line.startsWith("| [")) {
      const cells = line.split(" | ");
      const link = cells[1].match(/\[([^\]]+)\]\((https:\/\/ballotpedia\.org\/\S+?) "/);
      if (link) rows.push({ state, title: link[1], url: link[2], summary: cells[3].trim() });
    }
  }
  return rows;
}

async function civicMeasures() {
  const out = [];
  for (const type of ["Proposition", "Referendum", "Ballot Measure"]) {
    const page = await (await fetch(`https://civicapi.org/api/v2/race/search?country=US&type=${encodeURIComponent(type)}&limit=500`)).json();
    out.push(...page.races.filter((r) => r.election_date.startsWith("2026-11-03") && r.election_type === "Statewide"));
  }
  return out;
}

const rows = ballotpedia(readFileSync(process.argv[2], "utf8"));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const out = {};
const missing = [];
for (const race of await civicMeasures()) {
  const name = race.election_name.trim();
  const state = STATES[race.province];
  const title = ALIASES[name] ?? name.split(" - ")[0].replace(new RegExp(`^${state}\\s+`), "");
  const inState = rows.filter((r) => r.state === state);
  const t = norm(title);
  // Exact title first, then one name that ends the other ("Constitutional Amendment Question 1" vs "Question 1").
  const hit = inState.find((r) => norm(r.title) === t) ?? inState.find((r) => t.endsWith(` ${norm(r.title)}`) || norm(r.title).endsWith(` ${t}`));
  if (hit) out[name] = { summary: hit.summary.replace(/\.?\s*$/, ""), url: hit.url };
  else missing.push(name);
}
writeFileSync(new URL("../lib/midterms/measures.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log("matched", Object.keys(out).length, "missing", missing);
