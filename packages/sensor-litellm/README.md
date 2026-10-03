# 7Maps sensor for LiteLLM

An opt-in sensor for the [LiteLLM proxy](https://docs.litellm.ai/)'s MCP gateway. It reports the outcome of each MCP tool call the proxy forwards to [7Maps](https://7it.co.il/7maps/), where outcomes from many gateways become the shared ratings and live incident flags that agents read before connecting.

It is a LiteLLM `CustomLogger` ([custom callbacks](https://docs.litellm.ai/docs/proxy/logging)). LiteLLM logs every MCP tool call with call type `call_mcp_tool` through `async_log_success_event` and `async_log_failure_event` (a tool result with `isError` is logged as a failure), with `mcp_tool_call_metadata` (tool name and LiteLLM server name) and the start and end time. The sensor reads only those. Checked against LiteLLM 1.105.0.

## What is sent

Per call: the server, ok or failed, a failure reason, milliseconds, the tool name, the time. Batched (up to 100 per request, at most once a minute unless 100 are waiting) to `POST https://7it.co.il/7maps/sensor`. The exact shape:

```json
{
  "sensor_id": "q3Jx0b2VYk9mN7tP1sLwQeRz",
  "kind": "litellm",
  "version": "0.1.0",
  "outcomes": [
    { "server": "https://mcp.deepwiki.com/mcp", "ok": true, "ms": 412, "tool": "read_wiki_structure", "at": "2026-10-03T12:00:01.204Z" },
    { "server": "https://mcp.deepwiki.com/mcp", "ok": false, "fail": "timeout", "ms": 30000, "tool": "ask_question", "at": "2026-10-03T12:00:09.877Z" }
  ]
}
```

`server` is the public address you map each LiteLLM server name to (below). `fail` is one of `unreachable`, `auth`, `args`, `server_error`, `timeout`, `rate_limited`, `wrong_result`, or absent when the tool answered with `isError`. `sensor_id` is random, made on first use and kept in `~/.7maps/sensor-id`; it identifies the sensor, not a person.

## What is never sent

Tool arguments and results (LiteLLM keeps them in the same metadata; the sensor does not read them), prompts, model calls, virtual keys, users, teams, headers, and your LiteLLM server aliases. A LiteLLM server with no public address in your map is not reported at all. 7Maps refuses any other field (HTTP 400), keeps outcomes only for servers on its public map, and does not store IP addresses.

## Enable

1. Install into the proxy's Python environment (no PyPI release yet):

   ```
   pip install "git+https://github.com/XLSV777/7maps#subdirectory=packages/sensor-litellm"
   ```

   Or copy `sevenmaps_sensor_litellm.py` next to your `config.yaml` and install the core with `pip install "git+https://github.com/XLSV777/7maps#subdirectory=packages/sensor-py"`. LiteLLM loads a callback module from the config's folder first, then from the environment.

2. Register the callback in `config.yaml`:

   ```yaml
   litellm_settings:
     callbacks: sevenmaps_sensor_litellm.sensor
   ```

3. Switch it on and say which public server each LiteLLM MCP server name points at:

   ```
   SEVENMAPS_SENSOR=1
   SEVENMAPS_SENSOR_SERVERS={"deepwiki": "https://mcp.deepwiki.com/mcp", "github": "https://api.githubcopilot.com/mcp"}
   ```

   `SEVENMAPS_SENSOR_SERVERS` also takes `name=url,name2=url2`. A registry name (`io.github.owner/repo`) works as the value too. A LiteLLM server name that is already a URL or a registry name is used as is.

Restart the proxy. Calls are recorded in memory and sent from a background thread, so the proxy's response never waits for 7Maps; if 7Maps cannot be reached, outcomes are retried and then dropped.

## Disable

Set `SEVENMAPS_SENSOR=0` (or remove the variable) and restart; the callback stays registered and does nothing. Or remove `sevenmaps_sensor_litellm.sensor` from `callbacks`. To forget the sensor id, delete `~/.7maps/sensor-id`.

## Tests

```
python -m unittest discover -s tests -v
```

LiteLLM is not needed for the tests: they feed the callback the same shapes LiteLLM passes and check that nothing private reaches the reporter.
