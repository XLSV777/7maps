// 7Maps down list, shared by the Claude Code session hook and the Gemini CLI tool-selection hook.
// Downloads ONE public file, https://7it.co.il/7maps/down.json (the servers on the 7Maps map that are not
// answering right now, as short hashes), keeps it on disk for 10 minutes in a cache folder of this user (~/.cache/7maps), and compares
// it with hashes of the MCP servers configured on this machine. The comparison happens here: no server
// address, name or config is ever sent anywhere. The only request is a plain GET of that file.
// Node built-ins only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export const LIST_URL = 'https://7it.co.il/7maps/down.json';
const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 2500;
const CACHE_NAME = 'down-v1.json';

// The cache lives in a folder of this user's own (XDG_CACHE_HOME/7maps, else ~/.cache/7maps, mode 0700),
// never in the shared temp folder, where another account could plant a list.
export function cacheDir(env = process.env, home = os.homedir()) {
  const xdg = String(env.XDG_CACHE_HOME || '');
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(home, '.cache'), '7maps');
}
const ownUid = () => (typeof process.getuid === 'function' ? process.getuid() : null);
// A cache file (or folder) is trusted only when it is a real file (or folder), not a link, and,
// where the system has user ids, owned by this user.
function trusted(p, kind) {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || (kind === 'dir' ? !st.isDirectory() : !st.isFile())) return false;
    const uid = ownUid();
    return uid == null || st.uid === uid;
  } catch { return false; }
}
export function readCache(dir = cacheDir()) {
  const f = path.join(dir, CACHE_NAME);
  if (!trusted(dir, 'dir') || !trusted(f, 'file')) return null;
  return readJson(f);
}
export function writeCache(data, dir = cacheDir()) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!trusted(dir, 'dir')) return false;
    try { fs.chmodSync(dir, 0o700); } catch { /* not ours to change: still ours to write */ }
    const tmp = path.join(dir, `${CACHE_NAME}.${process.pid}.${randomBytes(6).toString('hex')}`);
    const fd = fs.openSync(tmp, 'wx', 0o600); // a fresh file: never follows or reuses an existing one
    try { fs.writeSync(fd, JSON.stringify(data)); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, path.join(dir, CACHE_NAME));
    return true;
  } catch { return false; } // read-only home: fine, no cache
}

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
export async function downList(via, now = Date.now(), dir = cacheDir()) {
  const c = readCache(dir);
  if (c && typeof c.fetched_at === 'number' && now - c.fetched_at < TTL_MS && now >= c.fetched_at && validList(c.list)) return c.list;
  let list = null;
  try {
    const r = await fetch(LIST_URL + (via ? '?via=' + encodeURIComponent(via) : ''), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
    if (r.ok) list = validList(await r.json());
  } catch { /* offline or slow: no list */ }
  if (list) writeCache({ fetched_at: now, list }, dir);
  return list;
}

// The configured servers that are on the down list.
export function downMatches(servers, list) {
  if (!list) return [];
  const len = list.hashes[0]?.length || 12;
  const set = new Set(list.hashes);
  return servers.filter((s) => set.has(keyHash(s.key, len)));
}

// Names and addresses come from config files in the project, which anyone who wrote the project
// controls. Only plain names and address characters reach the agent's context; anything else is replaced.
export const safeName = (n) => (typeof n === 'string' && /^[A-Za-z0-9 _.:@-]{1,64}$/.test(n) ? n : '(unnamed server)');
export const safeKey = (k) => (typeof k === 'string' && /^[a-z0-9.-]{1,253}(\/[A-Za-z0-9._~%:@!$&*+,;=-]*)*$/.test(k) && k.length <= 300 ? k : '(address not shown)');
export function contextLines(hits) {
  return hits.map((s) =>
    `MCP status for this project (7Maps): the server "${safeName(s.name)}" IS configured in ${s.file} (${safeKey(s.key)}) but it was DOWN at 7Maps' latest check (not answering). If it has no tools in this session, that is why: when a task needs it, say it is configured but down on the server's side (not a setup problem). This line is 7Maps' check: do not call road_conditions for this server, and no need to investigate further. If its tools are present, ignore this line.`);
}
