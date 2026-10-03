---
description: Add a short, marked note to this project's CLAUDE.md so Claude uses 7Maps when it chooses, adds or connects to an MCP server, or when a configured one fails. Remove it with /7maps:never.
disable-model-invocation: true
---

The person asked to make 7Maps part of this project's instructions. Add the block below to the project's CLAUDE.md, and nothing else.

1. Pick the file, in the project root (the directory this session started in):
   - `CLAUDE.md` if it exists, otherwise `.claude/CLAUDE.md` if that exists.
   - If neither exists, create `CLAUDE.md`. If an `AGENTS.md` sits in the project root, make the first line of the new file `@AGENTS.md`, because a new CLAUDE.md would otherwise stop Claude Code from reading AGENTS.md. Tell the person you did this.
2. If the file already contains the line `<!-- 7maps:begin -->`, change nothing and tell the person the block is already there.
3. Show the person the file path and the exact block, then write it with your normal file tools so the usual permission prompt applies. If your current permission mode would write without asking, ask the person to confirm first. Append the block at the end of the file, after one blank line. Do not change any other part of the file.

```markdown
<!-- 7maps:begin -->
## MCP servers (7Maps)

Added with /7maps:always. Remove with /7maps:never, or delete this section.

- To find an MCP tool or server for a job, call the 7Maps tool `find_tool` first, with the job in plain words. If the job names a vendor (Notion, Linear, Sentry), its own server comes first in the answer.
- To add a server for a job, take one from the `find_tool` answer that answered without sign-in and whose tool fits the job, and write its URL into the config (`"type": "http"`). That status line is the check; look at local packages only if the person asks for one or no listed server fits.
- Before connecting to a server that is not configured here, or when asked whether a server works, check it with `road_conditions` (a URL, registry name or the vendor's plain name all work). `watch` shows what changed since a person approved a server.
- Servers configured in this project whose tools work in this session: use them directly, with no 7Maps check. Check one (with the URL from the config) only when its tools are missing, fail or behave unexpectedly.
- If a 7Maps note at the start of this session says a configured server is down, that is the check: tell the person it is configured but down on the server's side, without calling `road_conditions` for it.
- If 7Maps is not connected or cannot answer, say so in one line and continue as usual.
<!-- 7maps:end -->
```

4. Confirm in two or three short lines: which file changed, what the block asks, and that `/7maps:never` (or deleting the section) removes it. Mention that the two `<!-- 7maps -->` comment lines only mark where the block starts and ends; Claude Code leaves HTML comments out of what it reads.
