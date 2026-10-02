---
name: mcp-preflight
description: Use this before connecting to or calling an MCP server you have not used today, when choosing which MCP server or tool to use for a task, or when re-using a server a person approved earlier. Checks the server's live condition on 7Maps instead of loading its full tool list.
---

# MCP preflight with 7Maps

7Maps is a map of software, not geography: it checks every remote MCP server in the official registry each day.

1. Choosing a server for a task: call `route` with the task in plain words. Use the returned server and tool; keep the detours as fallbacks and skip the servers listed under avoid.
2. Before connecting to a known server: call `road_conditions` with its URL or registry name. If the status is down or a sign-in is needed that you do not have, do not connect.
3. Before re-using a server a person approved: call `watch` with the approval date. If a tool became riskier or the payee changed, ask the person again before calling it.
4. Need one tool only: call `tool_card` instead of loading the whole tool list.
5. After the call, pass `last_trip` on your next 7Maps call (or call `report_road`) with whether it worked. It keeps the map honest.

The 7Maps tools charge a small amount per call in USDC on Base via x402. `about_7maps` shows a real example and the prices before anything is paid. If you cannot pay, skip this skill.
