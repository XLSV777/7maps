"""sevenmaps-sensor: an opt-in reporter of MCP tool-call outcomes for gateways and clients.

It sends 7Maps (https://7it.co.il/7maps/) only: the server address (no query, fragment or
credentials) or registry name, ok, fail reason, ms, tool name and time, plus a random sensor id,
the gateway kind and this package's version. Never arguments, results, prompts, user ids, headers
or tokens. Off unless SEVENMAPS_SENSOR=1 or enabled=True.

record() never blocks and never raises: outcomes go into a bounded queue (dropped when full) and a
daemon thread sends them in batches of up to 100, every 60 seconds or as soon as 100 are waiting,
retrying network errors with backoff. Standard library only; Python 3.9 or later.
"""

import atexit
import base64
import json
import os
import queue
import random
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

__all__ = ["Reporter", "get_reporter", "sensor_enabled", "clean_server", "fail_reason", "sensor_id", "to_wire",
           "FAIL_REASONS", "DEFAULT_ENDPOINT", "VERSION"]

VERSION = "0.1.0"
DEFAULT_ENDPOINT = "https://7it.co.il/7maps/sensor"
FAIL_REASONS = ("unreachable", "auth", "args", "server_error", "timeout", "rate_limited", "wrong_result")
_TOOL = re.compile(r"^[A-Za-z0-9_.:/-]{1,128}$")
_KIND = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
_ID = re.compile(r"^(t-)?[A-Za-z0-9_-]{16,64}$")


def sensor_enabled(explicit: Optional[bool] = None) -> bool:
    """True only when switched on: explicit wins, else env SEVENMAPS_SENSOR=1. SEVENMAPS_SENSOR=0 always wins."""
    env = os.environ.get("SEVENMAPS_SENSOR")
    if env == "0" or explicit is False:
        return False
    return explicit is True or env == "1"


def clean_server(server: Any) -> str:
    """Scheme, host and path only: query strings, fragments and user:password can carry keys."""
    s = str(server or "").strip()
    try:
        u = urlsplit(s)
        if u.scheme in ("http", "https") and u.hostname:
            host = u.hostname
            if ":" in host:
                host = "[%s]" % host
            if u.port:
                host = "%s:%d" % (host, u.port)
            return ("%s://%s%s" % (u.scheme, host, u.path))[:300]
    except ValueError:
        pass
    return re.split(r"[?#\s]", s)[0][:300]


def fail_reason(err: BaseException) -> str:
    """Map an exception from an MCP call to a 7Maps fail reason."""
    import asyncio

    code = getattr(err, "code", None)
    if code is None:
        code = getattr(getattr(err, "error", None), "code", None)  # mcp McpError
    status = getattr(err, "status_code", None) or getattr(getattr(err, "response", None), "status_code", None)
    msg, name = str(err), type(err).__name__
    if isinstance(err, (TimeoutError, asyncio.TimeoutError)) or code == -32001 or status == 408 \
            or name in ("ReadTimeout", "ConnectTimeout", "TimeoutException") or re.search(r"timed? ?out", msg, re.I):
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


def sensor_id(path: Optional[str] = None) -> str:
    """The sensor id: random, made once and kept in a file (SEVENMAPS_SENSOR_ID_FILE, default
    ~/.7maps/sensor-id). SEVENMAPS_SENSOR_ID overrides. If the file cannot be written, a new
    random id is used for this process."""
    given = os.environ.get("SEVENMAPS_SENSOR_ID")
    if given and _ID.match(given):
        return given
    path = path or os.environ.get("SEVENMAPS_SENSOR_ID_FILE") or os.path.join(os.path.expanduser("~"), ".7maps", "sensor-id")
    try:
        with open(path, "r", encoding="utf-8") as f:
            v = f.read().strip()
        if _ID.match(v) and not v.startswith("t-"):
            return v
    except OSError:
        pass
    new = base64.urlsafe_b64encode(os.urandom(18)).decode().rstrip("=")
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(new + "\n")
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    except OSError:
        pass
    return new


def _iso(at: Any) -> str:
    if isinstance(at, datetime):
        d = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
    elif isinstance(at, (int, float)):
        d = datetime.fromtimestamp(at, tz=timezone.utc)
    else:
        d = datetime.now(timezone.utc)
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (d.microsecond // 1000)


def to_wire(server: Any, ok: bool, fail: Optional[str] = None, ms: Optional[float] = None,
            tool: Optional[str] = None, at: Any = None) -> Optional[Dict[str, Any]]:
    """One outcome in the wire format, or None when there is no usable server."""
    s = clean_server(server)
    if len(s) < 3:
        return None
    out: Dict[str, Any] = {"server": s, "ok": bool(ok)}
    if not ok and fail in FAIL_REASONS:
        out["fail"] = fail
    if isinstance(ms, (int, float)) and ms == ms and ms not in (float("inf"), float("-inf")):
        out["ms"] = min(600000, max(0, int(round(ms))))
    if isinstance(tool, str) and _TOOL.match(tool):
        out["tool"] = tool
    out["at"] = _iso(at)
    return out


class Reporter:
    """Batches outcomes and sends them from a daemon thread. Create one per process (get_reporter)."""

    def __init__(self, kind: str = "custom", *, enabled: Optional[bool] = None, endpoint: Optional[str] = None,
                 sensor_id_value: Optional[str] = None, id_file: Optional[str] = None, flush_seconds: float = 60.0,
                 max_batch: int = 100, max_queue: int = 1000, max_retries: int = 5, timeout: float = 10.0,
                 version: str = VERSION, on_error: Any = None) -> None:
        self.kind = kind if _KIND.match(str(kind or "")) else "custom"
        self.version = version
        self.enabled = sensor_enabled(enabled)
        self.endpoint = endpoint or os.environ.get("SEVENMAPS_SENSOR_URL") or DEFAULT_ENDPOINT
        self.flush_seconds = flush_seconds
        self.max_batch = min(100, max_batch)
        self.max_retries = max_retries
        self.timeout = timeout
        self.on_error = on_error
        self.stats = {"recorded": 0, "sent": 0, "dropped": 0, "failed_batches": 0, "refused_batches": 0}
        self._q: "queue.Queue[Dict[str, Any]]" = queue.Queue(maxsize=max_queue)
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._paused_until = 0.0
        self._pending: List[Dict[str, Any]] = []
        self._inflight = False
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        if not self.enabled:
            return
        self.id = sensor_id_value or sensor_id(id_file)
        self._thread = threading.Thread(target=self._run, name="7maps-sensor", daemon=True)
        self._thread.start()
        atexit.register(self.close, 2.0)

    def record(self, server: Any, ok: bool, fail: Optional[str] = None, ms: Optional[float] = None,
               tool: Optional[str] = None, at: Any = None) -> bool:
        """Queue one outcome. Returns False when off, invalid or dropped (queue full). Never raises."""
        try:
            if not self.enabled:
                return False
            w = to_wire(server, ok, fail, ms, tool, at)
            if w is None:
                return False
            self._q.put_nowait(w)
            with self._lock:
                self.stats["recorded"] += 1
            if self._q.qsize() >= self.max_batch:
                self._wake.set()
            return True
        except queue.Full:
            with self._lock:
                self.stats["dropped"] += 1
            return False
        except Exception:
            return False

    def flush(self, timeout: float = 15.0) -> None:
        """Ask the thread to send now and wait until the queue is empty or timeout passes."""
        if not self.enabled:
            return
        self._wake.set()
        end = time.monotonic() + timeout
        time.sleep(0.01)  # let the thread pick the wake up
        while time.monotonic() < end and (self._q.qsize() or self._pending or self._inflight):
            time.sleep(0.02)

    def close(self, timeout: float = 5.0) -> None:
        """Send what is waiting (bounded by timeout), then stop the thread."""
        if not self.enabled or self._stop.is_set():
            return
        self.max_retries = 0
        self.flush(timeout)
        self._stop.set()
        self._wake.set()

    # ---- the thread
    def _run(self) -> None:
        last = time.monotonic()
        while not self._stop.is_set():
            self._wake.wait(timeout=max(0.05, self.flush_seconds - (time.monotonic() - last)))
            self._wake.clear()
            if self._stop.is_set():
                break
            # Woken (100 waiting, or flush()) or the interval passed: send what is waiting.
            last = time.monotonic()
            try:
                self._drain()
            except Exception as e:  # never let the thread die
                self._report(e)

    def _drain(self) -> None:
        while (self._pending or self._q.qsize()) and time.time() >= self._paused_until:
            self._inflight = True  # before taking from the queue, so flush() never sees a gap
            try:
                batch = self._pending or []
                self._pending = []
                while len(batch) < self.max_batch:
                    try:
                        batch.append(self._q.get_nowait())
                    except queue.Empty:
                        break
                if not batch:
                    return
                outcome = self._send(batch)
            finally:
                self._inflight = False
            if outcome == "retry_later":
                self._pending = batch
                return

    def _send(self, batch: List[Dict[str, Any]]) -> str:
        body = json.dumps({"sensor_id": self.id, "kind": self.kind, "version": self.version, "outcomes": batch}).encode()
        for attempt in range(self.max_retries + 1):
            try:
                req = urllib.request.Request(self.endpoint, data=body, method="POST", headers={
                    "Content-Type": "application/json", "User-Agent": "7maps-sensor-py/%s (%s)" % (VERSION, self.kind)})
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    r.read()
                with self._lock:
                    self.stats["sent"] += len(batch)
                return "sent"
            except urllib.error.HTTPError as e:
                if e.code in (429, 503):
                    # Daily limit or intake paused: drop this batch and wait as told (at most a day).
                    try:
                        ra = float(e.headers.get("Retry-After") or 60)
                    except ValueError:
                        ra = 60.0
                    self._paused_until = time.time() + min(86400.0, ra)
                    self._count_refused(len(batch))
                    return "dropped"
                if 400 <= e.code < 500:
                    self._count_refused(len(batch))
                    self._report(e)
                    return "dropped"
                self._report(e)
            except Exception as e:
                self._report(e)
            if attempt < self.max_retries:
                time.sleep(min(300.0, 2 ** attempt) * (0.5 + random.random() / 2))
        with self._lock:
            self.stats["failed_batches"] += 1
        return "retry_later"

    def _count_refused(self, n: int) -> None:
        with self._lock:
            self.stats["refused_batches"] += 1
            self.stats["dropped"] += n

    def _report(self, e: BaseException) -> None:
        try:
            if self.on_error:
                self.on_error(e)
        except Exception:
            pass


_shared: Dict[str, Reporter] = {}
_shared_lock = threading.Lock()


def get_reporter(kind: str = "custom", **kwargs: Any) -> Reporter:
    """One reporter per kind per process (adapters use this)."""
    with _shared_lock:
        if kind not in _shared:
            _shared[kind] = Reporter(kind, **kwargs)
        return _shared[kind]
