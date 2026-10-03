# sevenmaps-guard

MCP client middleware for Python. Before your client calls an MCP server, `sevenmaps_guard` asks [7Maps](https://7it.co.il/7maps/) about it: is the server down, and (if you pass the date a person approved it) did its tools get riskier since then. It blocks the call only in those two cases. If you switch telemetry on, it also reports how each tool call went (ok or failed, and how long it took), which keeps the shared map accurate for every agent that reads it.

## Install

```
pip install sevenmaps-guard
```

Python 3.9 or later. Standard library only (`urllib`, `json`, `threading`). The official `mcp` package is needed only for `guarded_call`.

## Usage

```python
from mcp import ClientSession
from sevenmaps_guard import guarded_call, GuardError

URL = "https://mcp.example.com/mcp"

async def search(session: ClientSession):
    try:
        return await guarded_call(session, URL, "search", {"q": "invoices"},
                                  approved_at="2026-09-01", telemetry=True)
    except GuardError as e:
        print("blocked:", e.verdict["reason"])
```

`guarded_call(session, server_url, tool, args)`:

- runs `guard()` (cached, in a worker thread so the event loop is not blocked) and raises `GuardError` (with `.verdict`) on deny;
- times `session.call_tool(tool, args)` and, with telemetry on, reports ok, or failed with one of: `timeout`, `auth` (401/403), `rate_limited` (429), `args` (invalid params), `unreachable` (connection error), `server_error` (anything else). A result with `is_error` / `isError` set is reported as not ok, without a reason. Exceptions are re-raised unchanged.
- Extra keyword arguments go to `call_tool`. `check=False` skips the guard.

Works with `mcp` 1.x and 2.x.

### Check only

```python
from sevenmaps_guard import guard, report

v = guard("https://mcp.example.com/mcp", approved_at="2026-09-01")
# {'allow': True, 'reason': 'status open; since 2026-09-01: unchanged', 'condition': {...}, 'watch': {...}}
if not v["allow"]:
    raise SystemExit(v["reason"])

report("https://mcp.example.com/mcp", ok=False, tool="search", fail="timeout", ms=30000)
```

`guard(server_url, approved_at=None, cache_seconds=600, *, license_key=None, timeout=5.0)` never raises. It denies only when 7Maps reports the server `down`, or when `watch` reports `risk_increased` since `approved_at`. `condition` is the `structuredContent` of 7Maps `road_conditions`; `watch` is the `structuredContent` of `watch`, or `None`.

`report(...)` sends on a background daemon thread and returns the thread at once; the request is abandoned after 3 seconds.

### Cost

`road_conditions` answers the first 20 calls a day per agent without charge, then asks for $0.002 per call via x402. `watch` is paid per call ($0.005). The Python package does not pay x402; a paid answer counts as "7Maps unavailable": the verdict falls back to allow (or, for `watch`, the change check is skipped and the reason says `change check: 7maps unavailable`). A 7IT monthly plan `license_key` is passed through if you have one. The in-memory cache keeps the number of calls low. `report_road` is not charged.

## CLI

The command-line check ships with the Node.js package:

```
npx 7maps-guard check https://mcp.example.com/mcp --approved 2026-09-01
```

Exit code `0` for allow, `2` for deny.

## What is sent

Every request goes to `https://7it.co.il/7maps/mcp?via=guard` as an MCP `tools/call` over HTTPS, with the header `user-agent: 7maps-guard/<version> (+https://github.com/XLSV777/7maps)`. Like any HTTPS request, it also carries your IP address. No cookies, no account, no device ID.

The server address is reduced to scheme, host and path before it is sent: the query string, the fragment and any `user:password@` part are removed, since they can carry keys.

| Call | When | Fields |
| --- | --- | --- |
| `road_conditions` | every `guard()` / `guarded_call()` not served from cache | `server` (and `license_key` if you set one) |
| `watch` | only when `approved_at` is set | `server`, `approved_at` (and `license_key`) |
| `report_road` | only with telemetry on (`guarded_call`), or when you call `report()` | `server`, `tool` (the tool name), `ok`, `fail` (one of the values above, only when not ok), `ms` (whole milliseconds) |

Never sent: tool arguments, tool results, prompts, model output, your server's headers or tokens, environment variables, host names of your machines, or anything else.

Telemetry is opt-in. `guarded_call` reports only with `telemetry=True`, or when the environment variable `SEVENMAPS_TELEMETRY=1` is set. `telemetry=False` always wins. `SEVENMAPS_TELEMETRY=0` turns off every report, including direct `report()` calls. With telemetry off, the checks still work.

## Why report

7Maps checks every remote server in the official MCP registry once a day with a handshake. That says whether a server answers, not whether its tools work for real callers. Reports from agents fill that gap: every report makes the shared map more accurate for everyone, and the rating every agent sees comes from them. They also help 7Maps spot a server that starts failing; an incident is shown once 7Maps confirms it. Each agent's reports on one server count only up to a daily limit.

## Fail-open guarantee

If 7Maps cannot be reached, times out, is rate limited, returns something unexpected, or asks for payment, `guard()` returns `{"allow": True, "reason": "7maps unavailable", "condition": None, "watch": None}`. `guard()` never raises. `report()` never raises and never blocks the caller. A problem on the 7Maps side never blocks your work.

## Links

- 7Maps: https://7it.co.il/7maps/
- Per-server page: `https://7it.co.il/7maps/s/<host>/<path>`
- Source: https://github.com/XLSV777/7maps/tree/main/packages/guard-py
- Node.js version: [`7maps-guard`](https://github.com/XLSV777/7maps/tree/main/packages/guard-js)

MIT license.
