---
description: Turn off the 7Maps before-connect lookup on this machine (all projects), and remove the 7Maps block that /7maps:always added to this project's CLAUDE.md. /7maps:always turns it back on.
disable-model-invocation: true
---

The person asked to turn 7Maps' before-connect lookup off and to remove the 7Maps note from this project's instructions.

1. Run this one command and show the person the line it prints:
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/setting.mjs" off`
   It writes one small setting file of their own (`~/.config/7maps/settings.json`, or under `$XDG_CONFIG_HOME`) and sends nothing. From then on the plugin no longer looks up an MCP server's address on 7Maps before Claude adds it, in any project, until `/7maps:always` turns it back on. If the command cannot run (no `node`), tell the person they can set the environment variable `SEVENMAPS_BEFORE_CONNECT=off` instead.
2. Look in the project root (the directory this session started in) at `CLAUDE.md` and `.claude/CLAUDE.md`.
3. In each one, find the block that starts with the line `<!-- 7maps:begin -->` and ends with the line `<!-- 7maps:end -->`. If neither file has it, change nothing there and say there is no 7Maps block in this project.
4. Remove exactly those lines, from the begin line to the end line, plus one blank line left behind. Use your normal file tools so the usual permission prompt applies; if your current permission mode would write without asking, ask the person to confirm first. Do not change any other part of the file. If the file is now empty, or holds only an `@AGENTS.md` line that /7maps:always added, ask the person whether to delete the file; do not delete it unasked.
5. Confirm in two or three short lines: the lookup is off on this machine, which file changed (if any), and that `/7maps:always` turns the lookup back on and offers the block again. The 7Maps plugin itself stays installed; `/plugin disable 7maps@7maps` turns it off.
