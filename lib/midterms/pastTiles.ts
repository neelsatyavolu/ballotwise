// Serves the past-results precinct map tiles from R2 (custom-worker.ts routes /midterms/past-tiles/ here).

/**
 * The past-results precinct maps, one PMTiles file per election in R2. The map reads each file in byte ranges, so a
 * request with a Range header gets just that slice. Files are rebuilt under the same name rarely, so browsers keep
 * them a day and revalidate by ETag.
 */
export async function pastTiles(request: Request, bucket: R2Bucket, key: string): Promise<Response> {
  if (!/^[\w-]+\.pmtiles$/.test(key)) return new Response("Not found", { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  const headersFor = (object: R2Object) =>
    new Headers({ ETag: object.httpEtag, "Cache-Control": "public, max-age=86400", "Accept-Ranges": "bytes", "Content-Type": "application/vnd.pmtiles" });
  if (request.method === "HEAD") {
    const object = await bucket.head(key);
    if (!object) return new Response(null, { status: 404 });
    const headers = headersFor(object);
    headers.set("Content-Length", String(object.size));
    return new Response(null, { headers });
  }
  let object: R2Object | R2ObjectBody | null;
  try {
    object = await bucket.get(key, { range: request.headers, onlyIf: request.headers });
  } catch (err) {
    // R2 rejects a range past the end of the file or a multi-range request.
    console.error("past tiles read failed:", key, request.headers.get("range"), err instanceof Error ? err.message : err);
    return new Response("Range not satisfiable", { status: 416 });
  }
  if (!object) return new Response("Not found", { status: 404 });
  const headers = headersFor(object);
  // A failed precondition hands back metadata only: "not modified" for a cache check, otherwise "precondition failed".
  if (!("body" in object)) {
    const cacheCheck = request.headers.has("if-none-match") || request.headers.has("if-modified-since");
    return new Response(null, { status: cacheCheck ? 304 : 412, headers });
  }
  const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && request.headers.has("range")) {
    const offset = range.suffix !== undefined ? object.size - range.suffix : (range.offset ?? 0);
    const length = range.suffix !== undefined ? range.suffix : (range.length ?? object.size - offset);
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { headers });
}
