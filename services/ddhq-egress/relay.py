"""Private transport for a single request's Votes session; no result or cookie store."""

import asyncio
import json
import re
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlsplit

ORIGIN = "https://votes.decisiondeskhq.com"
MAX_BODY_BYTES = 12 * 1024 * 1024
# libcurl's write callback abort value; returning zero is ignored by curl_cffi.
CURL_WRITEFUNC_ERROR = 0xFFFFFFFF
PRIVATE = {"cache-control": "private, no-store"}
SEARCH_KEYS = {"q", "filterYear", "filterState", "filterOffice"}
AUTH_STATUSES = {"signed-in", "signed-out", "handshake"}


@dataclass
class Reply:
    status: int
    body: bytes
    headers: dict[str, str]


def error(status=502):
    return Reply(status, b'{"error":"Votes transport unavailable"}', {**PRIVATE, "content-type": "application/json"})


def valid_path(path):
    if len(path) > 2048 or re.search(r"[\x00-\x20\x7f\\#]", path):
        return False
    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc or "%" in parsed.path:
        return False
    try:
        pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True, max_num_fields=4)
    except ValueError:
        return False
    query = dict(pairs)
    if len(query) != len(pairs):
        return False
    if re.fullmatch(r"/forecast/2026/(house|senate|governor)", parsed.path):
        return not query
    if re.fullmatch(r"/api/(forecast|races)/[0-9]+", parsed.path):
        return not query
    if parsed.path == "/api/races/batch/topline":
        return set(query) == {"ids"} and bool(re.fullmatch(r"[0-9]+(?:,[0-9]+){0,23}", query["ids"]))
    if parsed.path == "/api/vote-history":
        return set(query) == {"race_id"} and bool(re.fullmatch(r"[0-9]+", query["race_id"]))
    return parsed.path == "/api/searchv2" and set(query) == SEARCH_KEYS and all(query.values())


async def relay(client, method, path, cookie):
    if method != "GET" or not valid_path(path) or len(cookie) > 8192 or not re.fullmatch(r"__session=[A-Za-z0-9._-]+", cookie):
        return error(400)
    body = bytearray()
    page = path.startswith("/forecast/2026/")
    content_type = "text/x-component" if page else "application/json"

    def receive(chunk):
        if len(body) + len(chunk) > MAX_BODY_BYTES:
            return CURL_WRITEFUNC_ERROR
        body.extend(chunk)
        return len(chunk)

    try:
        # Includes time waiting for a free handle in the warm client's pool.
        async with asyncio.timeout(25):
            upstream = await client.get(
                ORIGIN + path,
                headers={
                    "accept": content_type,
                    **({"RSC": "1"} if page else {}),
                    "referer": ORIGIN + "/",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-origin",
                    "cookie": cookie,
                    "authorization": "Bearer " + cookie.removeprefix("__session="),
                },
                allow_redirects=False,
                discard_cookies=True,
                timeout=20,
                content_callback=receive,
            )
        if 300 <= upstream.status_code < 400:
            return error()
        if 200 <= upstream.status_code < 300 and upstream.headers.get("x-vercel-mitigated") != "challenge":
            if upstream.headers.get("content-type", "").split(";")[0].strip().lower() != content_type:
                return error()
            if not page:
                json.loads(body)
        headers = dict(PRIVATE)
        for key in ("content-type", "x-vercel-mitigated", "retry-after"):
            if value := upstream.headers.get(key):
                headers[key] = value
        if upstream.headers.get("x-clerk-auth-status") in AUTH_STATUSES:
            headers["x-clerk-auth-status"] = upstream.headers["x-clerk-auth-status"]
        return Reply(upstream.status_code, bytes(body), headers)
    except Exception:
        # Exceptions can contain request details. Never log or return them.
        return error()


def create_app():
    from aiohttp import web
    from curl_cffi.requests import AsyncSession

    client = None
    app = web.Application(client_max_size=1)

    async def lifetime(_app):
        nonlocal client
        async with AsyncSession(impersonate="chrome131", max_clients=8, discard_cookies=True, trust_env=False, retry=0) as client:
            yield

    async def handle(request):
        cookies = request.headers.getall("cookie", [])
        if len(cookies) != 1 or request.can_read_body:
            result = error(400)
        else:
            result = await relay(client, request.method, request.raw_path, cookies[0])
        return web.Response(status=result.status, body=result.body, headers=result.headers)

    app.cleanup_ctx.append(lifetime)
    app.router.add_route("*", "/{path:.*}", handle)
    return app


if __name__ == "__main__":
    from aiohttp import web

    # aiohttp handles SIGTERM and closes the warm client through cleanup_ctx.
    web.run_app(create_app(), host="0.0.0.0", port=8080, access_log=None, print=None)
