// 7Maps down list, shared by the Claude Code session hook and the Gemini CLI tool-selection hook.
// Downloads ONE public file, https://7it.co.il/7maps/down.json (the servers on the 7Maps map that are not
// answering right now, as short hashes), keeps it on disk for 10 minutes in the OS temp folder, and compares
// it with hashes of the MCP servers configured on this machine. The comparison happens here: no server
// address, name or config is ever sent anywhere. The only request is a plain GET of that file.
// Node built-ins only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const LIST_URL = 'https://7it.co.il/7maps/down.json';
const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 2500;
const CACHE = path.join(os.tmpdir(), '7maps-down-v1.json');

// The map's server key (described in down.json "key"): lower-case hostname without a leading "www." and
// without the port, then the path with trailing slashes removed; no query, no fragment. http(s) only.
export function serverKey(raw) {
  if (typeof raw !== 'string' || !/^https?:\/\//i.test(raw.trim())) return null;
  let u; try { u = new URL(raw.trim()); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.includes('.')) return null; // localhost and bare names are never on the map
  return host + (u.pathname.replace(/\/+$/, '') || '');
}
export const keyHash = (key, len = 12) => createHash('sha256').update(key, 'utf8').digest('hex').slice(0, len);

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const urlOf = (e) => (e && typeof e === 'object' ? [e.url, e.httpUrl, e.serverUrl].find((x) => typeof x === 'string') : null);

// The remote MCP servers configured for a project, as [{ name, key, file }].
//   claude: <project>/.mcp.json, and ~/.claude.json (servers for this project, and the user's own servers)
//   gemini: <project>/.gemini/settings.json and ~/.gemini/settings.json (mcpServers: url or httpUrl)
//   cursor: <project>/.cursor/mcp.json and ~/.cursor/mcp.json
export function configuredServers(dir, client = 'claude', home = os.homedir()) {
  const sources = [];
  if (client === 'claude') {
    sources.push(['.mcp.json', readJson(path.join(dir, '.mcp.json'))?.mcpServers]);
    const cj = readJson(path.join(home, '.claude.json'));
    if (cj) {
      const projects = cj.projects || {};
      const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
      const mine = Object.keys(projects).find((p) => norm(p) === norm(dir));
      if (mine) sources.push(['~/.claude.json', projects[mine]?.mcpServers]);
      sources.push(['~/.claude.json', cj.mcpServers]);
    }
  } else if (client === 'gemini') {
    sources.push(['.gemini/settings.json', readJson(path.join(dir, '.gemini', 'settings.json'))?.mcpServers]);
    sources.push(['~/.gemini/settings.json', readJson(path.join(home, '.gemini', 'settings.json'))?.mcpServers]);
  } else if (client === 'cursor') {
    sources.push(['.cursor/mcp.json', readJson(path.join(dir, '.cursor', 'mcp.json'))?.mcpServers]);
    sources.push(['~/.cursor/mcp.json', readJson(path.join(home, '.cursor', 'mcp.json'))?.mcpServers]);
  }
  const out = [], seen = new Set();
  for (const [file, servers] of sources) {
    if (!servers || typeof servers !== 'object') continue;
    for (const [name, e] of Object.entries(servers)) {
      if (e && e.disabled === true) continue;
      const key = serverKey(urlOf(e));
      if (!key || seen.has(name + '|' + key)) continue;
      seen.add(name + '|' + key);
      out.push({ name, key, file });
    }
  }
  return out.slice(0, 50);
}

function validList(d) {
  return d && Array.isArray(d.hashes) && d.hashes.every((h) => typeof h === 'string' && /^[0-9a-f]{6,64}$/.test(h)) ? d : null;
}

// The list: from the disk cache when it is under 10 minutes old, otherwise one GET (2.5 s at most).
// via names the client in the request (a public counter of fetches); nothing else is sent.
export async function downList(via, now = Date.now()) {
  const c = readJson(CACHE);
  if (c && typeof c.fetched_at === 'number' && now - c.fetched_at < TTL_MS && now >= c.fetched_at && validList(c.list)) return c.list;
  let list = null;
  try {
    const r = await fetch(LIST_URL + (via ? '?via=' + encodeURIComponent(via) : ''), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
    if (r.ok) list = validList(await r.json());
  } catch { /* offline or slow: no list */ }
  if (list) {
    try { const tmp = CACHE + '.' + process.pid; fs.writeFileSync(tmp, JSON.stringify({ fetched_at: now, list })); fs.renameSync(tmp, CACHE); } catch { /* read-only temp: fine */ }
  }
  return list;
}

// The configured servers that are on the down list.
export function downMatches(servers, list) {
  if (!list) return [];
  const len = list.hashes[0]?.length || 12;
  const set = new Set(list.hashes);
  return servers.filter((s) => set.has(keyHash(s.key, len)));
}
