# 7Maps

Docs: https://7it.co.il/7maps/plugin/

A live map of public MCP servers for AI agents (a map of software, not geography). Every remote server in the official MCP registry is checked daily with `initialize` and `tools/list` only. Each tool gets an automated risk estimate (read-only, needs approval or high risk) from its public description and annotations; estimates can be wrong. Agents ask one question instead of loading thousands of tool definitions:

- `find_tool`: search over 200,000 tools for one that does a job, with its server's status (no charge).
- `route`: which open server and tool can do a task, with the least access, plus alternatives and servers to avoid.
- `road_conditions`: a server's status, speed, tool risk levels, last change and agents' rating, before connecting.
- `watch`, `verify_lock`, `changes_since`: did a server a person approved change, or get riskier.
- `tool_card`, `preflight`: one tool's schema, and whether a call's arguments will pass.
- For server owners: `submit_mcp_server`, `claim_mcp_server` (ownership, alerts, a badge) and `my_server_report` (what agents looked for), no charge, on the full server (https://7it.co.il/7maps/mcp).
- `my_7maps_usage`: what 7Maps did for you, when your connection carries a personal key (see below), no charge.

The first 20 `route` and `road_conditions` calls a day are not charged; after that, paid per call in USDC on Base via x402. `about_7maps` shows a real example and prices first. How the map is made: https://7it.co.il/7maps/methodology/. More: https://7it.co.il/7maps/

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

**Claude Code plugin** (the server's agent set, an `mcp-preflight` skill, a session-start line when one of your configured servers is down, and the `/7maps:always` and `/7maps:never` commands). It works with nothing to set up.

1. Install:

```
/plugin marketplace add XLSV777/7maps
/plugin install 7maps@7maps
```

2. Recommended, once per project: `/7maps:always`. For best results: fewer tokens, and the agent goes to 7Maps directly. `/7maps:never` removes it.

**Servers already in your project.** At the start of each session (Claude Code, and Gemini CLI with the extension) the plugin's hook reads the MCP servers configured on your machine for this project (Claude Code: `.mcp.json` and `~/.claude.json`; Gemini CLI: `.gemini/settings.json` and `~/.gemini/settings.json`). It downloads one public file, `https://7it.co.il/7maps/down.json`: the servers 7Maps saw not answering at their latest check, as short hashes. It keeps that file for 10 minutes in your system's temp folder, so most sessions make no request at all. It then hashes your servers' addresses on your machine and compares. **No server address, name or setting leaves your machine**: the only request is a plain download of that list, tagged with the client (`?via=claude-hook` or `?via=gemini-hook`). If a configured server is on the list, the agent gets one line saying so, and tells you "configured but down on the server's side" instead of "not configured" or a long investigation; if the server's tools are present anyway, the line tells the agent to ignore it. It adds nothing when none of your servers is on the list, and never blocks a session. Turn it off with the environment variable `SEVENMAPS_HOOK=off`. The hook needs `node` on your PATH; without it, it does nothing. The hashing is described in the list itself (`key`), so you can check it.

The plugin connects to `https://7it.co.il/7maps/mcp?set=agent`: only the tools an agent uses in a session (`find_tool`, `route`, `road_conditions`, `watch`, `tool_card`, `preflight`, `report_road`, `my_7maps_usage`), with short descriptions, so its tool definitions take about 2,000 tokens of context instead of about 11,600. Servers can be named by URL, registry name or the vendor's plain name ("notion"). The owner tools stay on the full server above.

## Personal key (optional)

A personal key ties your agent's 7Maps calls to your own numbers: calls, servers checked, an estimate of the tokens saved and the failures avoided, per day, week and month. Create one at https://7it.co.il/7maps/me/ (no account, no email; shown once). The same page shows the dashboard, an opt-in badge, and rotates or deletes the key with its numbers. The key changes nothing about what a call costs. 7Maps works the same without one, and an empty or missing key is simply anonymous.

- **Claude Code plugin**: when you enable the plugin, Claude Code asks for the "7Maps key (optional)" setting and keeps it in your system's credential store. It is sent as the `X-7Maps-Key` header. Leave it empty to skip.
- **Claude Code without the plugin**: `claude mcp add --transport http 7maps "https://7it.co.il/7maps/mcp?via=claude-code" --header "X-7Maps-Key: 7m_your_key"`
- **Cursor, Gemini CLI, VS Code and any other MCP client**: add the header to the 7Maps server entry in your MCP settings (`.cursor/mcp.json`, `~/.gemini/settings.json`, `.vscode/mcp.json`):

```json
{ "mcpServers": { "7maps": { "url": "https://7it.co.il/7maps/mcp", "headers": { "X-7Maps-Key": "7m_your_key" } } } }
```

`Authorization: Bearer 7m_...` works too. Then ask your agent to call `my_7maps_usage`, or open the dashboard. Tokens saved is an estimate: what the agent would realistically have spent to make the same decision without 7Maps (connecting to the one server in question, or a web search for a tool), minus the answer and the share of the context 7Maps' own tool definitions take, counted conservatively.

**Plain HTTP x402**: `POST https://7it.co.il/7maps/x402/<tool>` with the arguments as JSON. [OpenAPI](https://7it.co.il/openapi.json).

## Make it a habit for your agent

**Claude Code plugin**: two optional commands.

- `/7maps:always` (recommended, once per project) adds a short, marked section to this project's `CLAUDE.md` (it creates the file if there is none) asking Claude to check 7Maps before choosing, adding, connecting to or re-using an MCP server, and to use `find_tool` to find MCP tools. Claude shows you the exact text and asks before writing. If the project has an `AGENTS.md` and no `CLAUDE.md`, the new file starts with `@AGENTS.md` so Claude Code keeps reading it.
- `/7maps:never` removes that section again, and nothing else.

The section is plain text between two marker lines, `<!-- 7maps:begin -->` and `<!-- 7maps:end -->`, so you can also read, edit or delete it by hand. Nothing changes until you run `/7maps:always`.

**Any agent**: paste into `CLAUDE.md`, `AGENTS.md` or `.cursor/rules`:

```
## MCP servers
- Before connecting to an MCP server you have not used today, call 7Maps road_conditions
  with its address. Do not connect if it is down, or if its tools changed since a person
  approved it, until the person approves again.
- When you need a tool and do not know which MCP server has it, call 7Maps find_tool first
  (or route) with the task in plain words, and use the server and tool it returns.
- After calling a server 7Maps pointed you to, report it with report_road.
- If 7Maps cannot answer, say so in one line and continue as usual.
```

## Guard your MCP client

`7maps-guard` is client middleware that checks a server on 7Maps before connecting (deny only when it is down, or got riskier since a person approved it) and, if you switch telemetry on, reports how each tool call went so the shared map stays accurate. If 7Maps cannot answer, it allows the call.

- Node.js: [`packages/guard-js`](packages/guard-js) (`npm install 7maps-guard`, wraps the official `@modelcontextprotocol/sdk` Client, plus `npx 7maps-guard check <url>` for CI)
- Python: [`packages/guard-py`](packages/guard-py) (`pip install sevenmaps-guard`, standard library only, `guarded_call` for the official `mcp` ClientSession)

Each README lists exactly what is sent.

## Sensors for gateways

If you run an MCP gateway, an opt-in sensor can send 7Maps the outcome of each tool call it forwards: server, worked or failed, failure reason, milliseconds, tool name, time. Never arguments, results, prompts, users or tokens. Outcomes from many gateways feed the ratings every agent sees and, together with 7Maps' own checks, its live incident flags. Off unless `SEVENMAPS_SENSOR=1`.

- LiteLLM proxy (a `CustomLogger`): [`packages/sensor-litellm`](packages/sensor-litellm)
- IBM ContextForge (a cpex plugin): [`packages/sensor-contextforge`](packages/sensor-contextforge)
- MCP Python SDK client and any Python gateway: [`packages/sensor-py`](packages/sensor-py)
- MCP TypeScript SDK client and any Node.js gateway: [`packages/sensor-js`](packages/sensor-js)

Each README shows the exact payload, what is never sent, and how to switch it on and off.

## Own an MCP server?

Put a new server on the map at https://7it.co.il/7maps/submit/ (observed for 7 days first; placement cannot be bought), or see how the crawler works and opt out at https://7it.co.il/7maps/bot/.

By [7IT](https://7it.co.il/). Registry name: `io.github.XLSV777/7maps`.
