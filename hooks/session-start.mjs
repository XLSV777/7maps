#!/usr/bin/env node
// 7Maps SessionStart hook (Claude Code plugin and Gemini CLI extension; both load hooks/hooks.json).
// Reads the MCP servers configured for this project (Claude Code: .mcp.json, and ~/.claude.json: this
// project's servers and the user's own; Gemini CLI: .gemini/settings.json and ~/.gemini/settings.json), downloads the public 7Maps down list once (https://7it.co.il/7maps/down.json, kept
// 10 minutes in a cache folder of this user, ~/.cache/7maps, so most sessions make no request at all) and compares hashes of the
// configured addresses with it ON THIS MACHINE. No server address, name or config is sent anywhere.
// When a configured server is on the list, it adds one line of context per server, so Claude says
// "configured but down, on the server's side" instead of "not configured" or a long investigation.
// Otherwise it adds nothing. It never blocks a session: any failure, timeout or missing file ends silently.
// Off switch: set the environment variable SEVENMAPS_HOOK=off.
import fs from 'node:fs';
import { configuredServers, contextLines, downList, downMatches } from './down-list.mjs';

function readStdin() { try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; } }

async function main() {
  if (String(process.env.SEVENMAPS_HOOK || '').toLowerCase() === 'off') return;
  const input = readStdin();
  // Gemini CLI sets GEMINI_SESSION_ID (and CLAUDE_PROJECT_DIR as an alias) for its hooks.
  const gemini = !!process.env.GEMINI_SESSION_ID || !!process.env.GEMINI_PROJECT_DIR;
  const dir = (gemini ? process.env.GEMINI_PROJECT_DIR : process.env.CLAUDE_PROJECT_DIR) || input.cwd || process.cwd();
  const servers = configuredServers(dir, gemini ? 'gemini' : 'claude');
  if (!servers.length) return;
  const hits = downMatches(servers, await downList(gemini ? 'gemini-hook' : 'claude-hook'));
  if (!hits.length) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: contextLines(hits).join('\n') } }));
}

// No process.exit(): on Windows it can abort Node while a fetch handle is closing (libuv assertion).
main().catch(() => {}).finally(() => { process.exitCode = 0; });
