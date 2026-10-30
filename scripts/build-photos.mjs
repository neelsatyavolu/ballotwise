// Builds lib/midterms/photos.json: a photo for each tracked candidate whose identity is certain, keyed by race and
// the candidate's name exactly as civicAPI spells it. A wrong face is worse than none, so a candidate gets a photo
// only when one of these holds:
//   1. They hold the seat on the ballot (congress-legislators: same state, chamber and district, same last name).
//   2. They serve or served in Congress for the same state (same full name), so the official portrait applies.
//   3. Wikidata has exactly one person by that name tied to the same state through an office, a congressional
//      district or a 2026 candidacy, and that person has an image on Wikimedia Commons.
//   4. Wikipedia's article on that very election (the state's Senate or governor's race, or its House elections)
//      links exactly one person by that name, and that person's article has a freely licensed Commons image.
//   5. Ballotpedia's page on that very race lists exactly one person by that name (or, failing that, exactly one
//      general-election candidate with their last name and first initial, and nobody else in the race shares the
//      last name), with a headshot of their own (campaign-supplied, so not freely licensed; resized and served
//      from public/midterms/photos/).
// When several members of Congress share a candidate's name, the one serving now is taken.
// Official congressional portraits (public domain) come from github.com/unitedstates/images.
// Run with `node scripts/build-photos.mjs` (RACES_URL points it at another copy of /api/midterms).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { candidates2026, placeholders, raceTitles } from "./ballotpedia.mjs";
import { firstInitial, fold, lookupNames, nameParts, raceKey, sameLast, sameName, seatSurname } from "./photo-names.mjs";

const RACES_URL = process.env.RACES_URL ?? "https://ballotwise.xanom.co/api/midterms";
const WIKIPEDIA = "https://en.wikipedia.org/w/api.php";
const STATES = new Map(JSON.parse(readFileSync(new URL("../lib/midterms/states.json", import.meta.url), "utf8")).map(([, postal, name]) => [postal, name]));
const LEGISLATORS = "https://unitedstates.github.io/congress-legislators";
const PORTRAIT = (id) => `https://unitedstates.github.io/images/congress/225x275/${id}.jpg`;
const WIKIDATA = "https://query.wikidata.org/sparql";
const UA = "Ballotwise/1.0 (https://ballotwise.xanom.co; candidate photo build)";
/** Names per lookup query, people per state-ties query (the heavier one), and articles per Wikipedia lead request. */
const BATCH = { names: 60, ties: 20, extracts: 20 };
/** Most requests to page through one election article's links; navboxes make some run past 20. */
const ARTICLE_PAGES = 60;
/** Wikidata times out now and then under load; a batch is tried this many times before it's split. */
const TRIES = 2;
/** Wikipedia API requests are tried this many times while it answers 429 (too many requests). */
const WIKIPEDIA_TRIES = 6;
/** Queries in flight at once; Wikidata's query service allows five per client. */
const PARALLEL = 4;
/** Answered queries are kept here, so a rerun after a failure doesn't ask Wikidata again. */
const CACHE = new URL("../node_modules/.cache/build-photos/", import.meta.url);
/** Ballotpedia turns away agents that don't look like a browser; its pages are read one at a time, this far apart. */
const BALLOTPEDIA = { url: "https://ballotpedia.org/", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", gapMs: 2000, tries: 4, blockedAfter: 5 };
/** Where Ballotpedia headshots are kept once resized, and their size in pixels (square, as Ballotpedia crops them). */
const PHOTO_DIR = new URL("../public/midterms/photos/", import.meta.url);
const PHOTO_PX = 96;
/** No request may hang the build: Wikidata gives up on its own queries at 60 seconds. */
const TIMEOUT_MS = { json: 60_000, sparql: 65_000, portrait: 15_000 };

const getJson = async (url) => {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS.json) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
};

const races = (await getJson(RACES_URL)).races.filter((r) => ["senate", "house", "governor"].includes(r.office));
const candidates = races.flatMap((r) => r.candidates.map((c) => ({ race: r, name: c.name, party: c.party, parts: nameParts(c.name) })));

// ---------- Congress ----------

const current = await getJson(`${LEGISLATORS}/legislators-current.json`);
// Former members since 2000, for those running again or for another office in their state.
const former = (await getJson(`${LEGISLATORS}/legislators-historical.json`)).filter((m) => m.terms.at(-1).end >= "2000");
const member = (m) => ({
  id: m.id.bioguide,
  state: m.terms.at(-1).state,
  term: m.terms.at(-1),
  parts: { firsts: [...new Set([m.name.first, m.name.nickname, m.name.first.length <= 2 ? m.name.middle : null].filter(Boolean).map((s) => fold(s).replace(/\./g, "")))], last: fold(m.name.last) },
});
const members = [...current, ...former].map(member);
const sitting = current.map(member);

/** The member holding the seat this race is for, if any. */
function holder(race) {
  return sitting.find(({ term, state }) => {
    if (state !== race.state) return false;
    if (race.office === "house") return term.type === "rep" && term.district === race.district;
    if (race.office === "senate") return term.type === "sen" && term.class === (/special/i.test(race.title) ? 3 : 2);
    return false;
  });
}

const portraitOk = new Map();
async function hasPortrait(id) {
  if (!portraitOk.has(id)) portraitOk.set(id, fetch(PORTRAIT(id), { method: "HEAD", headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS.portrait) }).then((r) => r.ok).catch(() => false));
  return portraitOk.get(id);
}

// ---------- Wikidata ----------

/** One SPARQL query, tried again after a timeout or a network error; null when every try fails. */
async function sparql(query) {
  const cached = new URL(`${createHash("sha1").update(query).digest("hex")}.json`, CACHE);
  try {
    return JSON.parse(readFileSync(cached, "utf8"));
  } catch {
    // Not asked before.
  }
  const rows = await ask(query);
  if (rows) {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(cached, JSON.stringify(rows));
  }
  return rows;
}

async function ask(query) {
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const res = await fetch(WIKIDATA, { method: "POST", body: new URLSearchParams({ query, format: "json" }), headers: { "user-agent": UA, accept: "application/sparql-results+json" }, signal: AbortSignal.timeout(TIMEOUT_MS.sparql) }).catch(() => null);
    if (res?.ok) return (await res.json()).results.bindings;
    await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
  }
  return null;
}

/** Runs `query` over `items` in batches, PARALLEL at a time; a batch that keeps failing is split in half, and a single item that fails is skipped. */
async function batched(items, size, query, skipped, label = "Wikidata") {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  const results = new Array(batches.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < batches.length) {
      const n = next++;
      const batch = batches[n];
      const rows = await sparql(query(batch));
      done += 1;
      console.error(`  ${label}: batch ${done} of ${batches.length}${rows ? "" : " failed, splitting"}`);
      if (rows) results[n] = rows;
      else if (batch.length > 1) results[n] = await batched(batch, Math.ceil(batch.length / 2), query, skipped, `${label} (split)`);
      else {
        skipped.push(batch[0]);
        results[n] = [];
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));
  return results.flat();
}

const literal = (n) => `"${n.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"@en`;

/**
 * People Wikidata knows by any of `names` who have an image, with each US state they're tied to: through an office
 * in that state, a congressional district in it, or a candidacy in one of its elections. Two steps keep each query
 * small: first the people by name, then their ties to states.
 */
async function wikidata(names, skipped) {
  const people = await batched(names, BATCH.names, (batch) => `
    SELECT DISTINCT ?name ?person ?image WHERE {
      VALUES ?name { ${batch.map(literal).join(" ")} }
      ?person rdfs:label|skos:altLabel ?name; wdt:P31 wd:Q5; wdt:P18 ?image.
    }`, skipped, "names");
  const ids = [...new Set(people.map((b) => b.person.value.split("/").at(-1)))];
  const ties = await batched(ids, BATCH.ties, (batch) => `
    SELECT DISTINCT ?person ?state WHERE {
      VALUES ?person { ${batch.map((id) => `wd:${id}`).join(" ")} }
      { ?person p:P39/ps:P39/wdt:P1001 ?st. }
      UNION { ?person p:P39/pq:P768/wdt:P131 ?st. }
      UNION { ?person wdt:P3602/wdt:P1001 ?st. }
      ?st wdt:P31 wd:Q35657; wdt:P5086 ?state.
    }`, skipped, "state ties");
  const states = new Map();
  for (const b of ties) states.set(b.person.value, [...(states.get(b.person.value) ?? []), b.state.value]);
  return people.flatMap((b) => (states.get(b.person.value) ?? []).map((state) => ({ name: b.name.value, person: b.person.value, image: b.image.value, state })));
}

// ---------- Match ----------

// Check every portrait that could be used at once, rather than one candidate at a time.
await Promise.all(
  [...new Set(candidates.flatMap((c) => [holder(c.race)?.id, ...members.filter((m) => m.state === c.race.state && sameName(m.parts, c.parts)).map((m) => m.id)]).filter(Boolean))].map(hasPortrait),
);

const photos = {};
const dropped = [];
const needWikidata = [];
for (const c of candidates) {
  const key = `${raceKey(c.race.office, c.race.state, c.race.district)}|${c.name}`;
  const sameLastInRace = c.race.candidates.filter((o) => sameLast(nameParts(o.name), c.parts)).length > 1;
  const seat = holder(c.race);
  if (seat && !sameLastInRace && seatSurname(seat.parts, c.parts) && (await hasPortrait(seat.id))) {
    photos[key] = `c:${seat.id}`;
    continue;
  }
  const named = [...new Set(members.filter((m) => m.state === c.race.state && sameName(m.parts, c.parts)).map((m) => m.id))];
  // Two members by one name (a Jr. and his father, say): the one serving now is the one running.
  const serving = named.filter((id) => sitting.some((m) => m.id === id));
  const ids = named.length > 1 && serving.length === 1 ? serving : named;
  if (ids.length === 1 && (await hasPortrait(ids[0]))) {
    photos[key] = `c:${ids[0]}`;
    continue;
  }
  if (ids.length > 1) dropped.push(`${c.name} (${c.race.state}): ${ids.length} members of Congress by that name`);
  needWikidata.push({ ...c, key });
}

const lookups = [...new Set(needWikidata.flatMap((c) => lookupNames(c.name)))];
const skipped = [];
const found = await wikidata(lookups, skipped);
for (const c of needWikidata) {
  const wanted = new Set(lookupNames(c.name).map(fold));
  const hits = found.filter((h) => h.state === c.race.state && wanted.has(fold(h.name)));
  const people = [...new Set(hits.map((h) => h.person))];
  if (people.length > 1) {
    dropped.push(`${c.name} (${c.race.state}): ${people.length} Wikidata people by that name`);
    continue;
  }
  if (!people.length) continue;
  const file = decodeURIComponent(hits[0].image.split("Special:FilePath/")[1] ?? "");
  if (file) photos[c.key] = `w:${file}`;
}

// ---------- Wikipedia election articles ----------

/** The English Wikipedia articles on the election a race belongs to. */
function articlesFor(race) {
  const state = STATES.get(race.state);
  if (!state) return [];
  if (race.office === "governor") return [`2026 ${state} gubernatorial election`];
  if (race.office === "senate") return [/special/i.test(race.title) ? `2026 United States Senate special election in ${state}` : `2026 United States Senate election in ${state}`];
  return [`2026 United States House of Representatives elections in ${state}`, `2026 United States House of Representatives election in ${state}`];
}

/** Wikipedia's API answers 429 when asked too fast; wait as long as it says and try again. */
async function wikipedia(params) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${WIKIPEDIA}?${params}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS.json) }).catch(() => null);
    if (res?.status !== 429 || attempt === WIKIPEDIA_TRIES) return res;
    await new Promise((resolve) => setTimeout(resolve, (Number(res.headers.get("retry-after")) || 10 * attempt) * 1000));
  }
}

/** Every person an article links who has a freely licensed Commons image: their article title and the file. */
async function linkedPeople(title) {
  const out = [];
  let more = {};
  for (let page = 0; page < ARTICLE_PAGES; page++) {
    const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", redirects: "1", titles: title, generator: "links", gplnamespace: "0", gpllimit: "max", prop: "pageimages", piprop: "name|thumbnail", pithumbsize: "96", pilicense: "free", ...more });
    const res = await wikipedia(params);
    if (!res?.ok) {
      console.error(`  Wikipedia: gave up on "${title}" (${res?.status ?? "network error"})`);
      break;
    }
    const body = await res.json();
    for (const p of body.query?.pages ?? []) {
      // Only Commons files: a free file kept on English Wikipedia itself wouldn't load from Commons.
      if (p.pageimage && p.thumbnail?.source?.includes("/wikipedia/commons/")) out.push({ title: p.title, file: p.pageimage.replace(/_/g, " ") });
    }
    if (!body.continue) break;
    more = body.continue;
  }
  return out;
}

/** The plain-text lead of each article in `titles`, by title. */
async function leads(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += BATCH.extracts) {
    const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", titles: titles.slice(i, i + BATCH.extracts).join("|"), prop: "extracts", exintro: "1", explaintext: "1", exlimit: "max" });
    const res = await wikipedia(params);
    if (!res?.ok) {
      console.error(`  Wikipedia: no article leads for ${titles.length - i} people (${res?.status ?? "network error"})`);
      continue;
    }
    for (const p of (await res.json()).query?.pages ?? []) out.set(p.title, p.extract ?? "");
  }
  return out;
}

/**
 * Whether a linked person's article lead fits the candidate: it names the race's state and, for a Democrat or
 * Republican, their party. Election articles link whole navboxes, so a same-named person from elsewhere can turn up.
 */
function fits(lead, c) {
  if (!lead?.includes(STATES.get(c.race.state))) return false;
  const party = /^(Democrat|Republican)/i.exec(c.party ?? "")?.[1];
  return !party || new RegExp(party, "i").test(lead);
}

const stillMissing = candidates.filter((c) => !photos[`${raceKey(c.race.office, c.race.state, c.race.district)}|${c.name}`]);
const titles = [...new Set(stillMissing.flatMap((c) => articlesFor(c.race)))];
const linked = new Map();
for (let i = 0; i < titles.length; i += PARALLEL) {
  await Promise.all(titles.slice(i, i + PARALLEL).map(async (t) => linked.set(t, await linkedPeople(t))));
  console.error(`  Wikipedia: ${Math.min(i + PARALLEL, titles.length)} of ${titles.length} election articles`);
}
// "Jane Smith (politician)" is matched as "Jane Smith".
const articleHits = (c) => [...new Map(articlesFor(c.race).flatMap((t) => linked.get(t) ?? []).filter((p) => sameName(nameParts(p.title.replace(/\s*\(.*\)$/, "")), c.parts)).map((p) => [p.title, p])).values()];
const leadOf = await leads([...new Set(stillMissing.flatMap((c) => articleHits(c).map((p) => p.title)))]);
let fromArticles = 0;
for (const c of stillMissing) {
  const hits = articleHits(c);
  if (hits.length > 1) dropped.push(`${c.name} (${c.race.state}): ${hits.length} people by that name in the election article`);
  if (hits.length !== 1) continue;
  if (!fits(leadOf.get(hits[0].title), c)) {
    dropped.push(`${c.name} (${c.race.state}): "${hits[0].title}" on Wikipedia doesn't name the state${/^(Democrat|Republican)/i.test(c.party ?? "") ? " and party" : ""}`);
    continue;
  }
  photos[`${raceKey(c.race.office, c.race.state, c.race.district)}|${c.name}`] = `w:${hits[0].file}`;
  fromArticles += 1;
}
console.log(`${fromArticles} more from Wikipedia's election articles`);

// ---------- Ballotpedia race pages ----------

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pages Ballotpedia has refused in a row; past BALLOTPEDIA.blockedAfter, it's taken to be blocking this run. */
let refusals = 0;

/** One race page's 2026 candidates, from the cache or Ballotpedia; null when the page can't be had. */
async function ballotpediaPage(title) {
  const cached = new URL(`bp2-${createHash("sha1").update(title).digest("hex")}.json`, CACHE);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  if (refusals >= BALLOTPEDIA.blockedAfter) return null;
  for (let attempt = 1; attempt <= BALLOTPEDIA.tries; attempt++) {
    await pause(BALLOTPEDIA.gapMs * attempt);
    const res = await fetch(BALLOTPEDIA.url + encodeURIComponent(title), { headers: { "user-agent": BALLOTPEDIA.ua, accept: "text/html", "accept-language": "en-US" }, signal: AbortSignal.timeout(TIMEOUT_MS.json) }).catch(() => null);
    // 202 is Ballotpedia's bot check and 429 its rate limit: wait longer and try again.
    if (res?.status === 202 || res?.status === 429 || !res) continue;
    refusals = 0;
    const people = res.ok ? candidates2026(await res.text()) : [];
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(cached, JSON.stringify(people));
    return people;
  }
  refusals += 1;
  if (refusals === BALLOTPEDIA.blockedAfter) console.error(`  Ballotpedia: refused ${refusals} pages in a row; not asking again this run`);
  return null;
}

/**
 * The race's 2026 candidates on Ballotpedia, from the first of its likely page titles that has any; null when a
 * page that might have had them couldn't be read.
 */
async function ballotpediaRace(race) {
  let unread = false;
  for (const title of raceTitles(race, STATES.get(race.state))) {
    const people = await ballotpediaPage(title);
    if (people === null) {
      console.error(`  Ballotpedia: gave up on "${title}"`);
      unread = true;
    }
    if (people?.length) return people;
  }
  return unread ? null : [];
}

/** The Ballotpedia headshots the last build found, kept for races whose pages can't be read this time. */
const previous = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../lib/midterms/photos.json", import.meta.url), "utf8"));
  } catch {
    return {};
  }
})();

/**
 * The people on a race page who can be this candidate: by name, or else (for "J. D." against "J.D.", or "Cinde"
 * against "Cynthia") the only general-election candidate with their last name and first initial, when nobody else
 * in our race shares that last name either.
 */
function ballotpediaMatch(c, people) {
  const named = people.filter((p) => sameName(nameParts(p.name), c.parts));
  if (named.length) return named;
  const surname = people.filter((p) => p.general && sameLast(nameParts(p.name), c.parts));
  const rivals = c.race.candidates.filter((o) => sameLast(nameParts(o.name), c.parts));
  return surname.length === 1 && rivals.length === 1 && firstInitial(surname[0].name) === firstInitial(c.name) ? surname : [];
}

const lacking = candidates.filter((c) => !photos[`${raceKey(c.race.office, c.race.state, c.race.district)}|${c.name}`]);
const lackingRaces = [...new Set(lacking.map((c) => c.race))];
const listed = new Map();
for (const [i, race] of lackingRaces.entries()) {
  listed.set(race, await ballotpediaRace(race));
  if ((i + 1) % 25 === 0 || i + 1 === lackingRaces.length) console.error(`  Ballotpedia: ${i + 1} of ${lackingRaces.length} race pages`);
}
const standIns = placeholders([...listed.values()].flat());
mkdirSync(PHOTO_DIR, { recursive: true });
let fromBallotpedia = 0;
let unreadRaces = 0;
for (const c of lacking) {
  const key = `${raceKey(c.race.office, c.race.state, c.race.district)}|${c.name}`;
  if (listed.get(c.race) === null) {
    unreadRaces += 1;
    if (previous[key]?.startsWith("b:") && existsSync(new URL(previous[key].slice(2), PHOTO_DIR))) {
      photos[key] = previous[key];
      fromBallotpedia += 1;
    }
    continue;
  }
  const hits = ballotpediaMatch(c, listed.get(c.race));
  if (hits.length > 1) dropped.push(`${c.name} (${c.race.state}): ${hits.length} people by that name on Ballotpedia's race page`);
  if (hits.length !== 1 || standIns.has(hits[0].image.split("/").at(-1))) continue;
  const file = `${hits[0].page.replace(/[^A-Za-z0-9_-]/g, "")}.webp`;
  if (!existsSync(new URL(file, PHOTO_DIR))) {
    const res = await fetch(hits[0].image, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS.portrait) }).catch(() => null);
    if (!res?.ok) {
      console.error(`  Ballotpedia: no headshot for ${c.name} (${res?.status ?? "network error"})`);
      continue;
    }
    await sharp(Buffer.from(await res.arrayBuffer())).resize(PHOTO_PX, PHOTO_PX, { fit: "cover", position: "top" }).webp({ quality: 75 }).toFile(new URL(file, PHOTO_DIR).pathname);
  }
  photos[key] = `b:${file}`;
  fromBallotpedia += 1;
}
// Headshots no candidate uses any more (they dropped out, or a free photo turned up) are removed.
const used = new Set(Object.values(photos).filter((v) => v.startsWith("b:")).map((v) => v.slice(2)));
for (const file of readdirSync(PHOTO_DIR)) if (!used.has(file)) rmSync(new URL(file, PHOTO_DIR));
console.log(`${fromBallotpedia} more from Ballotpedia's race pages${unreadRaces ? ` (${unreadRaces} candidates' pages unread; their last photos kept)` : ""}`);

writeFileSync(new URL("../lib/midterms/photos.json", import.meta.url), `${JSON.stringify(photos, Object.keys(photos).sort())}\n`);

// ---------- Coverage ----------

const isMajor = (party) => /^(Democrat|Republican)/i.test(party ?? "");
const tally = {};
for (const c of candidates) {
  const group = `${c.race.office} ${isMajor(c.party) ? "major" : "other"}`;
  tally[group] ??= { with: 0, of: 0 };
  tally[group].of += 1;
  if (photos[`${raceKey(c.race.office, c.race.state, c.race.district)}|${c.name}`]) tally[group].with += 1;
}
const values = Object.values(photos);
console.log(`${values.length} of ${candidates.length} candidates have a photo (${values.filter((v) => v.startsWith("c:")).length} congressional portraits, ${values.filter((v) => v.startsWith("w:")).length} Wikimedia Commons, ${values.filter((v) => v.startsWith("b:")).length} Ballotpedia)`);
for (const [group, t] of Object.entries(tally).sort()) console.log(`  ${group}: ${t.with} of ${t.of}`);
if (skipped.length) console.log(`Wikidata lookups that kept timing out (no photo for them): ${skipped.join(", ")}`);
if (dropped.length) console.log(`Dropped as ambiguous:\n  ${dropped.join("\n  ")}`);
