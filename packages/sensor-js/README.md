# 7maps-sensor (Node.js)

An opt-in sensor for MCP gateways and clients. It reports the outcome of each MCP tool call (which server, worked or failed, why, how long, which tool) to [7Maps](https://7it.co.il/7maps/), where outcomes from many gateways become the shared ratings that agents read before connecting and, together with 7Maps' own checks, its live incident flags. No dependencies, Node 18 or later, ESM.

This package is the core reporter plus an adapter for the official MCP TypeScript SDK client. Python gateways: [`packages/sensor-py`](../sensor-py), [`packages/sensor-litellm`](../sensor-litellm), [`packages/sensor-contextforge`](../sensor-contextforge).

## What is sent

One HTTPS `POST https://7it.co.il/7maps/sensor` per batch (up to 100 outcomes), at most once a minute unless 100 are waiting. This is the exact shape:

```json
{
  "sensor_id": "q3Jx0b2VYk9mN7tP1sLwQeRz",
  "kind": "mcp-sdk-js",
  "version": "0.1.0",
  "outcomes": [
    { "server": "https://mcp.example.com/mcp", "ok": true, "ms": 412, "tool": "search_docs", "at": "2026-10-03T12:00:01.204Z" },
    { "server": "https://mcp.example.com/mcp", "ok": false, "fail": "timeout", "ms": 30000, "tool": "search_docs", "at": "2026-10-03T12:00:09.877Z" }
  ]
}
```

- `server`: the server URL with the query string, fragment and user:password removed, or a registry name (`io.github.owner/repo`).
- `ok`: whether the call worked. A result with `isError: true` counts as not ok, without a reason.
- `fail`: one of `unreachable`, `auth`, `args`, `server_error`, `timeout`, `rate_limited`, `wrong_result`, read from the error's name, code and message.
- `ms`: time from the call to its answer. `tool`: the tool's name only. `at`: when it finished (UTC).
- `sensor_id`: random, made on first use and kept in `~/.7maps/sensor-id`. It identifies the sensor, not a person. `kind`: the gateway name. `version`: this package's version.

## What is never sent

Arguments, results or any content, prompts, user ids, API keys, tokens, headers, and anything in the URL after the path. 7Maps refuses a batch that carries any other field (HTTP 400) instead of storing it, keeps outcomes only for servers that are on its public map, and does not store IP addresses.

## Enable

Off by default. Set `SEVENMAPS_SENSOR=1`, or pass `enabled: true`. There is no npm release yet; take it from GitHub:

```
git clone --depth 1 https://github.com/XLSV777/7maps
npm install ./7maps/packages/sensor-js
```

### With the MCP TypeScript SDK

The SDK has no middleware for tool calls (its client middleware wraps HTTP `fetch` only), so `wrapClient` wraps `Client.callTool`. Results and errors pass through unchanged; recording never waits on the network.

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { wrapClient } from '7maps-sensor/mcp-sdk';

const url = 'https://mcp.example.com/mcp';
const client = wrapClient(new Client({ name: 'my-gateway', version: '1.0.0' }));
await client.connect(new StreamableHTTPClientTransport(new URL(url))); // the URL is read from the transport
await client.callTool({ name: 'search_docs', arguments: { q: 'invoices' } });
```

For a stdio server pass its registry name: `wrapClient(client, { serverUrl: 'io.github.acme/weather' })`.

### Any other gateway

```js
import { getReporter, failReason } from '7maps-sensor';

const reporter = getReporter({ kind: 'my-gateway' }); // one per process; off unless SEVENMAPS_SENSOR=1
reporter.record({ server: 'https://mcp.example.com/mcp', ok: true, ms: 412, tool: 'search_docs' });
reporter.record({ server: 'https://mcp.example.com/mcp', ok: false, fail: failReason(err), ms: 30000, tool: 'search_docs' });
```

`record()` is synchronous and never throws. The queue holds 1,000 outcomes; when it is full new outcomes are dropped (`reporter.stats.dropped`). Batches are sent in the background; network and 5xx errors are retried with backoff (up to 5 tries, then the batch waits for the next minute), a batch 7Maps refuses (400) is dropped, and after a 429 (daily limit per sensor) or 503 (intake paused) the reporter waits for the time in `Retry-After`. Timers are `unref`'d, so the sensor never keeps a process alive; call `await reporter.close()` on shutdown to send what is waiting.

Options: `new Reporter({ kind, enabled, endpoint, flushMs: 60000, maxBatch: 100, maxQueue: 1000, maxRetries: 5, timeoutMs: 10000, onError })`. Environment: `SEVENMAPS_SENSOR_URL` (another endpoint, for tests), `SEVENMAPS_SENSOR_ID` (a fixed id), `SEVENMAPS_SENSOR_ID_FILE`.

## Disable

Unset `SEVENMAPS_SENSOR` or set `SEVENMAPS_SENSOR=0` (this wins over `enabled: true`), and restart. To forget the sensor id, delete `~/.7maps/sensor-id`.

## Tests

```
npm test
```

They run against a local mock server; nothing is sent to 7Maps.
