"""Live tests against https://7it.co.il/7maps/mcp. The user-agent marks them as test traffic.

Run from packages/guard-py:  python -m unittest discover -s tests -v
"""

import asyncio
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import sevenmaps_guard as g  # noqa: E402

UA = "mcp-smoke/guard-test"


class GuardLive(unittest.TestCase):
    def test_stripe_returns_verdict(self):
        v = g.guard("https://mcp.stripe.com", cache_seconds=0, user_agent=UA)
        self.assertIsInstance(v["allow"], bool)
        self.assertIsInstance(v["reason"], str)
        self.assertTrue(v["condition"] is None or isinstance(v["condition"], dict))
        print("\nstripe verdict:", v["allow"], v["reason"])

    def test_fake_host_fails_open(self):
        v = g.guard("https://nonexistent-7maps-test.invalid/mcp", cache_seconds=0, user_agent=UA)
        self.assertTrue(v["allow"])
        print("\nfake host verdict:", v["allow"], v["reason"])

    def test_7maps_unreachable_fails_open(self):
        v = g.guard("https://mcp.stripe.com", cache_seconds=0, user_agent=UA,
                    endpoint="https://nonexistent-7maps-test.invalid/mcp", timeout=3)
        self.assertEqual(v, {"allow": True, "reason": g.UNAVAILABLE, "condition": None, "watch": None})

    def test_report_returns_at_once_and_ends_within_3s(self):
        t0 = time.monotonic()
        th = g.report("https://10.255.255.1/mcp", False, tool="guard_test", fail="timeout",
                      endpoint="https://10.255.255.1/mcp", user_agent=UA)
        self.assertLess(time.monotonic() - t0, 0.5)
        th.join(4)
        self.assertFalse(th.is_alive())


class Helpers(unittest.TestCase):
    def test_clean_server(self):
        self.assertEqual(g.clean_server("https://u:p@mcp.example.com/mcp?key=secret#x"), "https://mcp.example.com/mcp")
        self.assertEqual(g.clean_server("pypi:some-server"), "pypi:some-server")

    def test_telemetry_opt_in(self):
        old = os.environ.pop("SEVENMAPS_TELEMETRY", None)
        try:
            self.assertFalse(g.telemetry_enabled())
            self.assertTrue(g.telemetry_enabled(True))
            os.environ["SEVENMAPS_TELEMETRY"] = "1"
            self.assertTrue(g.telemetry_enabled())
            self.assertFalse(g.telemetry_enabled(False))
        finally:
            os.environ.pop("SEVENMAPS_TELEMETRY", None)
            if old is not None:
                os.environ["SEVENMAPS_TELEMETRY"] = old

    def test_guarded_call_with_fake_session(self):
        class Session:
            async def call_tool(self, name, arguments=None):
                return type("R", (), {"isError": False, "name": name})()

        async def run():
            # check=False: no network; telemetry off: nothing is sent.
            return await g.guarded_call(Session(), "https://mcp.example.com/mcp", "echo", {}, check=False, telemetry=False)

        r = asyncio.run(run())
        self.assertEqual(r.name, "echo")


try:
    import mcp  # noqa: F401
    HAVE_MCP = True
except ImportError:
    HAVE_MCP = False


@unittest.skipUnless(HAVE_MCP, "the mcp package is not installed")
class RealSession(unittest.TestCase):
    def test_guarded_call_with_real_client_session(self):
        from mcp import ClientSession
        from mcp.client import streamable_http as sh

        url = "https://7it.co.il/7maps/mcp?via=guard-test"

        def transport():
            if hasattr(sh, "streamable_http_client"):  # mcp 2.x
                import httpx2
                return sh.streamable_http_client(url, http_client=httpx2.AsyncClient(headers={"user-agent": UA}))
            return sh.streamablehttp_client(url, headers={"user-agent": UA})  # mcp 1.x

        async def run():
            async with transport() as streams:
                async with ClientSession(streams[0], streams[1]) as session:
                    await session.initialize()
                    return await g.guarded_call(session, url, "about_7maps", {}, telemetry=False)

        r = asyncio.run(run())
        self.assertFalse(getattr(r, "is_error", None) or getattr(r, "isError", None))


if __name__ == "__main__":
    unittest.main(verbosity=2)
