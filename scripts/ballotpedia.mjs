// Reading Ballotpedia's 2026 race pages for scripts/build-photos.mjs, kept apart so tests can check it without
// fetching anything. Each race page lists the race's candidates with the headshot their campaign gave Ballotpedia;
// that list is what ties a photo to the right person in the right race.

const ORDINAL = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** The titles Ballotpedia may give its page on a race's 2026 election, most likely first, spaces as underscores. */
export function raceTitles(race, state) {
  const titles =
    race.office === "governor"
      ? [`${state} gubernatorial and lieutenant gubernatorial election, 2026`, `${state} gubernatorial election, 2026`]
      : race.office === "senate"
        ? [`United States Senate ${/special/i.test(race.title) ? "special " : ""}election in ${state}, 2026`]
        : race.district
          ? // "Texas' 4th", though some pages keep "Texas's".
            [...new Set([`${state}'${state.endsWith("s") ? "" : "s"}`, `${state}'s`])].map((owner) => `${owner} ${ORDINAL(race.district)} Congressional District election, 2026`)
          : [`United States House of Representatives election in ${state}, 2026`];
  return titles.map((t) => t.replace(/ /g, "_"));
}

const decode = (s) => s.replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#160;/g, " ");

/**
 * Everyone in the page's 2026 tables (general, special and primary elections; earlier years are skipped), once
 * each: their name, their Ballotpedia page, their headshot and whether it came from a general election's table.
 * Someone in several tables keeps the first one's photo, which is the general election's, as Ballotpedia lists it first.
 */
export function candidates2026(html) {
  const people = new Map();
  for (const heading of html.matchAll(/<h5[^>]*>[^<]*\b(?:election|primary)\s+for/gi)) {
    const end = html.indexOf("</table>", heading.index);
    const block = html.slice(heading.index, end < 0 ? undefined : end);
    const table = block.indexOf("<table");
    if (table < 0 || !/\b2026\b/.test(block.slice(0, table))) continue;
    const general = /general election for/i.test(heading[0]);
    for (const [row] of block.matchAll(/<tr class="results_row">[\s\S]*?<\/tr>/g)) {
      const img = /<img class="image-candidate-thumbnail" src="([^"]+)"[^>]*title="([^"]+)"/.exec(row);
      const page = /<a href="https:\/\/ballotpedia\.org\/([^"#]+)"/.exec(row);
      if (img && page && !people.has(page[1])) people.set(page[1], { name: decode(img[2]), page: decodeURIComponent(page[1]), image: img[1], general });
    }
  }
  return [...people.values()];
}

/** Images shown for more than one person across the pages read: Ballotpedia's stand-in for someone with no photo. */
export function placeholders(people) {
  const pages = new Map();
  for (const { image, page } of people) {
    const file = image.split("/").at(-1);
    pages.set(file, new Set([...(pages.get(file) ?? []), page]));
  }
  return new Set([...pages].filter(([, p]) => p.size > 1).map(([file]) => file));
}
