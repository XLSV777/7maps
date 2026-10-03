"""Local tests of the ContextForge plugin with stand-ins for the cpex classes it uses; no network.

Run from packages/sensor-contextforge:  python -m unittest discover -s tests -v
(needs packages/sensor-py next to it, or sevenmaps-sensor installed; cpex itself is not needed)
"""

import asyncio
import json
import os
import sys
import types
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "..", "sensor-py"))

# Minimal stand-ins shaped like the documented cpex API (docs/docs/using/plugins/index.md).
fw = types.ModuleType("cpex.framework")
consts = types.ModuleType("cpex.framework.constants")
consts.GATEWAY_METADATA, consts.TOOL_METADATA = "gateway", "tool"


class _Result:
    def __init__(self, continue_processing=True, modified_payload=None):
        self.continue_processing, self.modified_payload = continue_processing, modified_payload


class Plugin:
    def __init__(self, config):
        self._config = config


class PluginContext:
    def __init__(self, metadata):
        self.state = {}
        self.global_context = types.SimpleNamespace(metadata=metadata, state={}, user="alice", tenant_id="t1")

    def set_state(self, k, v):
        self.state[k] = v

    def get_state(self, k, default=None):
        return self.state.get(k, default)


for name in ("ToolPreInvokeResult", "ToolPostInvokeResult"):
    setattr(fw, name, _Result)
fw.Plugin, fw.PluginContext = Plugin, PluginContext
fw.PluginConfig = fw.ToolPreInvokePayload = fw.ToolPostInvokePayload = object
sys.modules.update({"cpex": types.ModuleType("cpex"), "cpex.framework": fw, "cpex.framework.constants": consts})

import sevenmaps_sensor_contextforge as cf  # noqa: E402


class Recorder:
    def __init__(self):
        self.calls = []

    def record(self, server, ok, fail=None, ms=None, tool=None, at=None):
        self.calls.append({"server": server, "ok": ok, "fail": fail, "ms": ms, "tool": tool})
        return True


def ctx(integration="MCP"):
    tool = types.SimpleNamespace(original_name="search_docs", url="https://tools.example.com/rest", integration_type=integration)
    gw = types.SimpleNamespace(name="docs-gw", transport="streamablehttp", url="https://mcp.docs.example.com/mcp")
    return PluginContext({"tool": tool, "gateway": gw})


class ContextForgeTests(unittest.TestCase):
    def setUp(self):
        self.plugin = cf.SevenMapsSensorPlugin(types.SimpleNamespace(config={}))
        self.rec = self.plugin.reporter = Recorder()

    def call(self, context, result):
        async def go():
            pre = await self.plugin.tool_pre_invoke(types.SimpleNamespace(name="docs-gw-search-docs", args={"q": "private"}), context)
            post = await self.plugin.tool_post_invoke(types.SimpleNamespace(name="docs-gw-search-docs", result=result), context)
            return pre, post
        return asyncio.run(go())

    def test_ok_call(self):
        pre, post = self.call(ctx(), {"content": [{"type": "text", "text": "private"}], "isError": False})
        self.assertTrue(pre.continue_processing and post.continue_processing)
        self.assertIsNone(post.modified_payload)
        c = self.rec.calls[0]
        self.assertEqual((c["server"], c["ok"], c["tool"]), ("https://mcp.docs.example.com/mcp", True, "search_docs"))
        self.assertIsInstance(c["ms"], float)

    def test_is_error(self):
        self.call(ctx(), {"content": [], "isError": True})
        self.assertEqual((self.rec.calls[0]["ok"], self.rec.calls[0]["fail"]), (False, None))

    def test_rest_integration_not_sent(self):
        self.call(ctx("REST"), {"isError": False})
        self.assertEqual(self.rec.calls, [])

    def test_nothing_private(self):
        self.call(ctx(), {"content": [{"type": "text", "text": "private"}], "isError": False})
        blob = json.dumps(self.rec.calls)
        for word in ("private", "alice", "t1"):
            self.assertNotIn(word, blob)

    def test_broken_context_never_raises(self):
        async def go():
            return await self.plugin.tool_post_invoke(types.SimpleNamespace(name="x", result=None), object())
        self.assertTrue(asyncio.run(go()).continue_processing)
        self.assertEqual(self.rec.calls, [])


if __name__ == "__main__":
    unittest.main()
