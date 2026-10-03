"""7Maps sensor for IBM ContextForge (mcp-context-forge), as a native cpex plugin.

Hooks tool_pre_invoke (notes the start time in the plugin's per-request state) and
tool_post_invoke (reads the upstream server URL from the gateway metadata, the tool's original name
from the tool metadata and isError from the result, then records {server, ok, fail, ms, tool, at}
on the shared reporter). It never changes the payload, never blocks a call, and never reads
arguments, result content, users or tenants. Off unless SEVENMAPS_SENSOR=1 (or config enabled: true).

plugins/config.yaml:
  - name: "SevenMapsSensor"
    kind: "sevenmaps_sensor_contextforge.SevenMapsSensorPlugin"
    hooks: ["tool_pre_invoke", "tool_post_invoke"]
    mode: "transform"
    priority: 1000
"""

import time
from typing import Any, Optional

from sevenmaps_sensor import get_reporter

# The plugin framework moved to the cpex package after ContextForge 1.0.0 (docs: using/plugins/
# migration-to-cpex.md). Older gateways that import from mcpgateway.plugins.framework are not supported.
from cpex.framework import (Plugin, PluginConfig, PluginContext, ToolPostInvokePayload, ToolPostInvokeResult,
                            ToolPreInvokePayload, ToolPreInvokeResult)
from cpex.framework.constants import GATEWAY_METADATA, TOOL_METADATA

__all__ = ["SevenMapsSensorPlugin"]

_STATE = "sevenmaps_t0"


def _get(obj: Any, name: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


class SevenMapsSensorPlugin(Plugin):
    def __init__(self, config: PluginConfig) -> None:
        super().__init__(config)
        cfg = (getattr(config, "config", None) or {}) if config is not None else {}
        enabled = cfg.get("enabled") if isinstance(cfg.get("enabled"), bool) else None
        self.reporter = get_reporter("contextforge", enabled=enabled)

    async def tool_pre_invoke(self, payload: ToolPreInvokePayload, context: PluginContext) -> ToolPreInvokeResult:
        try:
            context.set_state(_STATE, time.monotonic())
        except Exception:
            pass
        return ToolPreInvokeResult(continue_processing=True)

    async def tool_post_invoke(self, payload: ToolPostInvokePayload, context: PluginContext) -> ToolPostInvokeResult:
        try:
            self._record(payload, context)
        except Exception:
            pass  # a sensor never breaks the gateway
        return ToolPostInvokeResult(continue_processing=True)

    def _record(self, payload: Any, context: Any) -> None:
        meta = _get(_get(context, "global_context"), "metadata") or {}
        gw, tool = meta.get(GATEWAY_METADATA), meta.get(TOOL_METADATA)
        url = _get(gw, "url") or _get(tool, "url")
        if not url or (tool is not None and str(_get(tool, "integration_type") or "MCP").upper() != "MCP"):
            return  # REST integrations are not MCP servers
        name = _get(tool, "original_name") or _get(payload, "name")
        result = _get(payload, "result")
        is_err = bool(_get(result, "isError") or _get(result, "is_error"))
        t0: Optional[float] = None
        try:
            t0 = context.get_state(_STATE, None)
        except Exception:
            pass
        ms = (time.monotonic() - t0) * 1000 if isinstance(t0, (int, float)) else None
        # A result with isError is a failed call without a transport reason: no fail value.
        self.reporter.record(str(url), not is_err, ms=ms, tool=name if isinstance(name, str) else None)
