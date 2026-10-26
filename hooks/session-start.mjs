#!/usr/bin/env node
// 7Maps SessionStart hook (Claude Code plugin and Gemini CLI extension; both load hooks/hooks.json).
// Reads the MCP servers configured for this project (Claude Code: .mcp.json, and ~/.claude.json: this
// project's servers and the user's own; Gemini CLI: .gemini/settings.json and ~/.gemini/settings.json), downloads the public 7Maps down list once (https://7it.co.il/7maps/down.json, kept
// 10 minutes in a cache folder of this user, ~/.cache/7maps, so most sessions make no request at all) and compares hashes of the
// configured addresses with it ON THIS MACHINE. No server address, name or config is sent anywhere.
// When a configured server is on the list, it adds one line of context per server, so Claude says
// "configured but down, on the server's side" instead of "not configured" or a long investigation.
// Otherwise it adds nothing. It never blocks a session: any failure, timeout or missing file ends silently.
// Update notice: down.json also names the newest plugin version (plugin_latest). When the running plugin
// is older, it adds one line saying so and how to update, at most once per session, with no extra request
// (the list already fetched, or the cached copy when no server is configured).
// Off switch: set the environment variable SEVENMAPS_HOOK=off.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedList, configuredServers, contextLines, downList, downMatches, firstNoticeFor, installedVersion, updateLine } from './down-list.mjs';

const OWN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readStdin() { try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; } }

async function main() {
  if (String(process.env.SEVENMAPS_HOOK || '').toLowerCase() === 'off') return;
  const input = readStdin();
  // Gemini CLI sets GEMINI_SESSION_ID (and CLAUDE_PROJECT_DIR as an alias) for its hooks.
  const gemini = !!process.env.GEMINI_SESSION_ID || !!process.env.GEMINI_PROJECT_DIR;
  const dir = (gemini ? process.env.GEMINI_PROJECT_DIR : process.env.CLAUDE_PROJECT_DIR) || input.cwd || process.cwd();
  const client = gemini ? 'gemini' : 'claude';
  const servers = configuredServers(dir, client);
  const list = servers.length ? await downList(gemini ? 'gemini-hook' : 'claude-hook') : cachedList();
  const lines = contextLines(downMatches(servers, list));
  const root = (!gemini && process.env.CLAUDE_PLUGIN_ROOT) || OWN_ROOT;
  const upd = updateLine(installedVersion(root, client), list, client);
  const session = input.session_id || process.env.GEMINI_SESSION_ID || '';
  if (upd && (session ? firstNoticeFor(session) : !input.source || input.source === 'startup')) lines.push(upd);
  if (!lines.length) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } }));
}

// No process.exit(): on Windows it can abort Node while a fetch handle is closing (libuv assertion).
main().catch(() => {}).finally(() => { process.exitCode = 0; });
