# Changelog

## Unreleased

- Listing icon (`.claude-plugin/icon.png`, the 7Maps mark).

## 1.5.3 (2026-10-28)

- Gemini CLI: the MCP server in gemini-extension.json uses `url` with `type: "http"` instead of the deprecated `httpUrl` (same address, same transport).

## 1.5.2 (2026-10-28)

- Reports: after calling a server 7Maps pointed you to, add the ready `last_trip` (server, tool, ok, ms) to your next 7Maps call, on any call, paid or not; `report_road` when there is no next call.
- `termsOfServiceUrl` in the plugin manifest.

Earlier versions are in the git history.
