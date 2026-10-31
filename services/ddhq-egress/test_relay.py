import asyncio
import contextlib
import io
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import relay

PATH = "/api/vote-history?race_id=294677"
COOKIE = "__session=test-session"


class Client:
    def __init__(self, status=200, body=b'{"parties":[]}', headers=None, exception=None):
        self.status = status
        self.body = body
        self.headers = {"content-type": "application/json", **(headers or {})}
        self.exception = exception
        self.calls = []

    async def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        await asyncio.sleep(0)
        if self.exception:
            raise self.exception
        if kwargs["content_callback"](self.body) == relay.CURL_WRITEFUNC_ERROR:
            raise ValueError("write callback aborted")
        return SimpleNamespace(status_code=self.status, headers=self.headers)


class RelayTests(unittest.IsolatedAsyncioTestCase):
    async def test_fixed_forecast_pages_use_rsc_with_the_same_private_session(self):
        for office in ["house", "senate", "governor"]:
            client = Client(body=b'1:{"forecasts":[]}', headers={"content-type": "text/x-component"})
            result = await relay.relay(client, "GET", "/forecast/2026/" + office, COOKIE)
            self.assertEqual(result.status, 200)
            self.assertEqual(result.headers["cache-control"], "private, no-store")
            self.assertEqual(client.calls[0][1]["headers"]["RSC"], "1")
            self.assertEqual(client.calls[0][1]["headers"]["authorization"], "Bearer test-session")

    async def test_forecast_page_allowlist_rejects_other_pages_and_html(self):
        for path in ["/forecast/2024/senate", "/forecast/2026/president", "/forecast/2026/senate?user=other"]:
            client = Client()
            self.assertEqual((await relay.relay(client, "GET", path, COOKIE)).status, 400)
            self.assertEqual(client.calls, [])
        self.assertEqual((await relay.relay(Client(body=b"<html>", headers={"content-type": "text/html"}), "GET", "/forecast/2026/senate", COOKIE)).status, 502)

    async def test_allowed_api_shapes(self):
        for path in [PATH, "/api/forecast/294677", "/api/races/294677", "/api/searchv2?q=US+Senate&filterYear=2026&filterState=Georgia&filterOffice=US+Senate"]:
            with self.subTest(path=path):
                client = Client()
                self.assertEqual((await relay.relay(client, "GET", path, COOKIE)).status, 200)
                self.assertEqual(client.calls[0][0], relay.ORIGIN + path)

    async def test_rejects_other_targets_and_query_shapes_before_fetch(self):
        for path in ["https://evil.test/api/races/1", "//evil.test/api/races/1", "/api/races/../1", "/api/races/%31", "/api/races/1?x=1", "/api/searchv2?q=x", PATH + "&url=https://evil.test", PATH + "&race_id=2", PATH + "#fragment", "/api/other", "/api/races/1\r\n", "/api/races/1\\"]:
            with self.subTest(path=path):
                client = Client()
                self.assertEqual((await relay.relay(client, "GET", path, COOKIE)).status, 400)
                self.assertEqual(client.calls, [])

    async def test_requires_one_session_cookie_and_get(self):
        for cookie in ["", "__client=client-token", COOKIE + "; other=x", COOKIE + ", __session=other", COOKIE + "\n", "__session=", "__session=" + "x" * 8192]:
            with self.subTest(cookie_shape=cookie[:10]):
                client = Client()
                self.assertEqual((await relay.relay(client, "GET", PATH, cookie)).status, 400)
                self.assertEqual(client.calls, [])
        client = Client()
        self.assertEqual((await relay.relay(client, "POST", PATH, COOKIE)).status, 400)
        self.assertEqual(client.calls, [])

    async def test_preserves_upstream_statuses(self):
        for status in [200, 401, 403, 404, 429, 502, 503]:
            with self.subTest(status=status):
                result = await relay.relay(Client(status=status), "GET", PATH, COOKIE)
                self.assertEqual(result.status, status)
                self.assertEqual(result.headers["cache-control"], "private, no-store")

    async def test_preserves_challenge_even_when_status_is_200(self):
        result = await relay.relay(Client(body=b"checkpoint", headers={"content-type": "text/html", "x-vercel-mitigated": "challenge"}), "GET", PATH, COOKIE)
        self.assertEqual(result.status, 200)
        self.assertEqual(result.headers["x-vercel-mitigated"], "challenge")

    async def test_strips_response_cookie_and_transport_headers(self):
        result = await relay.relay(Client(headers={"set-cookie": "__session=foreign", "content-encoding": "br", "content-length": "999", "location": "https://evil.test", "retry-after": "30", "x-clerk-auth-message": "private-detail", "x-clerk-auth-reason": "private-reason"}), "GET", PATH, COOKIE)
        self.assertEqual(result.headers, {"cache-control": "private, no-store", "content-type": "application/json", "retry-after": "30"})

    async def test_passes_only_finite_clerk_auth_status_values(self):
        for status in ["signed-in", "signed-out", "handshake", "unexpected", "signed-in private-detail", ""]:
            with self.subTest(status=status):
                result = await relay.relay(Client(status=403, headers={"x-clerk-auth-status": status}), "GET", PATH, COOKIE)
                self.assertEqual(result.status, 403)
                if status in {"signed-in", "signed-out", "handshake"}:
                    self.assertEqual(result.headers["x-clerk-auth-status"], status)
                else:
                    self.assertNotIn("x-clerk-auth-status", result.headers)

    async def test_refuses_redirects_without_following(self):
        for status in [301, 302, 303, 307, 308]:
            client = Client(status=status, headers={"location": "https://clerk.decisiondeskhq.com/v1/client/handshake"})
            self.assertEqual((await relay.relay(client, "GET", PATH, COOKIE)).status, 502)
            self.assertEqual(len(client.calls), 1)
            self.assertFalse(client.calls[0][1]["allow_redirects"])

    async def test_rejects_non_json_success(self):
        for headers, body in [({"content-type": "text/html"}, b"checkpoint"), ({}, b"invalid json")]:
            self.assertEqual((await relay.relay(Client(headers=headers, body=body), "GET", PATH, COOKIE)).status, 502)

    async def test_bounds_response_body(self):
        with patch.object(relay, "MAX_BODY_BYTES", 8):
            self.assertEqual((await relay.relay(Client(body=b"x" * 9), "GET", PATH, COOKIE)).status, 502)

    async def test_concurrent_users_keep_distinct_headers(self):
        client = Client(headers={"set-cookie": "__session=server-cookie"})
        cookies = ["__session=user-a", "__session=user-b"]
        results = await asyncio.gather(*(relay.relay(client, "GET", PATH, cookie) for cookie in cookies))
        self.assertTrue(all(result.status == 200 for result in results))
        self.assertEqual([call[1]["headers"]["cookie"] for call in client.calls], cookies)
        self.assertEqual([call[1]["headers"]["authorization"] for call in client.calls], ["Bearer user-a", "Bearer user-b"])
        self.assertIsNot(client.calls[0][1]["headers"], client.calls[1][1]["headers"])
        for _, kwargs in client.calls:
            self.assertTrue(kwargs["discard_cookies"])
            self.assertEqual(kwargs["headers"]["sec-fetch-dest"], "empty")
            self.assertNotIn("cookies", kwargs)
            self.assertEqual(kwargs["timeout"], 20)

    async def test_derives_bearer_from_validated_session_only(self):
        client = Client()
        await relay.relay(client, "GET", PATH, "__session=header.payload.signature")
        headers = client.calls[0][1]["headers"]
        self.assertEqual(headers["cookie"], "__session=header.payload.signature")
        self.assertEqual(headers["authorization"], "Bearer header.payload.signature")

    async def test_failures_are_redacted_and_not_logged(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            for exception in [TimeoutError("__session=secret"), ValueError("client-jwt")]:
                result = await relay.relay(Client(exception=exception), "GET", PATH, COOKIE)
                self.assertEqual(result.status, 502)
                self.assertNotIn(b"secret", result.body)
                self.assertNotIn(b"client-jwt", result.body)
        self.assertEqual(output.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
