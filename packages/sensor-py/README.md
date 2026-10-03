# sevenmaps-sensor (Python)

An opt-in sensor for MCP gateways and clients. It reports the outcome of each MCP tool call (which server, worked or failed, why, how long, which tool) to [7Maps](https://7it.co.il/7maps/), where outcomes from many gateways become the shared ratings that agents read before connecting and, together with 7Maps' own checks, its live incident flags. Standard library only, Python 3.9 or later.

This package is the core reporter plus an adapter for the official MCP Python SDK. Gateway adapters build on it:

- LiteLLM proxy: [`packages/sensor-litellm`](../sensor-litellm)
- IBM ContextForge: [`packages/sensor-contextforge`](../sensor-contextforge)
- Node.js and the MCP TypeScript SDK: [`packages/sensor-js`](../sensor-js)

## What is sent

One HTTPS `POST https://7it.co.il/7maps/sensor` per batch (up to 100 outcomes), at most once a minute unless 100 are waiting. This is the exact shape:

```json
{
  "sensor_id": "q3Jx0b2VYk9mN7tP1sLwQeRz",
  "kind": "mcp-sdk-py",
  "version": "0.1.0",
  "outcomes": [
    { "server": "https://mcp.example.com/mcp", "ok": true, "ms": 412, "tool": "search_docs", "at": "2026-10-03T12:00:01.204Z" },
    { "server": "io.github.acme/weather", "ok": false, "fail": "timeout", "ms": 30000, "tool": "forecast", "at": "2026-10-03T12:00:09.877Z" }
  ]
}
```

- `server`: the server URL with the query string, fragment and user:password removed, or a registry name.
- `ok`: whether the call worked. A result with `isError` counts as not ok, without a reason.
- `fail`: one of `unreachable`, `auth`, `args`, `server_error`, `timeout`, `rate_limited`, `wrong_result`, read from the exception type and code.
- `ms`: time from the call to its answer. `tool`: the tool's name only. `at`: when it finished (UTC).
- `sensor_id`: random, made on first use and kept in `~/.7maps/sensor-id`. It identifies the sensor, not a person. `kind`: the gateway name. `version`: this package's version.

## What is never sent

Arguments, results or any content, prompts, user or tenant ids, API keys, tokens, headers, and anything in the URL after the path. 7Maps refuses a batch that carries any other field (HTTP 400) instead of storing it, keeps outcomes only for servers that are on its public map (others are counted and dropped), and does not store IP addresses.

## Enable

Off by default. Either set an environment variable:

```
SEVENMAPS_SENSOR=1
```

or pass `enabled=True` in code. Install from GitHub (no PyPI release yet):

```
pip install "git+https://github.com/XLSV777/7maps#subdirectory=packages/sensor-py"
```

### With the MCP Python SDK

The SDK has no client-side middleware for tool calls, so `wrap_session` wraps `ClientSession.call_tool` on one session. Results and errors pass through unchanged; recording never waits on the network.

```python
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from sevenmaps_sensor.mcp_client import wrap_session

URL = "https://mcp.example.com/mcp"
async with streamablehttp_client(URL) as (read, write, _):
    async with ClientSession(read, write) as session:
        wrap_session(session, URL)          # for a stdio server pass its registry name instead
        await session.initialize()
        result = await session.call_tool("search_docs", {"q": "invoices"})
```

### Any other gateway

```python
from sevenmaps_sensor import get_reporter, fail_reason

reporter = get_reporter("my-gateway")       # one per process; off unless SEVENMAPS_SENSOR=1
reporter.record("https://mcp.example.com/mcp", ok=True, ms=412, tool="search_docs")
reporter.record("https://mcp.example.com/mcp", ok=False, fail=fail_reason(err), ms=30000, tool="search_docs")
```

`record()` never blocks and never raises. The queue holds 1,000 outcomes; when it is full new outcomes are dropped (`reporter.stats["dropped"]`). A daemon thread sends batches, retries network and 5xx errors with backoff (up to 5 tries, then the batch waits for the next minute), drops a batch 7Maps refuses (400), and after a 429 (daily limit per sensor) or 503 (intake paused) waits for the time in `Retry-After`. At exit it tries one last send for up to 2 seconds.

Options: `Reporter(kind, enabled=None, endpoint=None, flush_seconds=60, max_batch=100, max_queue=1000, max_retries=5, timeout=10, on_error=None)`. Environment: `SEVENMAPS_SENSOR_URL` (another endpoint, for tests), `SEVENMAPS_SENSOR_ID` (a fixed id), `SEVENMAPS_SENSOR_ID_FILE`.

## Disable

Unset `SEVENMAPS_SENSOR` or set `SEVENMAPS_SENSOR=0` (this wins over `enabled=True`), and restart. To forget the sensor id, delete `~/.7maps/sensor-id`.

## Tests

```
python -m unittest discover -s tests -v
```

They run against a local mock server; nothing is sent to 7Maps. Test sensor ids start with `t-`, which 7Maps validates and answers but never stores.
