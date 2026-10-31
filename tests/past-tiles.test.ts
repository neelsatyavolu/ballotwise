import { describe, expect, it } from "vitest";
import { pastTiles } from "../lib/midterms/pastTiles";

const FILE = new TextEncoder().encode("0123456789");
const ETAG = '"abc"';

/** A stand-in for the R2 bucket that reads ranges and conditions from the request's headers, as R2 does. */
function bucket(): R2Bucket {
  const meta = { key: "2024-president.pmtiles", size: FILE.length, httpEtag: ETAG, etag: "abc" };
  const get = async (key: string, opts?: { range?: Headers; onlyIf?: Headers }) => {
    if (key !== meta.key) return null;
    if (opts?.onlyIf?.get("if-none-match") === ETAG || (opts?.onlyIf?.get("if-match") && opts.onlyIf.get("if-match") !== ETAG)) return { ...meta };
    const header = opts?.range?.get("range");
    let range: { offset: number; length: number } | { suffix: number } | undefined;
    let bytes = FILE;
    if (header) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(header);
      if (!m) throw new Error("bad range");
      if (!m[1]) {
        range = { suffix: Number(m[2]) };
        bytes = FILE.slice(FILE.length - Number(m[2]));
      } else {
        const start = Number(m[1]);
        if (start >= FILE.length) throw new Error("range past the end");
        const end = m[2] ? Math.min(Number(m[2]), FILE.length - 1) : FILE.length - 1;
        range = { offset: start, length: end - start + 1 };
        bytes = FILE.slice(start, end + 1);
      }
    }
    return { ...meta, range, body: new Response(bytes).body };
  };
  return { get, head: async (key: string) => (key === meta.key ? { ...meta } : null) } as unknown as R2Bucket;
}

const req = (headers: Record<string, string> = {}, method = "GET") => new Request("https://x/midterms/past-tiles/2024-president.pmtiles", { method, headers });

describe("pastTiles", () => {
  it("serves a byte range with its Content-Range", async () => {
    const res = await pastTiles(req({ range: "bytes=2-5" }), bucket(), "2024-president.pmtiles");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await res.text()).toBe("2345");
  });

  it("serves a suffix range from the end of the file", async () => {
    const res = await pastTiles(req({ range: "bytes=-3" }), bucket(), "2024-president.pmtiles");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(await res.text()).toBe("789");
  });

  it("serves the whole file without a range", async () => {
    const res = await pastTiles(req(), bucket(), "2024-president.pmtiles");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0123456789");
  });

  it("answers a cache check with 304 and a failed If-Match with 412", async () => {
    expect((await pastTiles(req({ "if-none-match": ETAG }), bucket(), "2024-president.pmtiles")).status).toBe(304);
    expect((await pastTiles(req({ "if-match": '"other"' }), bucket(), "2024-president.pmtiles")).status).toBe(412);
  });

  it("refuses a range R2 can't serve, a missing file and a bad name", async () => {
    expect((await pastTiles(req({ range: "bytes=50-60" }), bucket(), "2024-president.pmtiles")).status).toBe(416);
    expect((await pastTiles(req(), bucket(), "1990-president.pmtiles")).status).toBe(404);
    expect((await pastTiles(req(), bucket(), "../secrets.pmtiles")).status).toBe(404);
  });

  it("answers HEAD with the size and no body", async () => {
    const res = await pastTiles(req({}, "HEAD"), bucket(), "2024-president.pmtiles");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.body).toBeNull();
  });
});
