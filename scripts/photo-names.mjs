// Name matching for scripts/build-photos.mjs, kept apart so tests can check it without fetching anything.
// A photo is only attached when the person's identity is certain, so these rules lean toward "no match".

const SUFFIX = /^(jr|sr|ii|iii|iv|v)$/;
const PARTICLE = /^(de|la|del|der|van|von|da|di|le|st|mac)$/;
/** Short first names and the full names they stand for, both ways. */
const NICKNAMES = [
  ["jim", "james"], ["jimmy", "james"], ["bill", "william"], ["will", "william"], ["billy", "william"],
  ["bob", "robert"], ["rob", "robert"], ["bobby", "robert"], ["mike", "michael"], ["tom", "thomas"],
  ["tommy", "thomas"], ["jon", "jonathan"], ["joe", "joseph"], ["dick", "richard"], ["rick", "richard"],
  ["rich", "richard"], ["ted", "edward"], ["ed", "edward"], ["chuck", "charles"], ["charlie", "charles"],
  ["dan", "daniel"], ["danny", "daniel"], ["dave", "david"], ["steve", "steven"], ["steve", "stephen"],
  ["chris", "christopher"], ["pat", "patrick"], ["pat", "patricia"], ["kate", "katherine"], ["kathy", "kathleen"],
  ["liz", "elizabeth"], ["beth", "elizabeth"], ["betsy", "elizabeth"], ["maggie", "margaret"], ["peggy", "margaret"],
  ["sue", "susan"], ["susie", "susan"], ["jen", "jennifer"], ["jenny", "jennifer"], ["andy", "andrew"],
  ["drew", "andrew"], ["tony", "anthony"], ["nick", "nicholas"], ["matt", "matthew"], ["greg", "gregory"],
  ["jeff", "jeffrey"], ["ken", "kenneth"], ["larry", "lawrence"], ["ron", "ronald"], ["don", "donald"],
  ["doug", "douglas"], ["fred", "frederick"], ["frank", "francis"], ["hank", "henry"], ["harry", "henry"],
  ["jack", "john"], ["johnny", "john"], ["josh", "joshua"], ["sam", "samuel"], ["ben", "benjamin"],
  ["alex", "alexander"], ["alex", "alexandra"], ["abby", "abigail"], ["abe", "abraham"], ["vince", "vincent"],
  ["val", "valerie"], ["jerry", "gerald"], ["gerry", "gerald"], ["terry", "terrence"], ["tim", "timothy"],
];
const NICK = new Map();
for (const [a, b] of NICKNAMES) {
  NICK.set(a, [...(NICK.get(a) ?? []), b]);
  NICK.set(b, [...(NICK.get(b) ?? []), a]);
}

/** Lowercase, accents and punctuation removed, curly quotes made straight. */
export function fold(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .toLowerCase();
}

/**
 * The names a person goes by: their possible first names (given name, quoted nickname, or the middle name when
 * the first is only an initial) and their last name with any particle ("de la cruz", "van hollen").
 */
export function nameParts(name) {
  const folded = fold(name);
  const nicks = [...folded.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/\bdr\b\.?/g, " ").replace(/\b(jr|sr)\b\.?/g, " ").trim().split(/\s+/)[0]).filter(Boolean);
  const tokens = folded
    .replace(/"[^"]*"/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !SUFFIX.test(t));
  if (!tokens.length) return { firsts: [], last: "" };
  let i = tokens.length - 1;
  while (i > 0 && PARTICLE.test(tokens[i - 1])) i -= 1;
  const last = tokens.slice(i).join(" ");
  const given = tokens.slice(0, i);
  const firsts = [];
  if (given[0]?.length > 1) firsts.push(given[0]);
  else if (given[1]?.length > 1) firsts.push(given[1]);
  return { firsts: [...new Set([...firsts, ...nicks])], last };
}

const squash = (s) => s.replace(/[\s'-]/g, "");

/** Same last name, ignoring spaces, hyphens and apostrophes. */
export function sameLast(a, b) {
  return !!a.last && squash(a.last) === squash(b.last);
}

/**
 * Last names for someone already known to hold the seat in question: the same last name, or the same final word of
 * it, since civicAPI may spell "Leger Fernández" as "Fernandez". Too loose for anyone not tied to the seat.
 */
export function seatSurname(a, b) {
  return sameLast(a, b) || (!!a.last && !!b.last && squash(a.last.split(" ").at(-1)) === squash(b.last.split(" ").at(-1)));
}

function sameFirst(x, y) {
  if (x === y) return true;
  // "Chris" for "Christopher": a prefix of at least three letters.
  if (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x))) return true;
  return (NICK.get(x) ?? []).includes(y);
}

/** Whether two name records can be the same person: same last name and a compatible first name. */
export function sameName(a, b) {
  return sameLast(a, b) && a.firsts.some((x) => b.firsts.some((y) => sameFirst(x, y)));
}

/** The first letter of a person's name, quoted nicknames aside: "J. D. Ford" and "J.D. Ford" both give "j". */
export function firstInitial(name) {
  return fold(name).replace(/"[^"]*"/g, " ").replace(/[^a-z\s]/g, " ").trim()[0] ?? "";
}

/** The spellings to look a candidate up by, with their own capitals: "First Last", the nickname and middle-name forms. */
export function lookupNames(name) {
  const nicks = [...name.matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1].replace(/\bDr\b\.?/gi, " ").replace(/\b(Jr|Sr)\b\.?/gi, " ").trim().split(/\s+/)[0]).filter(Boolean);
  const tokens = name
    .replace(/["“][^"”]*["”]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter((t) => t && !SUFFIX.test(fold(t).replace(/\./g, "")));
  let i = tokens.length - 1;
  while (i > 0 && PARTICLE.test(fold(tokens[i - 1]))) i -= 1;
  const last = tokens.slice(i).join(" ");
  const given = tokens.slice(0, i).filter((t) => t.replace(/\./g, "").length > 1);
  const firsts = [given[0], ...nicks].filter(Boolean);
  // "Michael" is also looked up as "Mike": state ties still have to match, so this only widens the search.
  const alternates = firsts.flatMap((f) => (NICK.get(fold(f)) ?? []).map((n) => n[0].toUpperCase() + n.slice(1)));
  return [...new Set([...firsts, ...alternates].map((f) => `${f} ${last}`))];
}

/** The race a candidate photo belongs to, in the same form as raceKey in lib/midterms/odds.ts. */
export const raceKey = (office, state, district) => `${office}:${state}:${office === "house" ? (district ?? 0) : ""}`;
