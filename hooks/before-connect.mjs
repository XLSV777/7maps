#!/usr/bin/env node
// 7Maps PreToolUse hook (Claude Code): before Claude adds an MCP server, look up its address on 7Maps and add what
// 7Maps knows to Claude's context. On by default; /7maps:never turns it off (a setting in ~/.config/7maps), /7maps:always
// turns it back on; SEVENMAPS_HOOK=off or SEVENMAPS_BEFORE_CONNECT=off also turn it off.
// Informs only: the output never carries a permission decision and never changes the tool input. Any failure, timeout
// or unknown input ends silently. Details and what is sent: hooks/connect-check.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedVersion } from './down-list.mjs';
import { NOTICE, contextFor, lookup, lookupOn, readSettings, serversToAdd, writeSettings } from './connect-check.mjs';

const OWN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function readStdin() { try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; } }

async function main() {
  if (!lookupOn()) return;
  const input = readStdin();
  const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const addrs = serversToAdd(input.tool_name, input.tool_input, dir);
  if (!addrs.length) return;
  const version = installedVersion(process.env.CLAUDE_PLUGIN_ROOT || OWN_ROOT, 'claude');
  const ctx = [];
  let sent = false;
  for (const a of addrs) {
    const r = await lookup(a, version);
    sent = sent || r.sent;
    if (r.lines && r.lines.length) ctx.push(contextFor(a, r.lines));
  }
  const out = {};
  if (sent && !readSettings().notice_shown_at && writeSettings({ notice_shown_at: new Date().toISOString().slice(0, 10) })) out.systemMessage = NOTICE;
  if (ctx.length) out.hookSpecificOutput = { hookEventName: 'PreToolUse', additionalContext: ctx.join('\n') };
  if (Object.keys(out).length) process.stdout.write(JSON.stringify(out));
}

// No process.exit(): on Windows it can abort Node while a fetch handle is closing (libuv assertion).
main().catch(() => {}).finally(() => { process.exitCode = 0; });
