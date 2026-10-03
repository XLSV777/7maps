# 7Maps sensor for IBM ContextForge

An opt-in sensor for [ContextForge](https://github.com/IBM/mcp-context-forge) (mcp-context-forge). It reports the outcome of each MCP tool call the gateway forwards to [7Maps](https://7it.co.il/7maps/), where outcomes from many gateways become the shared ratings and live incident flags that agents read before connecting.

It is a native plugin on ContextForge's documented plugin framework ([plugins guide](https://github.com/IBM/mcp-context-forge/blob/main/docs/docs/using/plugins/index.md)): `tool_pre_invoke` notes the start time in the plugin's per-request state, and `tool_post_invoke` reads the upstream server URL from the gateway metadata (`GATEWAY_METADATA`), the tool's original name (`TOOL_METADATA`) and `isError` from the result. It never changes a payload and never stops a call. It needs the `cpex` plugin package, which ContextForge uses after 1.0.0 ([migration note](https://github.com/IBM/mcp-context-forge/blob/main/docs/docs/using/plugins/migration-to-cpex.md)); older gateways that import from `mcpgateway.plugins.framework` are not supported.

## What is sent

Per call: the upstream server URL, ok or failed, milliseconds, the tool name, the time. Batched (up to 100 per request, at most once a minute unless 100 are waiting) to `POST https://7it.co.il/7maps/sensor`. The exact shape:

```json
{
  "sensor_id": "q3Jx0b2VYk9mN7tP1sLwQeRz",
  "kind": "contextforge",
  "version": "0.1.0",
  "outcomes": [
    { "server": "https://mcp.example.com/mcp", "ok": true, "ms": 412, "tool": "search_docs", "at": "2026-10-03T12:00:01.204Z" },
    { "server": "https://mcp.example.com/mcp", "ok": false, "ms": 1880, "tool": "search_docs", "at": "2026-10-03T12:00:09.877Z" }
  ]
}
```

A result with `isError` is sent as `ok: false` without a `fail` reason. The URL loses its query string, fragment and user:password before it is queued. `sensor_id` is random, made on first use and kept in `~/.7maps/sensor-id`; it identifies the sensor, not a person. REST integrations (tools that are not MCP servers) are not reported.

## What is never sent

Tool arguments and result content, prompts, users, tenants, virtual server ids, request ids, tokens and headers. 7Maps refuses any other field (HTTP 400), keeps outcomes only for servers on its public map, and does not store IP addresses.

## Enable

1. Install into the gateway's Python environment (no PyPI release yet):

   ```
   pip install "git+https://github.com/XLSV777/7maps#subdirectory=packages/sensor-contextforge"
   ```

2. Add the plugin to `plugins/config.yaml`:

   ```yaml
   plugins:
     - name: "SevenMapsSensor"
       kind: "sevenmaps_sensor_contextforge.SevenMapsSensorPlugin"
       description: "Reports tool-call outcomes (no content) to 7Maps"
       version: "0.1.0"
       hooks: ["tool_pre_invoke", "tool_post_invoke"]
       mode: "transform"
       priority: 1000
       config:
         enabled: true
   ```

   `transform` (the former `permissive`) runs the hooks in line and never blocks a call; the hooks only read the context and queue a small record, so they add microseconds. `config.enabled: true` switches the sensor on; without it, set `SEVENMAPS_SENSOR=1`.

3. Make sure plugins are on (`PLUGINS_ENABLED=true`, `PLUGINS_CONFIG_FILE=plugins/config.yaml`) and restart.

Outcomes are sent from a background thread; if 7Maps cannot be reached they are retried and then dropped, and the gateway is not affected.

## Disable

Set `config.enabled: false` (or remove it and set `SEVENMAPS_SENSOR=0`), or set the plugin's `mode: "disabled"`, or remove the entry; restart. `SEVENMAPS_SENSOR=0` wins over `enabled: true`. To forget the sensor id, delete `~/.7maps/sensor-id`.

## Tests

```
python -m unittest discover -s tests -v
```

The tests use small stand-ins for the documented cpex classes, so neither ContextForge nor cpex is needed; nothing is sent to 7Maps.
