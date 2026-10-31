#!/usr/bin/env bash
# Uploads the past-results precinct tiles (scripts/build-precincts.mjs) to R2, where custom-worker.ts serves them.
# Pass election ids to upload just those: scripts/upload-precincts.sh 2024-president
set -euo pipefail
cd "$(dirname "$0")/.."
ids=("$@")
if [ ${#ids[@]} -eq 0 ]; then
  for f in .cache/precincts/tiles/*.pmtiles; do ids+=("$(basename "$f" .pmtiles)"); done
fi
for id in "${ids[@]}"; do
  npx wrangler r2 object put "ballotwise-past-tiles/$id.pmtiles" --file ".cache/precincts/tiles/$id.pmtiles" \
    --content-type application/vnd.pmtiles --remote
done
