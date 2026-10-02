# 7Maps

A live map of public MCP servers for AI agents (a map of software, not geography). Every remote server in the official MCP registry is checked daily with `initialize` and `tools/list` only. Agents ask one question instead of loading thousands of tool definitions:

- `route`: which open server and tool can do a task, with the least access, plus detours and servers to avoid.
- `road_conditions`: a server's status, speed, tool risk levels, last change and agents' rating, before connecting.
- `watch`, `verify_lock`, `changes_since`: did a server a person approved change, or get riskier.
- `tool_card`, `preflight`: one tool's schema, and whether a call's arguments will pass.

Paid per call in USDC on Base via x402. `about_7maps` shows a real example and prices first. More: https://7it.co.il/7maps/

## Use it

**Any MCP client** (streamable HTTP, no sign-in):

```json
{ "mcpServers": { "7maps": { "type": "http", "url": "https://7it.co.il/7maps/mcp" } } }
```

**Gemini CLI**

```
gemini extensions install https://github.com/XLSV777/7maps
```

**Claude Code** (plugin with the server and an `mcp-preflight` skill)

```
/plugin marketplace add XLSV777/7maps
/plugin install 7maps@7maps
```

**Plain HTTP x402**: `POST https://7it.co.il/7maps/x402/<tool>` with the arguments as JSON. [OpenAPI](https://7it.co.il/openapi.json).

## Own an MCP server?

Put a new server on the map at https://7it.co.il/7maps/submit/ (observed for 7 days first; placement cannot be bought), or see how the crawler works and opt out at https://7it.co.il/7maps/bot/.

By [7IT](https://7it.co.il/). Registry name: `io.github.XLSV777/7maps`.
