// Builds lib/midterms/photos.json: a photo for each tracked candidate whose identity is certain, keyed by race and
// the candidate's name exactly as civicAPI spells it. A wrong face is worse than none, so a candidate gets a photo
// only when one of these holds:
//   1. They hold the seat on the ballot (congress-legislators: same state, chamber and district, same last name).
//   2. They serve or served in Congress for the same state (same full name), so the official portrait applies.
//   3. Wikidata has exactly one person by that name tied to the same state through an office, a congressional
//      district or a 2026 candidacy, and that person has an image on Wikimedia Commons.
// Official congressional portraits (public domain) come from github.com/unitedstates/images.
// Run with `node scripts/build-photos.mjs` (RACES_URL points it at another copy of /api/midterms).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fold, lookupNames, nameParts, raceKey, sameLast, sameName } from "./photo-names.mjs";

const RACES_URL = process.env.RACES_URL ?? "https://ballotwise.xanom.co/api/midterms";
const LEGISLATORS = "https://unitedstates.github.io/congress-legislators";
const PORTRAIT = (id) => `https://unitedstates.github.io/images/congress/225x275/${id}.jpg`;
const WIKIDATA = "https://query.wikidata.org/sparql";
const UA = "Ballotwise/1.0 (https://ballotwise.xanom.co; candidate photo build)";
/** Names per lookup query, and people per state-ties query (the heavier one). */
const BATCH = { names: 60, ties: 20 };
/** Wikidata times out now and then under load; a batch is tried this many times before it's split. */
const TRIES = 2;
/** Queries in flight at once; Wikidata's query service allows five per client. */
const PARALLEL = 4;
/** Answered queries are kept here, so a rerun after a failure doesn't ask Wikidata again. */
const CACHE = new URL("../node_modules/.cache/build-photos/", import.meta.url);
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
  if (seat && !sameLastInRace && sameLast(seat.parts, c.parts) && (await hasPortrait(seat.id))) {
    photos[key] = `c:${seat.id}`;
    continue;
  }
  const ids = [...new Set(members.filter((m) => m.state === c.race.state && sameName(m.parts, c.parts)).map((m) => m.id))];
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
console.log(`${values.length} of ${candidates.length} candidates have a photo (${values.filter((v) => v.startsWith("c:")).length} congressional portraits, ${values.filter((v) => v.startsWith("w:")).length} Wikimedia Commons)`);
for (const [group, t] of Object.entries(tally).sort()) console.log(`  ${group}: ${t.with} of ${t.of}`);
if (skipped.length) console.log(`Wikidata lookups that kept timing out (no photo for them): ${skipped.join(", ")}`);
if (dropped.length) console.log(`Dropped as ambiguous:\n  ${dropped.join("\n  ")}`);
