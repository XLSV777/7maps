"""Local tests of the LiteLLM adapter: LiteLLM-shaped kwargs, a recording reporter, no network.

Run from packages/sensor-litellm:  python -m unittest discover -s tests -v
(needs packages/sensor-py next to it, or sevenmaps-sensor installed; LiteLLM itself is not needed)
"""

import asyncio
import json
import os
import sys
import unittest
from datetime import datetime, timedelta

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "..", "sensor-py"))

import sevenmaps_sensor_litellm as adapter  # noqa: E402


class Recorder:
    def __init__(self):
        self.calls = []

    def record(self, server, ok, fail=None, ms=None, tool=None, at=None):
        self.calls.append({"server": server, "ok": ok, "fail": fail, "ms": ms, "tool": tool})
        return True


class MCPToolResultError(Exception):
    pass


def kwargs(server="deepwiki", tool="read_wiki_structure", **extra):
    # The shape LiteLLM passes: model_call_details with mcp_tool_call_metadata (StandardLoggingMCPToolCall).
    return {"call_type": "call_mcp_tool", "mcp_tool_call_metadata": {
        "name": tool, "arguments": {"repo": "private/repo"}, "result": {"content": "private"},
        "mcp_server_name": server, "namespaced_tool_name": server + "-" + tool}, "litellm_params": {"api_key": "sk-secret"}, **extra}


class LiteLLMAdapterTests(unittest.TestCase):
    def setUp(self):
        self.rec = Recorder()
        self.sensor = adapter.SevenMapsSensor(servers={"deepwiki": "https://mcp.deepwiki.com/mcp"}, reporter=self.rec)
        self.t0 = datetime(2026, 10, 3, 12, 0, 0)

    def run_(self, coro):
        asyncio.run(coro)

    def test_success(self):
        self.run_(self.sensor.async_log_success_event(kwargs(), None, self.t0, self.t0 + timedelta(milliseconds=420)))
        self.assertEqual(self.rec.calls, [{"server": "https://mcp.deepwiki.com/mcp", "ok": True, "fail": None, "ms": 420.0, "tool": "read_wiki_structure"}])

    def test_is_error_result_has_no_reason(self):
        self.run_(self.sensor.async_log_failure_event(kwargs(exception=MCPToolResultError("x")), None, self.t0, self.t0 + timedelta(seconds=1)))
        self.assertEqual((self.rec.calls[0]["ok"], self.rec.calls[0]["fail"]), (False, None))

    def test_exception_maps_to_reason(self):
        self.run_(self.sensor.async_log_failure_event(kwargs(exception=TimeoutError("timed out")), None, self.t0, self.t0 + timedelta(seconds=30)))
        self.assertEqual(self.rec.calls[0]["fail"], "timeout")

    def test_unmapped_alias_and_non_mcp_calls_are_not_sent(self):
        self.run_(self.sensor.async_log_success_event(kwargs(server="internal-alias"), None, self.t0, self.t0))
        self.run_(self.sensor.async_log_success_event({"call_type": "acompletion", "model": "gpt"}, None, self.t0, self.t0))
        self.assertEqual(self.rec.calls, [])

    def test_registry_name_or_url_used_as_is(self):
        self.run_(self.sensor.async_log_success_event(kwargs(server="io.github.acme/thing"), None, self.t0, self.t0))
        self.assertEqual(self.rec.calls[0]["server"], "io.github.acme/thing")

    def test_standard_logging_object_path(self):
        k = kwargs()
        meta = k.pop("mcp_tool_call_metadata")
        k["standard_logging_object"] = {"metadata": {"mcp_tool_call_metadata": meta}}
        self.run_(self.sensor.async_log_success_event(k, None, self.t0, self.t0))
        self.assertEqual(len(self.rec.calls), 1)

    def test_nothing_private_reaches_the_reporter(self):
        self.run_(self.sensor.async_log_success_event(kwargs(), {"content": "private"}, self.t0, self.t0))
        blob = json.dumps(self.rec.calls)
        for word in ("private", "sk-secret", "arguments"):
            self.assertNotIn(word, blob)

    def test_env_server_map(self):
        os.environ["SEVENMAPS_SENSOR_SERVERS"] = "a=https://a.example/mcp,b=https://b.example/mcp"
        try:
            self.assertEqual(adapter.SevenMapsSensor(reporter=self.rec).servers["b"], "https://b.example/mcp")
        finally:
            del os.environ["SEVENMAPS_SENSOR_SERVERS"]

    def test_off_by_default(self):
        os.environ.pop("SEVENMAPS_SENSOR", None)
        self.assertFalse(adapter.SevenMapsSensor().reporter.enabled)


if __name__ == "__main__":
    unittest.main()
