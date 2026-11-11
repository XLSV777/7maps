# Changelog

## Unreleased

- `/7maps:verify`: verify an MCP server you own or run, with `claim_mcp_server` (now in the plugin's tool set on the 7Maps side). Runs only when typed.
- The `mcp-preflight` skill names `claim_mcp_server` for an owner who asks to verify their server.

## 1.5.4 (2026-10-29)

- Listing icon (`.claude-plugin/icon.png`, the 7Maps mark).

## 1.5.3 (2026-10-28)

- Gemini CLI: the MCP server in gemini-extension.json uses `url` with `type: "http"` instead of the deprecated `httpUrl` (same address, same transport).

## 1.5.2 (2026-10-28)

- Reports: after calling a server 7Maps pointed you to, add the ready `last_trip` (server, tool, ok, ms) to your next 7Maps call, on any call, paid or not; `report_road` when there is no next call.
- `termsOfServiceUrl` in the plugin manifest.

Earlier versions are in the git history.
