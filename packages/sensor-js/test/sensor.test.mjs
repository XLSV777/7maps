// node --test test/sensor.test.mjs   (a local mock server only; nothing is sent to 7Maps)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Reporter, cleanServer, failReason, sensorEnabled, toWire } from '../src/index.js';
import { wrapClient } from '../src/mcp-sdk.js';

const ALLOWED = new Set(['sensor_id', 'kind', 'version', 'outcomes']);
const ALLOWED_O = new Set(['server', 'ok', 'fail', 'ms', 'tool', 'at']);

// A stand-in for POST /7maps/sensor: records bodies; answers with `plan` statuses in order.
async function mock(plan = []) {
  const got = [];
  let i = 0;
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const status = plan[i++] ?? 200;
      try { got.push(JSON.parse(b)); } catch { got.push(b); }
      res.writeHead(status, status === 429 ? { 'retry-after': '3600' } : {});
      res.end('{}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { got, url: `http://127.0.0.1:${srv.address().port}/7maps/sensor`, close: () => new Promise((r) => srv.close(r)) };
}
const opts = (url, extra = {}) => ({ kind: 'test-kind', enabled: true, endpoint: url, sensorId: 't-unit-test-0000001', flushMs: 3_600_000, ...extra });

test('off unless switched on', () => {
  const old = process.env.SEVENMAPS_SENSOR;
  delete process.env.SEVENMAPS_SENSOR;
  assert.equal(sensorEnabled(), false);
  assert.equal(new Reporter({ kind: 'x', idFile: join(tmpdir(), 'never') }).record({ server: 'https://a.example/mcp', ok: true }), false);
  process.env.SEVENMAPS_SENSOR = '1'; assert.equal(sensorEnabled(), true);
  process.env.SEVENMAPS_SENSOR = '0'; assert.equal(sensorEnabled(true), false);
  if (old === undefined) delete process.env.SEVENMAPS_SENSOR; else process.env.SEVENMAPS_SENSOR = old;
});

test('wire format keeps only the six fields and strips secrets from the address', () => {
  assert.equal(cleanServer('https://user:pw@mcp.example.com/mcp?api_key=SECRET#x'), 'https://mcp.example.com/mcp');
  const w = toWire({ server: 'https://mcp.example.com/mcp?token=abc', ok: false, fail: 'timeout', ms: 1234.6, tool: 'search', arguments: { q: 1 }, result: 'r', user: 'u' });
  assert.deepEqual(Object.keys(w).sort(), ['at', 'fail', 'ms', 'ok', 'server', 'tool']);
  assert.equal(w.ms, 1235);
  assert.equal(toWire({ server: 'x', ok: true }), null);
  assert.equal(toWire({ server: 'io.github.acme/thing', ok: true, tool: 'bad tool name' }).tool, undefined);
  assert.equal(toWire({ server: 'io.github.acme/thing', ok: true, fail: 'timeout' }).fail, undefined);
});

test('batches of 100 are sent as soon as 100 wait; body has only allowed fields', async () => {
  const m = await mock();
  const r = new Reporter(opts(m.url));
  for (let k = 0; k < 150; k++) r.record({ server: 'https://mcp.example.com/mcp', ok: k % 3 !== 0, fail: k % 3 ? undefined : 'server_error', ms: k, tool: 'search' });
  await new Promise((res) => setTimeout(res, 50));
  await r.flush();
  await r.close();
  await m.close();
  assert.equal(m.got.length, 2);
  assert.equal(m.got[0].outcomes.length, 100);
  assert.equal(m.got[1].outcomes.length, 50);
  for (const b of m.got) {
    assert.ok(Object.keys(b).every((k) => ALLOWED.has(k)));
    assert.ok(b.outcomes.every((o) => Object.keys(o).every((k) => ALLOWED_O.has(k))));
    assert.equal(b.kind, 'test-kind');
    assert.equal(b.sensor_id, 't-unit-test-0000001');
  }
  assert.equal(r.stats.sent, 150);
});

test('record never blocks or throws, and drops when the queue is full', () => {
  const r = new Reporter(opts('http://127.0.0.1:9/never', { maxQueue: 10, maxBatch: 100 }));
  const t0 = process.hrtime.bigint();
  let accepted = 0;
  for (let k = 0; k < 1000; k++) if (r.record({ server: 'https://mcp.example.com/mcp', ok: true })) accepted++;
  assert.equal(r.record(null), false);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(accepted, 10);
  assert.equal(r.stats.dropped, 990);
  assert.ok(ms < 200, `record took ${ms} ms for 1000 calls`);
  clearInterval(r.timer);
});

test('retries with backoff after a server error, then sends', async () => {
  const m = await mock([500, 502, 200]);
  const r = new Reporter(opts(m.url, { maxRetries: 3 }));
  r.record({ server: 'https://mcp.example.com/mcp', ok: true });
  const t0 = Date.now();
  await r.flush();
  await m.close(); clearInterval(r.timer);
  assert.equal(m.got.length, 3);
  assert.equal(r.stats.sent, 1);
  assert.ok(Date.now() - t0 >= 1000, 'backed off between attempts');
});

test('429 pauses sending and drops the batch; 400 drops without retry', async () => {
  const m = await mock([429, 400]);
  const r = new Reporter(opts(m.url));
  r.record({ server: 'https://mcp.example.com/mcp', ok: true });
  await r.flush();
  assert.ok(r.pausedUntil > Date.now() + 3_000_000);
  r.pausedUntil = 0;
  r.record({ server: 'https://mcp.example.com/mcp', ok: true });
  await r.flush();
  await m.close(); clearInterval(r.timer);
  assert.equal(m.got.length, 2);
  assert.equal(r.stats.refused_batches, 2);
  assert.equal(r.stats.sent, 0);
});

test('MCP SDK adapter records ok, isError and thrown errors, and returns the result unchanged', async () => {
  const m = await mock();
  const reporter = new Reporter(opts(m.url));
  const fake = {
    async connect() {},
    async callTool(p) { if (p.name === 'boom') { const e = new Error('Request timed out'); e.code = -32001; throw e; } return { content: [{ type: 'text', text: 'private' }], isError: p.name === 'bad' }; },
  };
  const c = wrapClient(fake, { reporter });
  await c.connect({ _url: new URL('https://mcp.example.com/mcp?key=secret') });
  const res = await c.callTool({ name: 'search', arguments: { q: 'private' } });
  assert.equal(res.content[0].text, 'private');
  await c.callTool({ name: 'bad', arguments: {} });
  await assert.rejects(c.callTool({ name: 'boom' }), /timed out/);
  await reporter.flush(); await reporter.close(); await m.close();
  const os = m.got.flatMap((b) => b.outcomes);
  assert.deepEqual(os.map((o) => [o.ok, o.fail ?? null, o.tool]), [[true, null, 'search'], [false, null, 'bad'], [false, 'timeout', 'boom']]);
  assert.ok(os.every((o) => o.server === 'https://mcp.example.com/mcp'));
  assert.ok(!JSON.stringify(m.got).includes('private') && !JSON.stringify(m.got).includes('secret'));
});

test('failReason maps common errors', () => {
  assert.equal(failReason(Object.assign(new Error('x'), { code: 401 })), 'auth');
  assert.equal(failReason(new Error('429 Too Many Requests')), 'rate_limited');
  assert.equal(failReason(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })), 'unreachable');
  assert.equal(failReason(Object.assign(new Error('Invalid params'), { code: -32602 })), 'args');
  assert.equal(failReason(new Error('kaput')), 'server_error');
});
