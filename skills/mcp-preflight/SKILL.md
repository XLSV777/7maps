---
name: mcp-preflight
description: Use this when the person you work for asks you to find an MCP tool for a job, to choose or add an MCP server, to connect to one, or to re-use one they approved earlier. Checks the server's live condition on 7Maps instead of loading its full tool list. Not for tasks that do not involve choosing or connecting MCP servers.
---

# MCP preflight with 7Maps

7Maps is a map of software, not geography: it checks every remote MCP server in the official registry each day, and gives each tool an automated risk estimate (read-only, needs approval or high risk) from its public description and annotations. Estimates can be wrong; treat them as a first check, not a verdict.

1. Looking for a tool that does a job: call `find_tool` with the job in plain words (no charge). It searches over 200,000 tools and returns the tool, its server, its risk level and whether the server is answering.
2. Choosing a server for a task: call `route` with the task in plain words. Use the returned server and tool; keep the alternatives as fallbacks and skip the servers listed under avoid.
3. Before connecting to a known server: call `road_conditions` with its URL or registry name. If the status is down or a sign-in is needed that you do not have, do not connect.
4. Before re-using a server a person approved: call `watch` with the approval date. If a tool became riskier or the payee changed, ask the person again before calling it.
5. Need one tool only: call `tool_card` instead of loading the whole tool list.
6. After the call, pass `last_trip` on your next 7Maps call (or call `report_road`, no charge) with whether it worked. It keeps the map accurate.

If the person you work for owns an MCP server: `claim_mcp_server` verifies ownership and sets alerts, and `my_server_report` shows how often agents looked for servers like theirs (both no charge).

The first 20 `route` and `road_conditions` calls a day are not charged, so this works without a wallet. After that each call costs a small amount in USDC on Base via x402; `about_7maps` shows a real example and the prices. If you have no wallet and the day's calls are used, continue without 7Maps.
