"""Local tests with a mock server; nothing is sent to 7Maps.

Run from packages/sensor-py:  python -m unittest discover -s tests -v   (or python -m pytest tests)
"""

import asyncio
import json
import os
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import sevenmaps_sensor as s  # noqa: E402
from sevenmaps_sensor.mcp_client import wrap_session  # noqa: E402

ALLOWED = {"sensor_id", "kind", "version", "outcomes"}
ALLOWED_O = {"server", "ok", "fail", "ms", "tool", "at"}


class Mock:
    """A stand-in for POST /7maps/sensor: records bodies, answers with `plan` statuses in order."""

    def __init__(self, plan=None):
        self.got, self.plan = [], list(plan or [])
        mock = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                mock.got.append(json.loads(self.rfile.read(n)))
                status = mock.plan.pop(0) if mock.plan else 200
                self.send_response(status)
                if status == 429:
                    self.send_header("Retry-After", "3600")
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *a):
                pass

        self.srv = HTTPServer(("127.0.0.1", 0), H)
        self.url = "http://127.0.0.1:%d/7maps/sensor" % self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()


def reporter(url, **kw):
    return s.Reporter("test-kind", enabled=True, endpoint=url, sensor_id_value="t-unit-test-0000001", flush_seconds=3600, **kw)


class SensorTests(unittest.TestCase):
    def test_off_unless_switched_on(self):
        old = os.environ.pop("SEVENMAPS_SENSOR", None)
        try:
            self.assertFalse(s.sensor_enabled())
            self.assertFalse(s.Reporter("x").record("https://a.example/mcp", True))
            os.environ["SEVENMAPS_SENSOR"] = "1"
            self.assertTrue(s.sensor_enabled())
            os.environ["SEVENMAPS_SENSOR"] = "0"
            self.assertFalse(s.sensor_enabled(True))
        finally:
            os.environ.pop("SEVENMAPS_SENSOR", None)
            if old is not None:
                os.environ["SEVENMAPS_SENSOR"] = old

    def test_wire_format(self):
        self.assertEqual(s.clean_server("https://u:p@mcp.example.com/mcp?api_key=SECRET#x"), "https://mcp.example.com/mcp")
        w = s.to_wire("https://mcp.example.com/mcp?t=1", False, "timeout", 1234.6, "search")
        self.assertEqual(set(w), {"server", "ok", "fail", "ms", "tool", "at"})
        self.assertEqual(w["ms"], 1235)
        self.assertTrue(w["at"].endswith("Z"))
        self.assertIsNone(s.to_wire("x", True))
        self.assertNotIn("tool", s.to_wire("io.github.acme/thing", True, tool="bad name"))
        self.assertNotIn("fail", s.to_wire("io.github.acme/thing", True, fail="timeout"))

    def test_batches_and_allowed_fields(self):
        m = Mock()
        r = reporter(m.url)
        for k in range(150):
            r.record("https://mcp.example.com/mcp", k % 3 != 0, fail=None if k % 3 else "server_error", ms=k, tool="search")
        r.flush(10)
        r.close(2)
        m.close()
        self.assertEqual([len(b["outcomes"]) for b in m.got], [100, 50])
        for b in m.got:
            self.assertTrue(set(b) <= ALLOWED)
            self.assertTrue(all(set(o) <= ALLOWED_O for o in b["outcomes"]))
            self.assertEqual(b["kind"], "test-kind")
        self.assertEqual(r.stats["sent"], 150)

    def test_record_never_blocks_and_drops_when_full(self):
        r = s.Reporter("test-kind", enabled=True, endpoint="http://127.0.0.1:9/never", sensor_id_value="t-unit-test-0000001",
                       flush_seconds=3600, max_queue=10, max_retries=0, timeout=0.2)
        t0 = time.perf_counter()
        accepted = sum(1 for _ in range(1000) if r.record("https://mcp.example.com/mcp", True))
        elapsed = time.perf_counter() - t0
        self.assertLessEqual(accepted, 10)
        self.assertGreaterEqual(r.stats["dropped"], 990)
        self.assertLess(elapsed, 0.5)
        self.assertFalse(r.record(None, True))
        r._stop.set()

    def test_retry_with_backoff(self):
        m = Mock([500, 200])
        r = reporter(m.url, max_retries=3)
        r.record("https://mcp.example.com/mcp", True)
        t0 = time.monotonic()
        r.flush(10)
        m.close()
        self.assertEqual(len(m.got), 2)
        self.assertEqual(r.stats["sent"], 1)
        self.assertGreaterEqual(time.monotonic() - t0, 0.45)
        r._stop.set()

    def test_429_pauses_and_400_drops(self):
        m = Mock([429, 400])
        r = reporter(m.url)
        r.record("https://mcp.example.com/mcp", True)
        r.flush(5)
        self.assertGreater(r._paused_until, time.time() + 3000)
        r._paused_until = 0
        r.record("https://mcp.example.com/mcp", True)
        r.flush(5)
        m.close()
        self.assertEqual(len(m.got), 2)
        self.assertEqual(r.stats["refused_batches"], 2)
        self.assertEqual(r.stats["sent"], 0)
        r._stop.set()

    def test_mcp_session_adapter(self):
        m = Mock()
        r = reporter(m.url)

        class Result:
            def __init__(self, err):
                self.isError = err
                self.content = "private"

        class Session:
            async def call_tool(self, name, arguments=None, **kw):
                if name == "boom":
                    raise TimeoutError("timed out")
                return Result(name == "bad")

        sess = wrap_session(Session(), "https://mcp.example.com/mcp?key=secret", reporter=r)

        async def run():
            res = await sess.call_tool("search", {"q": "private"})
            self.assertEqual(res.content, "private")
            await sess.call_tool("bad", {})
            with self.assertRaises(TimeoutError):
                await sess.call_tool("boom", {})

        asyncio.run(run())
        r.flush(10)
        m.close()
        outs = [o for b in m.got for o in b["outcomes"]]
        self.assertEqual([(o["ok"], o.get("fail"), o["tool"]) for o in outs], [(True, None, "search"), (False, None, "bad"), (False, "timeout", "boom")])
        self.assertNotIn("private", json.dumps(m.got))
        self.assertNotIn("secret", json.dumps(m.got))
        r._stop.set()

    def test_fail_reason(self):
        class E(Exception):
            status_code = 401
        self.assertEqual(s.fail_reason(E("x")), "auth")
        self.assertEqual(s.fail_reason(Exception("429 Too Many Requests")), "rate_limited")
        self.assertEqual(s.fail_reason(ConnectionRefusedError("no")), "unreachable")
        self.assertEqual(s.fail_reason(Exception("kaput")), "server_error")


if __name__ == "__main__":
    unittest.main()
