# 7Maps

A live map of public MCP servers for AI agents (a map of software, not geography). Every remote server in the official MCP registry is checked daily with `initialize` and `tools/list` only. Agents ask one question instead of loading thousands of tool definitions:

- `route`: which open server and tool can do a task, with the least access, plus detours and servers to avoid.
- `road_conditions`: a server's status, speed, tool risk levels, last change and agents' rating, before connecting.
- `watch`, `verify_lock`, `changes_since`: did a server a person approved change, or get riskier.
- `tool_card`, `preflight`: one tool's schema, and whether a call's arguments will pass.

Paid per call in USDC on Base via x402. `about_7maps` shows a real example and prices first. More: https://7it.co.il/7maps/

## Use it

[Add to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=7maps&config=eyJ1cmwiOiJodHRwczovLzdpdC5jby5pbC83bWFwcy9tY3A/dmlhPWN1cnNvciJ9) · [Add to VS Code](vscode:mcp/install?%7B%22name%22%3A%227maps%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2F7it.co.il%2F7maps%2Fmcp%3Fvia%3Dvscode%22%7D) (GitHub may not open these links; the buttons also live at https://7it.co.il/7maps/)

**Claude Code**, one line:

```
claude mcp add --transport http 7maps "https://7it.co.il/7maps/mcp?via=claude-code"
```

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

## Make it a habit for your agent

Paste into `CLAUDE.md`, `AGENTS.md` or `.cursor/rules`:

```
## MCP servers
- Before connecting to an MCP server you have not used today, call 7Maps road_conditions
  with its address. Do not connect if it is down, or if its tools changed since a person
  approved it, until the person approves again.
- When you need a tool and do not know which MCP server has it, call 7Maps route with the
  task in plain words, and use the server and tool it returns.
- After calling a server 7Maps pointed you to, pass last_trip on your next 7Maps call.
```

## Own an MCP server?

Put a new server on the map at https://7it.co.il/7maps/submit/ (observed for 7 days first; placement cannot be bought), or see how the crawler works and opt out at https://7it.co.il/7maps/bot/.

By [7IT](https://7it.co.il/). Registry name: `io.github.XLSV777/7maps`.
