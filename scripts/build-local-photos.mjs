// Builds lib/midterms/localPhotos.json and public/midterms/local-photos/: headshots for the local races on a Palo Alto
// ballot, which build-photos.mjs doesn't cover (it rewrites photos.json and clears public/midterms/photos/, so these
// live apart). Each photo is the candidate's own: the City Clerk's candidate pages for the council race, the
// candidates' Ballotpedia pages or campaign sites for the rest. Every face was checked by eye against its source.
// Keys are the race as RaceSummary carries it (state and title) and the candidate's name exactly as the results list it.
// `crop` is the square around the face: centre x and y as fractions of the image (after trimming the City Clerk's
// white letterbox), and the side as a fraction of its shorter side.
// Run with `node scripts/build-local-photos.mjs`.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const OUT = new URL("../public/midterms/local-photos/", import.meta.url);
const PX = 96;
const CLERK = "https://www.paloalto.gov/files/assets/public";
const BALLOTPEDIA = "https://s3.amazonaws.com/ballotpedia-api4/files";
const COUNCIL = "City of Palo Alto Council, 3 seats";
const SCHOOLS = "Palo Alto Unified School District, 2 seats";
const ASSEMBLY = "California State Assembly 23";

const PEOPLE = [
  { race: ASSEMBLY, name: "Marc Berman", url: `${BALLOTPEDIA}/mberman.jpeg`, crop: [0.48, 0.22, 0.33] },
  { race: ASSEMBLY, name: "David G. Johnson", url: "https://content.campaignpartner.net/images/152890/David_J_image_widescreen.png", crop: [0.49, 0.27, 0.3] },
  { race: COUNCIL, name: "Brian Hamachek", url: `${CLERK}/v/1/city-clerk/election-info/2026/brian-hamachek.jpg`, crop: [0.5, 0.33, 0.6] },
  { race: COUNCIL, name: "Bryna Chang", url: `${CLERK}/v/1/city-clerk/election-info/2026/bryna-chang.jpg`, crop: [0.5, 0.33, 0.55] },
  { race: COUNCIL, name: "Ed Lauing", url: `${CLERK}/v/1/city-clerk/election-info/2026/ed-lauing.jpg`, crop: [0.5, 0.33, 0.6] },
  { race: COUNCIL, name: 'Yu "Yudy" Deng', url: `${CLERK}/v/2/city-clerk/election-info/2026/yudy-deng.jpg`, crop: [0.5, 0.33, 0.6] },
  { race: COUNCIL, name: "Raymond L. Goins", url: `${CLERK}/v/2/city-clerk/election-info/2026/raymond-lee-goins.jpg`, crop: [0.5, 0.3, 0.45] },
  { race: COUNCIL, name: "Gary Gechlik", url: `${CLERK}/v/1/city-clerk/election-info/2026/gary-gechlik.jpg`, crop: [0.5, 0.33, 0.85] },
  { race: COUNCIL, name: "Vicki Veenker", url: `${CLERK}/v/1/city-clerk/election-info/2026/vicki-veenker.jpg`, crop: [0.5, 0.35, 0.7] },
  { race: COUNCIL, name: "Henry Etzkowitz", url: `${CLERK}/v/2/city-clerk/election-info/2026/henry-etzkowitz.jpg`, crop: [0.69, 0.45, 0.55] },
  { race: SCHOOLS, name: "Linda Henigin", url: `${BALLOTPEDIA}/Linda_Henigin_2026-09-21_134610.JPG`, crop: [0.5, 0.42, 0.8] },
  { race: SCHOOLS, name: "John Craig", url: `${BALLOTPEDIA}/John-Craig-campaign-portrait_20261007_192717_36411_1.jpg`, crop: [0.5, 0.38, 0.75] },
  { race: SCHOOLS, name: "Avery Wang", url: "https://static.wixstatic.com/media/7ee543_cbf4b719fc9f42b3b533af4ceb36a763~mv2.jpg", crop: [0.49, 0.155, 0.17] },
];

async function headshot({ url, crop: [cx, cy, s] }) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).rotate().trim({ background: "#ffffff", threshold: 20 }).toBuffer({ resolveWithObject: true });
  const side = Math.round(s * Math.min(info.width, info.height));
  const left = Math.max(0, Math.min(info.width - side, Math.round(cx * info.width - side / 2)));
  const top = Math.max(0, Math.min(info.height - side, Math.round(cy * info.height - side / 2)));
  return sharp(data).extract({ left, top, width: side, height: side }).resize(PX, PX).webp({ quality: 75 }).toBuffer();
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const photos = {};
for (const person of PEOPLE) {
  const file = `${person.name.replace(/[^A-Za-z ]/g, "").trim().replace(/\s+/g, "_")}.webp`;
  writeFileSync(new URL(file, OUT), await headshot(person));
  photos[`CA|${person.race}|${person.name}`] = file;
  console.log(person.name, "→", file);
}
writeFileSync(new URL("../lib/midterms/localPhotos.json", import.meta.url), `${JSON.stringify(photos, Object.keys(photos).sort(), 2)}\n`);
