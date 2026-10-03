"""Adapter for the official MCP Python SDK (`mcp`) ClientSession.

The SDK has no client-side middleware for tool calls, so this wraps ClientSession.call_tool on one
session object: it times the call, records {server, ok, fail, ms, tool, at} on the reporter, and
returns the SDK's own result or re-raises its own exception, unchanged. Recording never waits on
the network. Works with mcp 1.x (result.isError) and 2.x (result.is_error).
"""

import asyncio
import time
from typing import Any, Optional

from . import Reporter, fail_reason, get_reporter

__all__ = ["wrap_session"]


def wrap_session(session: Any, server: str, *, reporter: Optional[Reporter] = None,
                 enabled: Optional[bool] = None, kind: str = "mcp-sdk-py") -> Any:
    """Wrap session.call_tool in place and return the session.

    server: the server's URL, or its registry name (io.github.owner/repo) for a stdio server.
    """
    rep = reporter or get_reporter(kind, enabled=enabled)
    original = session.call_tool

    async def call_tool(name: str, arguments: Any = None, *args: Any, **kwargs: Any) -> Any:
        started = time.monotonic()
        try:
            result = await original(name, arguments, *args, **kwargs)
        except asyncio.CancelledError:
            raise
        except BaseException as e:
            rep.record(server, False, fail=fail_reason(e), ms=(time.monotonic() - started) * 1000, tool=name)
            raise
        is_err = bool(getattr(result, "is_error", None) or getattr(result, "isError", None))
        rep.record(server, not is_err, ms=(time.monotonic() - started) * 1000, tool=name)
        return result

    session.call_tool = call_tool
    return session
