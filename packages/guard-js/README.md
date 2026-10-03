# 7maps-guard

MCP client middleware for Node.js. Before your client connects to an MCP server, `7maps-guard` asks [7Maps](https://7it.co.il/7maps/) about it: is the server down, and (if you pass the date a person approved it) did its tools get riskier since then. It blocks the connection only in those two cases. If you switch telemetry on, it also reports how each tool call went (ok or failed, and how long it took), which keeps the shared map accurate for every agent that reads it.

## Install

```
npm install 7maps-guard
```

Node 18 or later. No runtime dependencies. `@modelcontextprotocol/sdk` is an optional peer dependency, needed only for `wrapClient`.

## Usage

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { wrapClient } from '7maps-guard';

const url = 'https://mcp.example.com/mcp';
const client = wrapClient(new Client({ name: 'my-agent', version: '1.0.0' }), {
  serverUrl: url, approvedAt: '2026-09-01', telemetry: true,
});
await client.connect(new StreamableHTTPClientTransport(new URL(url))); // throws GuardError on deny
const result = await client.callTool({ name: 'search', arguments: { q: 'invoices' } });
```

`wrapClient` changes the client in place and returns it:

- `connect()` runs `guard()` first. On deny it calls `onDeny(verdict)`; the default throws a `GuardError` (with `.verdict`). Pass your own `onDeny` that returns normally to connect anyway, for example after asking the person.
- `callTool()` is timed. With telemetry on, each call is reported as ok, or failed with one of: `timeout`, `auth` (401/403), `rate_limited` (429), `args` (invalid params), `unreachable` (network error), `server_error` (anything else). A result with `isError: true` is reported as not ok, without a reason.
- `serverUrl` can be left out when the transport is a `StreamableHTTPClientTransport` or `SSEClientTransport`; it is read from the transport.

### Check only

```js
import { guard, report } from '7maps-guard';

const v = await guard('https://mcp.example.com/mcp', { approvedAt: '2026-09-01' });
// { allow: true, reason: 'status open; since 2026-09-01: unchanged', condition: {...}, watch: {...} }
if (!v.allow) throw new Error(v.reason);

report('https://mcp.example.com/mcp', { ok: false, tool: 'search', fail: 'timeout', ms: 30000 });
```

`guard(serverUrl, opts)` options:

| Option | Default | Meaning |
| --- | --- | --- |
| `approvedAt` | none | `YYYY-MM-DD`. Adds the `watch` check; deny when its verdict is `risk_increased`. |
| `cacheSeconds` | `600` | Verdicts are kept in memory this long. Fail-open verdicts are kept at most 60 s. |
| `pay` | none | `async (paymentRequired, tool) => payment \| null`. Called when 7Maps answers with an x402 PaymentRequired result; the returned payload is sent as `_meta["x402/payment"]`. |
| `licenseKey` | none | A 7IT monthly plan license key. |
| `timeoutMs` | `5000` | Limit for each request to 7Maps. |

`condition` is the `structuredContent` of 7Maps `road_conditions` (status, latency, success chance, tool risk levels, sign-in, page URL). `watch` is the `structuredContent` of `watch`, or `null`.

### Cost

`road_conditions` answers the first 20 calls a day per agent without charge, then asks for $0.002 per call via x402. `watch` is paid per call ($0.005). Without `pay` or `licenseKey`, a paid answer counts as "7Maps unavailable": the verdict falls back to allow (or, for `watch`, the change check is skipped and the reason says `change check: 7maps unavailable`). The in-memory cache keeps the number of calls low. `report_road` is not charged.

## CLI

```
npx 7maps-guard check https://mcp.example.com/mcp
npx 7maps-guard check https://mcp.example.com/mcp --approved 2026-09-01
npx 7maps-guard check https://mcp.example.com/mcp --json
```

Exit code `0` for allow, `2` for deny, `1` for a usage error. Useful as a CI step before a deploy that depends on an MCP server. The CLI never reports anything.

## What is sent

Every request goes to `https://7it.co.il/7maps/mcp?via=guard` as an MCP `tools/call` over HTTPS, with the header `user-agent: 7maps-guard/<version> (+https://github.com/XLSV777/7maps)`. Like any HTTPS request, it also carries your IP address. No cookies, no account, no device ID.

The server address is reduced to scheme, host and path before it is sent: the query string, the fragment and any `user:password@` part are removed, since they can carry keys.

| Call | When | Fields |
| --- | --- | --- |
| `road_conditions` | every `guard()` / `connect()` not served from cache | `server` (and `license_key` if you set one) |
| `watch` | only when `approvedAt` is set | `server`, `approved_at` (and `license_key`) |
| `report_road` | only with telemetry on (`wrapClient`), or when you call `report()` | `server`, `tool` (the tool name), `ok`, `fail` (one of the values above, only when not ok), `ms` (whole milliseconds) |

Never sent: tool arguments, tool results, prompts, model output, your server's headers or tokens, environment variables, host names of your machines, or anything else.

Telemetry is opt-in. `wrapClient` reports only with `telemetry: true`, or when the environment variable `SEVENMAPS_TELEMETRY=1` is set. `telemetry: false` always wins. `SEVENMAPS_TELEMETRY=0` turns off every report, including direct `report()` calls. With telemetry off, the checks still work.

## Why report

7Maps checks every remote server in the official MCP registry once a day with a handshake. That says whether a server answers, not whether its tools work for real callers. Reports from agents fill that gap: every report makes the shared map more accurate for everyone, and the rating every agent sees comes from them. They also help 7Maps spot a server that starts failing; an incident is shown once 7Maps confirms it. Each agent's reports on one server count only up to a daily limit.

## Fail-open guarantee

If 7Maps cannot be reached, times out, is rate limited, returns something unexpected, or asks for payment that is not configured, `guard()` returns `{ allow: true, reason: '7maps unavailable', condition: null }`. `guard()` never throws. `report()` never throws and its promise settles within 3 seconds; the tool call's result never waits for it. A problem on the 7Maps side never blocks your work.

## Links

- 7Maps: https://7it.co.il/7maps/
- Per-server page: `https://7it.co.il/7maps/s/<host>/<path>`
- Source: https://github.com/XLSV777/7maps/tree/main/packages/guard-js
- Python version: [`sevenmaps-guard`](https://github.com/XLSV777/7maps/tree/main/packages/guard-py)

MIT license.
