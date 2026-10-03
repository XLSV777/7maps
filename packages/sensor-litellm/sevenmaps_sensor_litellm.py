"""7Maps sensor for the LiteLLM proxy's MCP gateway.

A LiteLLM CustomLogger. LiteLLM calls async_log_success_event / async_log_failure_event for every
MCP tool call it forwards (call_type "call_mcp_tool"), with kwargs["mcp_tool_call_metadata"]
holding the tool name and the LiteLLM server name, and start_time / end_time. This logger reads
only those, maps the LiteLLM server name to the server's public URL (or registry name) you list
in SEVENMAPS_SENSOR_SERVERS, and records {server, ok, fail, ms, tool, at} on the shared reporter.
It never reads arguments, results, keys, users or headers. Off unless SEVENMAPS_SENSOR=1.

proxy config.yaml:
    litellm_settings:
      callbacks: sevenmaps_sensor_litellm.sensor
"""

import json
import os
import re
from typing import Any, Dict, Optional

from sevenmaps_sensor import Reporter, fail_reason, get_reporter

try:  # LiteLLM is present inside the proxy; the fallback keeps this importable in tests.
    from litellm.integrations.custom_logger import CustomLogger
except Exception:  # pragma: no cover
    class CustomLogger:  # type: ignore[no-redef]
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

__all__ = ["SevenMapsSensor", "sensor"]

_URLISH = re.compile(r"^https?://", re.I)
_REGISTRY = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+/[A-Za-z0-9_.@-]+$", re.I)


def _servers_from_env() -> Dict[str, str]:
    raw = os.environ.get("SEVENMAPS_SENSOR_SERVERS", "").strip()
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return {str(k): str(u) for k, u in v.items()} if isinstance(v, dict) else {}
    except ValueError:
        # name=url,name2=url2
        out = {}
        for part in raw.split(","):
            if "=" in part:
                k, u = part.split("=", 1)
                out[k.strip()] = u.strip()
        return out


def _ms(start: Any, end: Any) -> Optional[float]:
    try:
        return (end - start).total_seconds() * 1000.0
    except Exception:
        try:
            return (float(end) - float(start)) * 1000.0
        except Exception:
            return None


class SevenMapsSensor(CustomLogger):
    def __init__(self, servers: Optional[Dict[str, str]] = None, reporter: Optional[Reporter] = None,
                 enabled: Optional[bool] = None) -> None:
        super().__init__()
        self.servers = dict(_servers_from_env(), **(servers or {}))
        self._reporter = reporter
        self._enabled = enabled

    @property
    def reporter(self) -> Reporter:
        # Created on first use, so importing the module does nothing when the sensor is off.
        if self._reporter is None:
            self._reporter = get_reporter("litellm", enabled=self._enabled)
        return self._reporter

    def _server(self, name: Optional[str]) -> Optional[str]:
        if not name:
            return None
        if name in self.servers:
            return self.servers[name]
        if _URLISH.match(name) or _REGISTRY.match(name):
            return name
        return None  # a LiteLLM alias with no public address listed: not sent

    def _record(self, kwargs: Dict[str, Any], ok: bool, fail: Optional[str], start: Any, end: Any) -> None:
        try:
            meta = kwargs.get("mcp_tool_call_metadata")
            if not meta:
                slo = kwargs.get("standard_logging_object") or {}
                meta = (slo.get("metadata") or {}).get("mcp_tool_call_metadata")
            if not isinstance(meta, dict):
                return  # not an MCP tool call
            server = self._server(meta.get("mcp_server_name"))
            if not server:
                return
            self.reporter.record(server, ok, fail=fail, ms=_ms(start, end), tool=meta.get("name"))
        except Exception:
            pass  # a sensor never breaks the proxy

    async def async_log_success_event(self, kwargs: Dict[str, Any], response_obj: Any, start_time: Any, end_time: Any) -> None:
        self._record(kwargs, True, None, start_time, end_time)

    async def async_log_failure_event(self, kwargs: Dict[str, Any], response_obj: Any, start_time: Any, end_time: Any) -> None:
        exc = kwargs.get("exception")
        # A tool that answered with isError=True is logged by LiteLLM as MCPToolResultError: a
        # failed call with no transport reason, sent without a fail value.
        fail = None if exc is None or type(exc).__name__ == "MCPToolResultError" else fail_reason(exc)
        self._record(kwargs, False, fail, start_time, end_time)


sensor = SevenMapsSensor()
