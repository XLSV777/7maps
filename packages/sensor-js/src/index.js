// 7maps-sensor: an opt-in reporter of MCP tool-call outcomes for gateways and clients.
// It sends 7Maps (https://7it.co.il/7maps/) only: server address (no query, fragment or
// credentials), ok, fail reason, ms, tool name and time, plus a random sensor id, the
// gateway kind and this package's version. Never arguments, results, prompts, user ids,
// headers or tokens. Off unless SEVENMAPS_SENSOR=1 or `enabled: true`.
//
// record() is synchronous and O(1): it never awaits the network and never throws. Outcomes
// wait in a bounded queue (dropped when full) and are sent in batches of up to 100, every
// 60 seconds or as soon as 100 are waiting, with retries and backoff on network errors.
// No dependencies; Node 18 or later (global fetch).

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const VERSION = '0.1.0';
export const DEFAULT_ENDPOINT = 'https://7it.co.il/7maps/sensor';
export const FAIL_REASONS = ['unreachable', 'auth', 'args', 'server_error', 'timeout', 'rate_limited', 'wrong_result'];
const TOOL_NAME = /^[A-Za-z0-9_.:\/-]{1,128}$/;
const KIND = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const env = (k) => { try { return typeof process !== 'undefined' ? process.env?.[k] : undefined; } catch { return undefined; } };

/** True only when switched on: `explicit` wins, else env SEVENMAPS_SENSOR=1. SEVENMAPS_SENSOR=0 always wins. */
export function sensorEnabled(explicit) {
  if (env('SEVENMAPS_SENSOR') === '0' || explicit === false) return false;
  return explicit === true || env('SEVENMAPS_SENSOR') === '1';
}

/** Scheme, host and path only: query strings, fragments and user:password can carry keys. */
export function cleanServer(server) {
  const s = String(server || '').trim();
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return `${u.protocol}//${u.host}${u.pathname}`.slice(0, 300);
  } catch { /* a registry name such as io.github.owner/repo */ }
  return s.split(/[?#\s]/)[0].slice(0, 300);
}

/** Maps an error thrown by an MCP call to a 7Maps fail reason. */
export function failReason(err) {
  const e = err || {};
  const code = typeof e.code === 'number' ? e.code : typeof e.status === 'number' ? e.status : undefined;
  const name = String(e.name || ''), msg = String(e.message || e || '');
  if (code === -32001 || code === 408 || name === 'TimeoutError' || name === 'AbortError' || /timed? ?out/i.test(msg)) return 'timeout';
  if (code === 401 || code === 403 || name === 'UnauthorizedError' || /\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(msg)) return 'auth';
  if (code === 429 || /\b429\b|too many requests|rate.?limit/i.test(msg)) return 'rate_limited';
  if (code === -32602 || /invalid (params|arguments)/i.test(msg)) return 'args';
  const cause = String(e.cause?.code || e.cause?.message || '');
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH/.test(cause + msg) || /fetch failed/i.test(msg)) return 'unreachable';
  return 'server_error';
}

/**
 * The sensor id: random, made once and kept in a file (SEVENMAPS_SENSOR_ID_FILE, default
 * ~/.7maps/sensor-id) so restarts keep it. SEVENMAPS_SENSOR_ID overrides. If the file cannot be
 * written, a new random id is used for this process.
 */
export function sensorId(file) {
  const given = env('SEVENMAPS_SENSOR_ID');
  if (given && /^(t-)?[A-Za-z0-9_-]{16,64}$/.test(given)) return given;
  const path = file || env('SEVENMAPS_SENSOR_ID_FILE') || join(homedir(), '.7maps', 'sensor-id');
  try { const v = readFileSync(path, 'utf8').trim(); if (/^[A-Za-z0-9_-]{16,64}$/.test(v)) return v; } catch { /* first run */ }
  const id = randomBytes(18).toString('base64url');
  try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, id + '\n', { mode: 0o600 }); } catch { /* read-only home: id for this process only */ }
  return id;
}

/** One outcome in the wire format, or null when it cannot be sent (no usable server). */
export function toWire(o) {
  if (!o || typeof o !== 'object') return null;
  const server = cleanServer(o.server);
  if (server.length < 3) return null;
  const ok = !!o.ok;
  const out = { server, ok };
  if (!ok && FAIL_REASONS.includes(o.fail)) out.fail = o.fail;
  if (typeof o.ms === 'number' && Number.isFinite(o.ms)) out.ms = Math.min(600000, Math.max(0, Math.round(o.ms)));
  if (typeof o.tool === 'string' && TOOL_NAME.test(o.tool)) out.tool = o.tool;
  const at = o.at instanceof Date ? o.at : new Date(typeof o.at === 'number' || typeof o.at === 'string' ? o.at : Date.now());
  out.at = (Number.isFinite(at.getTime()) ? at : new Date()).toISOString();
  return out;
}

export class Reporter {
  /**
   * @param {object} opts
   * @param {string} opts.kind       gateway name, e.g. 'litellm' (lower case, digits, - and _)
   * @param {boolean} [opts.enabled] true to send; default: env SEVENMAPS_SENSOR=1
   * @param {string} [opts.endpoint] default https://7it.co.il/7maps/sensor (env SEVENMAPS_SENSOR_URL)
   * @param {string} [opts.sensorId] default: sensorId()
   * @param {number} [opts.flushMs=60000] [opts.maxBatch=100] [opts.maxQueue=1000] [opts.maxRetries=5] [opts.timeoutMs=10000]
   * @param {Function} [opts.fetch]  fetch implementation (tests)
   * @param {Function} [opts.onError] called with (error) on a failed send; never required
   */
  constructor(opts = {}) {
    this.kind = KIND.test(String(opts.kind || '')) ? opts.kind : 'custom';
    this.version = opts.version || VERSION;
    this.enabled = sensorEnabled(opts.enabled);
    this.endpoint = opts.endpoint || env('SEVENMAPS_SENSOR_URL') || DEFAULT_ENDPOINT;
    this.flushMs = opts.flushMs ?? 60_000;
    this.maxBatch = Math.min(100, opts.maxBatch ?? 100);
    this.maxQueue = opts.maxQueue ?? 1000;
    this.maxRetries = opts.maxRetries ?? 5;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetch = opts.fetch || globalThis.fetch;
    this.onError = opts.onError;
    this.queue = [];
    this.stats = { recorded: 0, sent: 0, dropped: 0, failed_batches: 0, refused_batches: 0 };
    this.sending = null;
    this.pausedUntil = 0;
    this.timer = null;
    if (!this.enabled) return;
    this.id = opts.sensorId || sensorId(opts.idFile);
    this.timer = setInterval(() => { void this.flush(); }, this.flushMs);
    this.timer.unref?.();
  }

  /** Queue one outcome {server, ok, fail?, ms?, tool?, at?}. Returns false when off, invalid or dropped. Never throws. */
  record(outcome) {
    try {
      if (!this.enabled) return false;
      const w = toWire(outcome);
      if (!w) return false;
      if (this.queue.length >= this.maxQueue) { this.stats.dropped++; return false; }
      this.queue.push(w);
      this.stats.recorded++;
      if (this.queue.length >= this.maxBatch && !this.sending) setTimeout(() => { void this.flush(); }, 0).unref?.();
      return true;
    } catch { return false; }
  }

  /** Send everything waiting, in batches of up to 100. Resolves when done; never rejects. */
  flush() {
    if (!this.enabled || !this.queue.length) return this.sending || Promise.resolve();
    if (this.sending) return this.sending;
    this.sending = (async () => {
      try {
        while (this.queue.length && Date.now() >= this.pausedUntil) {
          const batch = this.queue.splice(0, this.maxBatch);
          const done = await this.sendWithRetry(batch);
          if (done === 'retry_later') { this.requeue(batch); break; }
        }
      } catch (e) { this.report(e); } finally { this.sending = null; }
    })();
    return this.sending;
  }

  requeue(batch) {
    const room = Math.max(0, this.maxQueue - this.queue.length);
    this.queue.unshift(...batch.slice(0, room));
    this.stats.dropped += batch.length - Math.min(room, batch.length);
  }

  async sendWithRetry(batch) {
    const body = JSON.stringify({ sensor_id: this.id, kind: this.kind, version: this.version, outcomes: batch });
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), this.timeoutMs); t.unref?.();
        const r = await this.fetch(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': `7maps-sensor-js/${VERSION} (${this.kind})` }, body, signal: ctl.signal }).finally(() => clearTimeout(t));
        if (r.ok) { this.stats.sent += batch.length; return 'sent'; }
        if (r.status === 429 || r.status === 503) {
          // Daily limit or intake paused: drop this batch and wait as told (at most a day).
          const ra = Number(r.headers?.get?.('retry-after')) || 60;
          this.pausedUntil = Date.now() + Math.min(86_400, ra) * 1000;
          this.stats.refused_batches++; this.stats.dropped += batch.length;
          return 'dropped';
        }
        if (r.status >= 400 && r.status < 500) { this.stats.refused_batches++; this.stats.dropped += batch.length; this.report(new Error(`7maps sensor: batch refused (${r.status})`)); return 'dropped'; }
        throw new Error(`7maps sensor: HTTP ${r.status}`);
      } catch (e) {
        this.report(e);
        if (attempt === this.maxRetries) { this.stats.failed_batches++; return 'retry_later'; }
        await sleep(Math.min(300_000, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2));
      }
    }
    return 'retry_later';
  }

  report(e) { try { this.onError?.(e); } catch { /* ignore */ } }

  /** Stop the timer and try one last flush (bounded by timeoutMs). */
  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.maxRetries = 0;
    await Promise.race([this.flush(), sleep(this.timeoutMs)]);
  }
}

const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });

let shared = null;
/** One reporter per process for a kind (adapters use this). */
export function getReporter(opts = {}) {
  if (!shared) shared = new Reporter(opts);
  return shared;
}
