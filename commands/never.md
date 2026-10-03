---
description: Remove the 7Maps block that /7maps:always added to this project's CLAUDE.md.
disable-model-invocation: true
---

The person asked to remove the 7Maps note from this project's instructions.

1. Look in the project root (the directory this session started in) at `CLAUDE.md` and `.claude/CLAUDE.md`.
2. In each one, find the block that starts with the line `<!-- 7maps:begin -->` and ends with the line `<!-- 7maps:end -->`. If neither file has it, change nothing and say there is no 7Maps block in this project.
3. Remove exactly those lines, from the begin line to the end line, plus one blank line left behind. Use your normal file tools so the usual permission prompt applies; if your current permission mode would write without asking, ask the person to confirm first. Do not change any other part of the file. If the file is now empty, or holds only an `@AGENTS.md` line that /7maps:always added, ask the person whether to delete the file; do not delete it unasked.
4. Confirm in one or two short lines which file changed, and that `/7maps:always` adds the block again. The 7Maps plugin itself stays installed; `/plugin disable 7maps@7maps` turns it off.
