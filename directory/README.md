# 7Maps (Claude directory edition)

This folder is the edition of 7Maps listed in the Claude plugin directory. It holds only the connection to the 7Maps MCP server (remote, over HTTPS at https://7it.co.il/7maps/mcp) and two commands, `/7maps:always` and `/7maps:never`, that add or remove a short 7Maps note in a project's CLAUDE.md. Nothing runs on your machine.

The full plugin in the repository root also adds a session-start note when a configured MCP server is down, and the developer packages. Install it with:

```
/plugin marketplace add XLSV777/7maps
/plugin install 7maps@7maps
```

Docs: https://7it.co.il/7maps/plugin/ · Privacy: https://7it.co.il/privacy/#7maps · License: MIT (see the repository root).
