"""sevenmaps_guard: check an MCP server on the 7Maps map before connecting, and
(only when telemetry is switched on) report how each tool call went.

Guarantee: if 7Maps cannot answer (network error, timeout, rate limit, payment
required), every check allows the call. A problem on our side never blocks the
user's work.

Pure standard library (urllib + json), Python 3.9+.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

__all__ = [
    "VERSION",
    "UNAVAILABLE",
    "GuardError",
    "guard",
    "report",
    "guarded_call",
    "clean_server",
    "telemetry_enabled",
    "fail_reason",
    "clear_cache",
]

VERSION = "0.1.0"
DEFAULT_ENDPOINT = "https://7it.co.il/7maps/mcp?via=guard"
USER_AGENT = "7maps-guard/%s (+https://github.com/XLSV777/7maps)" % VERSION
UNAVAILABLE = "7maps unavailable"
REPORT_TIMEOUT = 3.0

FAIL_REASONS = ("unreachable", "auth", "args", "server_error", "timeout", "rate_limited", "wrong_result")


class GuardError(Exception):
    """Raised by guarded_call when 7Maps says the server should not be used."""

    def __init__(self, verdict: Dict[str, Any]):
        super().__init__("7maps-guard: blocked: %s" % verdict.get("reason"))
        self.verdict = verdict


class _Unavailable(Exception):
    pass


# ------------------------------------------------------------------ helpers


def clean_server(server: str) -> str:
    """The address sent to 7Maps: scheme, host and path only (no query, fragment or user:password)."""
    s = str(server or "").strip()
    try:
        u = urlsplit(s)
        if u.scheme in ("http", "https") and u.hostname:
            host = u.hostname
            if ":" in host:
                host = "[%s]" % host
            if u.port:
                host = "%s:%d" % (host, u.port)
            return ("%s://%s%s" % (u.scheme, host, u.path or "/"))[:300]
    except ValueError:
        pass
    return re.split(r"[?#]", s)[0][:300]


def telemetry_enabled(explicit: Optional[bool] = None) -> bool:
    """True when automatic reporting is on (explicit value wins; else env SEVENMAPS_TELEMETRY=1)."""
    env = os.environ.get("SEVENMAPS_TELEMETRY")
    if explicit is False or env == "0":
        return False
    return explicit is True or env == "1"


_ids = [0]
_ids_lock = threading.Lock()


def _next_id() -> int:
    with _ids_lock:
        _ids[0] += 1
        return _ids[0]


def _parse_rpc(text: str, rid: int) -> Optional[Dict[str, Any]]:
    candidates = []
    t = text.strip()
    if t.startswith("{") or t.startswith("["):
        candidates.append(t)
    else:
        buf = []
        for line in text.splitlines():
            if line.startswith("data:"):
                buf.append(line[5:][1:] if line[5:].startswith(" ") else line[5:])
            elif line == "" and buf:
                candidates.append("\n".join(buf))
                buf = []
        if buf:
            candidates.append("\n".join(buf))
    for c in candidates:
        try:
            j = json.loads(c)
        except ValueError:
            continue
        for m in j if isinstance(j, list) else [j]:
            if isinstance(m, dict) and m.get("id") == rid:
                return m
    return None


def _call_maps(tool: str, args: Dict[str, Any], timeout: float, endpoint: Optional[str] = None,
               user_agent: Optional[str] = None) -> Dict[str, Any]:
    rid = _next_id()
    body = json.dumps({"jsonrpc": "2.0", "id": rid, "method": "tools/call",
                       "params": {"name": tool, "arguments": args}}).encode("utf-8")
    req = urllib.request.Request(endpoint or DEFAULT_ENDPOINT, data=body, method="POST", headers={
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",
        "user-agent": user_agent or USER_AGENT,
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            text = res.read().decode("utf-8", "replace")
    except Exception as e:  # HTTPError (429, 5xx), URLError, timeout, ssl errors
        raise _Unavailable(str(e))
    msg = _parse_rpc(text, rid)
    if not msg or msg.get("error") or not isinstance(msg.get("result"), dict):
        raise _Unavailable("bad response")
    return msg["result"]


def _is_payment_required(r: Dict[str, Any]) -> bool:
    sc = r.get("structuredContent")
    return bool(r.get("isError")) and isinstance(sc, dict) and isinstance(sc.get("x402Version"), int)


def _text_of(r: Dict[str, Any]) -> str:
    for c in r.get("content") or []:
        if isinstance(c, dict) and c.get("type") == "text":
            return str(c.get("text") or "")
    return ""


def _call_checked(tool: str, args: Dict[str, Any], timeout: float, endpoint, user_agent, license_key) -> Dict[str, Any]:
    if license_key:
        args = dict(args, license_key=license_key)
    r = _call_maps(tool, args, timeout, endpoint, user_agent)
    if _is_payment_required(r):
        # Paying (x402) is not built into the Python package: fail open.
        raise _Unavailable("payment required")
    return r


# ------------------------------------------------------------------ guard

_cache: Dict[str, Any] = {}
_cache_lock = threading.Lock()


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def guard(server_url: str, approved_at: Optional[str] = None, cache_seconds: float = 600, *,
          license_key: Optional[str] = None, timeout: float = 5.0, endpoint: Optional[str] = None,
          user_agent: Optional[str] = None) -> Dict[str, Any]:
    """Ask 7Maps about a server before connecting. Never raises.

    Returns {"allow": bool, "reason": str, "condition": dict | None, "watch": dict | None}.
    Denies only when the server is down, or (with approved_at) when watch reports risk_increased.
    """
    server = clean_server(server_url)
    key = "%s|%s" % (server, approved_at or "")
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]

    ttl = max(0.0, float(cache_seconds))

    def keep(v: Dict[str, Any], seconds: float = ttl) -> Dict[str, Any]:
        if seconds > 0:
            with _cache_lock:
                _cache[key] = (time.time() + seconds, v)
        return v

    def fail_open() -> Dict[str, Any]:
        return keep({"allow": True, "reason": UNAVAILABLE, "condition": None, "watch": None}, min(ttl, 60.0))

    try:
        rc = _call_checked("road_conditions", {"server": server}, timeout, endpoint, user_agent, license_key)
    except Exception:
        return fail_open()

    if rc.get("isError"):
        if re.search(r"not on the map", _text_of(rc), re.I):
            return keep({"allow": True, "reason": "not on the map", "condition": None, "watch": None})
        return fail_open()

    condition = rc.get("structuredContent") if isinstance(rc.get("structuredContent"), dict) else None
    status = None
    if condition:
        status = condition.get("status")
        if status is None and isinstance(condition.get("package"), dict):
            status = condition["package"].get("status")

    if status == "down":
        return keep({"allow": False, "reason": "server is down (7Maps road_conditions)",
                     "condition": condition, "watch": None})

    reason = "status %s" % status if status else "on the map"
    watch = None
    if approved_at:
        try:
            w = _call_checked("watch", {"server": server, "approved_at": approved_at}, timeout, endpoint,
                              user_agent, license_key)
            if w.get("isError"):
                reason += "; change check: " + UNAVAILABLE
            else:
                watch = w.get("structuredContent") if isinstance(w.get("structuredContent"), dict) else None
                v = (watch or {}).get("verdict")
                if v == "risk_increased":
                    return keep({"allow": False,
                                 "reason": "risk increased since %s; ask the person to approve again (7Maps watch)"
                                           % approved_at,
                                 "condition": condition, "watch": watch})
                if v:
                    reason += "; since %s: %s" % (approved_at, v)
        except Exception:
            reason += "; change check: " + UNAVAILABLE

    return keep({"allow": True, "reason": reason, "condition": condition, "watch": watch})


# ------------------------------------------------------------------ report


def report(server_url: str, ok: bool, tool: Optional[str] = None, fail: Optional[str] = None,
           ms: Optional[float] = None, *, endpoint: Optional[str] = None,
           user_agent: Optional[str] = None) -> threading.Thread:
    """Send one report_road (server, tool, ok, fail, ms; nothing else) on a background daemon thread.

    Never raises. The request is abandoned after 3 s. Sends whenever you call it, except when
    SEVENMAPS_TELEMETRY=0. Returns the thread (join it if you want to wait; it ends within ~3 s).
    """
    args: Dict[str, Any] = {"server": clean_server(server_url), "ok": bool(ok)}
    if tool:
        args["tool"] = str(tool)[:120]
    if not ok and fail in FAIL_REASONS:
        args["fail"] = fail
    if isinstance(ms, (int, float)) and ms == ms:
        args["ms"] = min(600000, max(0, int(round(ms))))

    def run() -> None:
        if os.environ.get("SEVENMAPS_TELEMETRY") == "0" or len(args["server"]) < 3:
            return
        try:
            _call_maps("report_road", args, REPORT_TIMEOUT, endpoint, user_agent)
        except Exception:
            pass

    t = threading.Thread(target=run, name="7maps-report", daemon=True)
    t.start()
    return t


def fail_reason(err: BaseException) -> str:
    """Map an exception from an MCP client call to a report_road fail value."""
    import asyncio

    code = getattr(err, "code", None)
    if code is None:
        code = getattr(getattr(err, "error", None), "code", None)  # mcp.shared.exceptions.McpError
    status = getattr(getattr(err, "response", None), "status_code", None)  # httpx.HTTPStatusError
    msg = str(err)
    name = type(err).__name__
    if isinstance(err, (TimeoutError, asyncio.TimeoutError)) or code == -32001 or name in ("ReadTimeout", "ConnectTimeout", "TimeoutException") or re.search(r"timed? ?out", msg, re.I):
        return "timeout"
    if code in (401, 403) or status in (401, 403) or re.search(r"\b(401|403)\b|unauthori[sz]ed|forbidden", msg, re.I):
        return "auth"
    if code == 429 or status == 429 or re.search(r"\b429\b|too many requests|rate.?limit", msg, re.I):
        return "rate_limited"
    if code == -32602 or re.search(r"invalid (params|arguments)", msg, re.I):
        return "args"
    if isinstance(err, ConnectionError) or name in ("ConnectError",):
        return "unreachable"
    return "server_error"


async def guarded_call(session: Any, server_url: str, tool: str, args: Optional[Dict[str, Any]] = None, *,
                       approved_at: Optional[str] = None, telemetry: Optional[bool] = None,
                       check: bool = True, cache_seconds: float = 600, **call_kwargs: Any) -> Any:
    """Call a tool through an `mcp` ClientSession with a 7Maps check first and an optional report after.

    - Runs guard() (cached, in a worker thread) and raises GuardError if it denies.
    - Times session.call_tool(tool, args) and, only when telemetry is on, reports
      server, tool, ok, fail and ms. Errors are re-raised unchanged.
    """
    import asyncio

    if check:
        loop = asyncio.get_running_loop()
        verdict = await loop.run_in_executor(None, lambda: guard(server_url, approved_at, cache_seconds))
        if not verdict["allow"]:
            raise GuardError(verdict)

    send = telemetry_enabled(telemetry)
    started = time.monotonic()
    try:
        result = await session.call_tool(tool, args or {}, **call_kwargs)
    except BaseException as e:
        if send and not isinstance(e, asyncio.CancelledError):
            report(server_url, False, tool=tool, fail=fail_reason(e), ms=(time.monotonic() - started) * 1000)
        raise
    if send:
        is_err = bool(getattr(result, "is_error", None) or getattr(result, "isError", None))  # mcp 2.x / 1.x
        report(server_url, not is_err, tool=tool, ms=(time.monotonic() - started) * 1000)
    return result
