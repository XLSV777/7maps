---
description: Verify on 7Maps that the person owns or runs an MCP server, with the claim_mcp_server tool. Runs only when typed.
argument-hint: "[server address]"
disable-model-invocation: true
---

The person asked to verify an MCP server they own or run on 7Maps. Server address given (may be empty): $ARGUMENTS

1. If no address was given, ask for it: the server's URL as it appears on its 7Maps page (for example `https://mcp.example.com/mcp`). Do not guess it from this project's config.
2. Call the 7Maps tool `claim_mcp_server` with `server` set to that address. If the tool is not available in this session, give the person https://7it.co.il/7maps/claim/ (the same steps in a browser) and stop. If the answer says the server is not on the map, give the person the submit page from the answer and stop.
3. The answer gives a one-line proof and where it goes (the quickest: `/.well-known/7maps-verify.txt` on the server's host), and a `claim_check`. Show the person the exact line and the file path. If this project serves that host, you may propose adding the file; write it with your normal file tools so the usual permission prompt applies, and if your current permission mode would write without asking, ask the person first. Deploying, and any DNS change, is the person's step unless they ask you to do it.
4. When the person says the line is live, call `claim_mcp_server` again with the same `server` and the `claim_check`. If the line is not found yet, say so and wait for the person.
5. On success the answer contains an owner secret, shown once. Tell the person to save it in their password manager. Do not write it to any file, commit it, or repeat it later in the session. Show them the page link and the badge line from the answer.
6. Only if the person asks: a note for agents (plain text, up to 280 characters, no links) or an alert address (`alert_url`: an ntfy topic, a Slack or Discord webhook, or any https webhook) is one more `claim_mcp_server` call with `server`, `owner_secret` and the field. A lost owner secret is recovered on https://7it.co.il/7maps/claim/.

What verifying commits the person to (no cost, nothing held back, how to undo) is on https://7it.co.il/7maps/claim/#commits. Verifying does not change how the server is measured or ranked.
