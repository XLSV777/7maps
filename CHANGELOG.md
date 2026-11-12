# Changelog

## 1.6.0 (2026-11-12)

- Before Claude adds a new MCP server (a `claude mcp add` command, or a write to an MCP config file such as `.mcp.json`), the plugin looks up that server's address on 7Maps and adds 7Maps' record of it to Claude's context: status at the last check, sign-in, tool risk counts, last tool change, its page. On by default in Claude Code; it informs only and never blocks or changes the call. Only the address is sent (scheme, host and path). One line tells you the first time it runs.
- `/7maps:never` now also turns that lookup off on this machine (a setting in `~/.config/7maps/settings.json`); `/7maps:always` turns it back on. `SEVENMAPS_BEFORE_CONNECT=off` works too.

## 1.5.4 (2026-10-29)

- Listing icon (`.claude-plugin/icon.png`, the 7Maps mark).

## 1.5.3 (2026-10-28)

- Gemini CLI: the MCP server in gemini-extension.json uses `url` with `type: "http"` instead of the deprecated `httpUrl` (same address, same transport).

## 1.5.2 (2026-10-28)

- Reports: after calling a server 7Maps pointed you to, add the ready `last_trip` (server, tool, ok, ms) to your next 7Maps call, on any call, paid or not; `report_road` when there is no next call.
- `termsOfServiceUrl` in the plugin manifest.

Earlier versions are in the git history.
