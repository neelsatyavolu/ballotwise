// Copies MapLibre's map worker into public/, where the past-results map points it (components/midterms/past/PastMap.tsx).
// MapLibre looks for the worker beside its own module, which the bundler doesn't carry along. Runs before dev and build.
import { copyFileSync, mkdirSync } from "node:fs";

const out = new URL("../public/midterms/vendor/", import.meta.url);
mkdirSync(out, { recursive: true });
copyFileSync(new URL("../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url), new URL("maplibre-gl-worker.mjs", out));
