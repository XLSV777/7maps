// 7Maps before-connect lookup (Claude Code, on by default since 1.6.0; off with /7maps:never).
// When Claude is about to add an MCP server (a `... mcp add <url>` command, or a write to an MCP config file such as
// .mcp.json), the PreToolUse hook looks up that server's address on 7Maps and adds 7Maps' record of it to Claude's
// context. It informs only: it never blocks, denies or changes the tool call, and on any failure it adds nothing.
// What is sent: one tools/call of road_conditions to https://7it.co.il/7maps/mcp with the server address only
// (scheme, host and path; no query string, and `*` for any path segment that looks like a key or token). Never the
// command, the file, its other contents, the project, prompts or the conversation.
// Node built-ins only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { cacheDir, configuredServers, trusted } from './down-list.mjs';

export const MCP_URL = 'https://7it.co.il/7maps/mcp';
const TIMEOUT_MS = 6000;
const TTL_MS = 10 * 60_000;
const MAX_SERVERS = 3;
const LOOKUP_NAME = 'lookup-v1.json';

// ---------------------------------------------------------------- the persistent setting (/7maps:never, /7maps:always)
// One small file of this user's own: $XDG_CONFIG_HOME/7maps/settings.json, else ~/.config/7maps/settings.json.
// It lives outside the plugin folder, so the choice survives plugin updates and reinstalls.
export function configDir(env = process.env, home = os.homedir()) {
  const xdg = String(env.XDG_CONFIG_HOME || '');
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(home, '.config'), '7maps');
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
function readPrivate(dir, name) {
  const f = path.join(dir, name);
  return trusted(dir, 'dir') && trusted(f, 'file') ? readJson(f) : null;
}
function writePrivate(dir, name, data) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!trusted(dir, 'dir')) return false;
    const tmp = path.join(dir, `${name}.${process.pid}.${randomBytes(6).toString('hex')}`);
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeSync(fd, JSON.stringify(data, null, 2) + '\n'); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, path.join(dir, name));
    return true;
  } catch { return false; }
}
export function readSettings(dir = configDir()) {
  const s = readPrivate(dir, 'settings.json');
  return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
}
export function writeSettings(patch, dir = configDir()) {
  return writePrivate(dir, 'settings.json', { ...readSettings(dir), ...patch });
}
// On unless the person turned it off (/7maps:never), or SEVENMAPS_HOOK=off / SEVENMAPS_BEFORE_CONNECT=off is set.
export function lookupOn(env = process.env, dir = configDir()) {
  if (String(env.SEVENMAPS_HOOK || '').toLowerCase() === 'off') return false;
  if (String(env.SEVENMAPS_BEFORE_CONNECT || '').toLowerCase() === 'off') return false;
  return readSettings(dir).before_connect !== 'off';
}

// ---------------------------------------------------------------- which servers the tool call is about to add
const CONFIG_FILES = new Set(['.mcp.json', 'mcp.json', '.claude.json', 'claude_desktop_config.json', 'mcp_config.json']);
export function isMcpConfigFile(p) {
  if (typeof p !== 'string' || !p) return false;
  const norm = p.replace(/\\/g, '/');
  const base = norm.split('/').pop().toLowerCase();
  if (CONFIG_FILES.has(base)) return true;
  return base === 'settings.json' && /(^|\/)\.gemini\/settings\.json$/i.test(norm);
}
const URL_RE = /https?:\/\/[^\s"'`<>\\)\]},]+/gi;
// A path segment that looks like a key or token is replaced with * (the same rule the skill gives the agent).
export function looksSecret(seg) {
  if (!seg) return false;
  if (/^(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs]|glpat|key|tok|token)[-_]/i.test(seg)) return true;
  if (seg.length >= 32 && /^[A-Za-z0-9_\-.=~]+$/.test(seg)) return true;
  return seg.length >= 20 && /[0-9]/.test(seg) && /[A-Za-z]/.test(seg);
}
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[.*\])$/i;
// The address sent to 7Maps: scheme, host (without www. and port) and path; no user, query or fragment.
export function sendableAddress(raw) {
  if (typeof raw !== 'string') return null;
  let u; try { u = new URL(raw.trim().replace(/[.;:]+$/, '')); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.includes('.') || PRIVATE_HOST.test(host)) return null;
  if (host === '7it.co.il' || host.endsWith('.7it.co.il')) return null; // 7Maps itself
  const segs = u.pathname.split('/').map((s) => (looksSecret(decodeURIComponent(s)) ? '*' : s));
  const p = segs.join('/').replace(/\/+$/, '');
  return `${u.protocol}//${host}${p}`;
}
const keyOf = (addr) => addr.replace(/^https?:\/\//, '');

// The remote MCP server addresses this tool call would add, minus the ones already configured for the project.
export function serversToAdd(toolName, toolInput, dir, home = os.homedir()) {
  const inp = toolInput && typeof toolInput === 'object' ? toolInput : {};
  let text = '';
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const cmd = typeof inp.command === 'string' ? inp.command : '';
    if (/\bmcp\s+add(-json)?\b/i.test(cmd)) text = cmd;
  } else if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
    if (!isMcpConfigFile(inp.file_path)) return [];
    if (toolName === 'Write') text = String(inp.content || '');
    else if (toolName === 'Edit') text = String(inp.new_string || '');
    else text = (Array.isArray(inp.edits) ? inp.edits : []).map((e) => String(e?.new_string || '')).join('\n');
  }
  if (!text) return [];
  const known = new Set(configuredServers(dir, 'claude', home).map((s) => s.key));
  const out = [];
  for (const m of text.slice(0, 200_000).match(URL_RE) || []) {
    const a = sendableAddress(m);
    if (!a || out.includes(a) || known.has(keyOf(a))) continue;
    out.push(a);
    if (out.length >= MAX_SERVERS) break;
  }
  return out;
}

// ---------------------------------------------------------------- the lookup and what reaches Claude's context
// Only these lines of 7Maps' answer are kept: the status line, tool risk counts and the last tool change, and the page.
const KEEP = [/^\d+ tools? \(automated risk/i, /^Tool list not public/i, /tool change/i, /^Page: https:\/\/7it\.co\.il\/7maps\/s\//];
const NO_DATA = /has no (data|check)|not on the map|cannot answer|could not|try again/i;
const clean = (s, max = 300) => String(s).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export function pickLines(text) {
  if (typeof text !== 'string' || !text.trim() || NO_DATA.test(text.split('\n')[0])) return null;
  const lines = text.split('\n').map((l) => clean(l)).filter(Boolean);
  const keep = [lines[0], ...lines.slice(1).filter((l) => KEEP.some((re) => re.test(l)))];
  return keep.slice(0, 5);
}
export function contextFor(addr, lines) {
  return `7Maps record of ${addr}, looked up before it is added to the MCP config (7Maps did not contact the server for this): ${lines.join(' ')} Information only; the tool call was not changed or blocked.`;
}

// Tests only: SEVENMAPS_MCP_URL may point the lookup at a local mock server (loopback addresses only; anything else is ignored).
export function mcpBase(env = process.env) {
  const o = String(env.SEVENMAPS_MCP_URL || '');
  try { const u = new URL(o); if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return u.origin + u.pathname; } catch { /* not set */ }
  return MCP_URL;
}
async function callRoadConditions(addr, version, f = fetch) {
  const url = `${mcpBase()}?via=claude-hook&set=agent${version ? '&pv=' + encodeURIComponent(version) : ''}`;
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'road_conditions', arguments: { server: addr } } });
  const r = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18', 'User-Agent': `7Maps-plugin-hook/${version || '0'}` }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) return null;
  let t = await r.text();
  if (t.length > 1 << 18) return null;
  if (!t.trimStart().startsWith('{')) t = (t.split('\n').find((l) => l.startsWith('data:')) || '').slice(5);
  const j = JSON.parse(t);
  if (!j?.result || j.result.isError) return null;
  const c = Array.isArray(j.result.content) ? j.result.content.find((x) => x?.type === 'text') : null;
  return typeof c?.text === 'string' ? c.text : null;
}
// One lookup per address per 10 minutes (kept in ~/.cache/7maps/lookup-v1.json, readable only by this user).
export async function lookup(addr, version, { now = Date.now(), dir = cacheDir(), f = fetch } = {}) {
  const cache = readPrivate(dir, LOOKUP_NAME);
  const entries = cache && typeof cache.e === 'object' && cache.e ? cache.e : {};
  const hit = entries[addr];
  if (hit && typeof hit.at === 'number' && now >= hit.at && now - hit.at < TTL_MS) return { lines: Array.isArray(hit.lines) ? hit.lines.map((l) => clean(l)) : null, sent: false };
  let text = null;
  try { text = await callRoadConditions(addr, version, f); } catch { text = null; }
  const lines = pickLines(text);
  if (text == null) return { lines: null, sent: true }; // no answer (offline, slow, an error): nothing is kept, the next call asks again
  const fresh = Object.fromEntries(Object.entries(entries).filter(([, v]) => v && typeof v.at === 'number' && now - v.at < TTL_MS).slice(-100));
  fresh[addr] = { at: now, lines };
  writePrivate(dir, LOOKUP_NAME, { e: fresh });
  return { lines, sent: true };
}

// The one line the person sees the first time the lookup runs on this machine.
export const NOTICE = '7Maps: before Claude adds an MCP server, the 7Maps plugin now looks up that server\'s address on 7Maps (only the address is sent) and tells Claude what 7Maps knows; it never blocks. Turn off: /7maps:never';
