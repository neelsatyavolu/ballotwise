// Builds lib/midterms/experts2026.json: each 2026 race's ratings from the Cook Political Report, Inside Elections and
// Sabato's Crystal Ball, as Wikipedia reproduces them (CC BY-SA). The Senate and governor ratings come from the
// predictions tables on Wikipedia's 2026 Senate and gubernatorial election pages, House ratings from each state's
// 2026 House elections page, district by district. Only those three raters are read; forecast models and Decision Desk
// HQ, whose forecast this one is tuned against, are left out.
//
// Output, keyed like odds.ts's raceKey: { "senate:ME:": { "cook": { "category": "tossup", "side": null, "date": "Oct 20, 2026" }, ... } }
// Run with `node scripts/build-experts.mjs`.
import { readFileSync, writeFileSync } from "node:fs";

const UA = "Ballotwise/1.0 (https://ballotwise.xanom.co; expert ratings)";
const STATES = JSON.parse(readFileSync(new URL("../lib/midterms/states.json", import.meta.url), "utf8")).filter(([, code]) => code !== "DC");
const CODE = Object.fromEntries(STATES.map(([, code, name]) => [name, code]));
/** The three raters, by how Wikipedia's tables mark them: a row comment on the statewide pages, a link on the House pages. */
const RATERS = [
  { id: "cook", comment: /^cook$/i, link: /Cook Political Report/i },
  { id: "insideElections", comment: /^ie$/i, link: /Inside Elections/i },
  { id: "sabato", comment: /^sabato$/i, link: /Sabato/i },
];
const AT_LARGE = new Set(["AK", "DE", "ND", "SD", "VT", "WY"]);

async function wikitext(page) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${page} returned ${res.status}`);
  const json = await res.json();
  if (!json.parse) throw new Error(`${page}: ${json.error?.info ?? "no page"}`);
  return json.parse.wikitext;
}

/** `{{USRaceRating|Lean|D|flip}}` as a category and side; Safe and Solid are the same category. */
function rating(cell) {
  const m = cell.match(/\{\{\s*USRaceRating\s*\|\s*([A-Za-z]+)\s*(?:\|\s*([DRI])\b)?/i);
  if (!m) return null;
  const word = m[1].toLowerCase();
  const category = word === "safe" || word === "solid" ? "solid" : ["likely", "lean", "tilt", "tossup"].includes(word) ? word : null;
  if (!category) return null;
  return { category, side: category === "tossup" ? null : (m[2]?.toUpperCase() ?? null) };
}

/** Each rater's "as of" date from a statewide table's header lines, e.g. `''[[The Cook Political Report|Cook]]''<br />{{small|Oct 20,<br />2026}}`. */
function headerDates(table) {
  const out = {};
  for (const line of table.split("\n").filter((l) => l.startsWith("!") && !l.includes("[[2026"))) {
    const rater = RATERS.find((r) => r.link.test(line) || new RegExp(`\\|${r.id === "insideElections" ? "IE" : r.id}\\]\\]`, "i").test(line));
    const date = line.match(/\{\{\s*small\s*\|([^}]*)\}\}/i)?.[1].replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
    if (rater && date) out[rater.id] = date;
  }
  return out;
}

/** The predictions table of a statewide page: one row per state, each rater's cell marked by a comment. */
function statewide(text, office) {
  const start = text.search(/==\s*Predictions\s*==/);
  if (start < 0) throw new Error(`${office}: no predictions section`);
  const table = text.slice(start, text.indexOf("\n|}", start));
  const rows = table.split(/\n\|-[^\n]*\n/);
  const dates = headerDates(table);
  const out = {};
  for (const row of rows) {
    const link = row.match(/^!\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*(\(special\))?/);
    if (!link) continue;
    const name = (link[2] ?? link[1]).replace(/\s*\(special\)\s*/i, "").trim();
    const code = CODE[name] ?? CODE[name.replace(/^.* in /, "")];
    if (!code) continue;
    const ratings = {};
    for (const m of row.matchAll(/<!--\s*([A-Za-z ]+?)\s*-->([^\n]*)/g)) {
      const rater = RATERS.find((r) => r.comment.test(m[1]));
      const r = rater ? rating(m[2]) : null;
      if (r) ratings[rater.id] = { ...r, date: dates[rater.id] ?? null };
    }
    if (Object.keys(ratings).length) out[`${office}:${code}:`] = ratings;
  }
  return out;
}

/** A state's House page: each district section's predictions table, with its "as of" dates. */
function housePage(text, code) {
  const out = {};
  let district = AT_LARGE.has(code) ? 0 : null;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^==\s*(?:District\s+(\d+)|At-large district)\s*==\s*$/i);
    if (heading) district = heading[1] ? Number(heading[1]) : 0;
    if (district === null || !/^\|/.test(lines[i]) || !RATERS.some((r) => r.link.test(lines[i]))) continue;
    const rater = RATERS.find((r) => r.link.test(lines[i]));
    // The rating is the next cell (on this line after `||`, or the next line), the date the one after it.
    const cells = [lines[i], lines[i + 1] ?? "", lines[i + 2] ?? "", lines[i + 3] ?? ""].join("\n").split(/\|\||\n\|/).slice(1);
    const at = cells.findIndex((c) => /USRaceRating/i.test(c));
    const r = at >= 0 ? rating(cells[at]) : null;
    const date = at >= 0 ? (cells[at + 1] ?? "").split("\n")[0].replace(/<ref.*$/, "").trim() : "";
    if (r) out[`house:${code}:${district}`] = { ...out[`house:${code}:${district}`], [rater.id]: { ...r, date: date || null } };
  }
  return out;
}

const experts = {
  ...statewide(await wikitext("2026 United States Senate elections"), "senate"),
  ...statewide(await wikitext("2026 United States gubernatorial elections"), "governor"),
};
const missing = [];
for (const [, code, name] of STATES) {
  const page = AT_LARGE.has(code) ? `2026 United States House of Representatives election in ${name}` : `2026 United States House of Representatives elections in ${name}`;
  try {
    const text = await wikitext(page);
    // California's districts are split across sub-pages, linked with {{main|...}}.
    const subpages = Object.keys(housePage(text, code)).length ? [] : [...text.matchAll(/\{\{\s*main\s*\|\s*([^}|]*\(districts[^}|]*\))/gi)].map((m) => m[1].trim());
    for (const t of [text, ...(await Promise.all(subpages.map(wikitext)))]) Object.assign(experts, housePage(t, code));
  } catch (err) {
    missing.push(`${code}: ${err.message}`);
  }
}
writeFileSync(new URL("../lib/midterms/experts2026.json", import.meta.url), `${JSON.stringify(experts)}\n`);

const count = (office, rater) => Object.entries(experts).filter(([k, v]) => k.startsWith(`${office}:`) && (!rater || v[rater])).length;
for (const office of ["senate", "governor", "house"]) console.log(office, count(office), "races;", RATERS.map((r) => `${r.id} ${count(office, r.id)}`).join(", "));
if (missing.length) console.log("pages not read:", missing.join("; "));
console.log("e.g.", JSON.stringify(experts["senate:ME:"]), JSON.stringify(experts["house:OH:9"]));
