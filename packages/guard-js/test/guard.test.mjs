// Live tests against https://7it.co.il/7maps/mcp. The user-agent marks them as test traffic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guard, report, wrapClient, failReason, cleanServer, GuardError, VERSION, clearCache } from '../dist/index.js';

const UA = 'mcp-smoke/guard-test';

test('VERSION matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});

test('guard on https://mcp.stripe.com returns a verdict object', async () => {
  const v = await guard('https://mcp.stripe.com', { userAgent: UA, cacheSeconds: 0 });
  assert.equal(typeof v.allow, 'boolean');
  assert.equal(typeof v.reason, 'string');
  assert.ok(v.condition === null || typeof v.condition === 'object');
  console.log('stripe verdict:', JSON.stringify({ allow: v.allow, reason: v.reason, status: v.condition?.status ?? null }));
});

test('guard on an unreachable fake host fails open', async () => {
  const v = await guard('https://nonexistent-7maps-test.invalid/mcp', { userAgent: UA, cacheSeconds: 0 });
  assert.equal(v.allow, true);
  console.log('fake host verdict:', JSON.stringify(v));
});

test('guard fails open when 7Maps itself is unreachable', async () => {
  const v = await guard('https://mcp.stripe.com', { endpoint: 'https://nonexistent-7maps-test.invalid/mcp', userAgent: UA, cacheSeconds: 0, timeoutMs: 3000 });
  assert.deepEqual(v, { allow: true, reason: '7maps unavailable', condition: null });
});

test('report() settles within 3 s', async () => {
  const t0 = Date.now();
  const ok = await report('https://mcp.stripe.com', { ok: true, tool: 'guard_test', ms: 1 }, { userAgent: UA });
  const took = Date.now() - t0;
  assert.ok(took <= 3200, `took ${took} ms`);
  console.log(`report accepted=${ok} in ${took} ms`);
});

test('report() to a dead endpoint settles within 3 s and never throws', async () => {
  const t0 = Date.now();
  const ok = await report('https://mcp.stripe.com', { ok: false, fail: 'timeout' }, { endpoint: 'https://10.255.255.1/mcp', userAgent: UA });
  assert.equal(ok, false);
  assert.ok(Date.now() - t0 <= 3200);
});

test('cleanServer drops query, fragment and credentials', () => {
  assert.equal(cleanServer('https://u:p@mcp.example.com/mcp?key=secret#x'), 'https://mcp.example.com/mcp');
  assert.equal(cleanServer('npm:@scope/pkg'), 'npm:@scope/pkg');
});

test('failReason maps errors', () => {
  assert.equal(failReason({ code: -32001, message: 'Request timed out' }), 'timeout');
  assert.equal(failReason({ code: 401, message: 'x' }), 'auth');
  assert.equal(failReason({ code: 403, message: 'x' }), 'auth');
  assert.equal(failReason({ code: 429, message: 'x' }), 'rate_limited');
  assert.equal(failReason({ code: -32602, message: 'MCP error -32602: Invalid params' }), 'args');
  assert.equal(failReason(new Error('boom')), 'server_error');
});

test('wrapClient: deny blocks connect, allow passes, callTool is timed', async () => {
  clearCache();
  let connected = false;
  const fake = {
    async connect() { connected = true; },
    async callTool(p) { return { content: [], echo: p.name }; },
  };
  // 7Maps unreachable -> fail open -> connect proceeds.
  const c = wrapClient(fake, { serverUrl: 'https://mcp.stripe.com', endpoint: 'https://nonexistent-7maps-test.invalid/mcp', userAgent: UA, timeoutMs: 2000, cacheSeconds: 0 });
  await c.connect({});
  assert.equal(connected, true);
  const r = await c.callTool({ name: 'x', arguments: {} });
  assert.equal(r.echo, 'x');

  // A custom onDeny is called for a denied verdict (forced by a fake 7Maps answer).
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_u, init) => {
    const id = JSON.parse(init.body).id;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [], structuredContent: { status: 'down' } } }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const d = wrapClient({ async connect() {}, async callTool() { return {}; } }, { serverUrl: 'https://down.example.com/mcp', cacheSeconds: 0 });
    await assert.rejects(d.connect({}), GuardError);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('wrapClient works with the real @modelcontextprotocol/sdk Client', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = wrapClient(new Client({ name: 'guard-test', version: VERSION }), { userAgent: UA, cacheSeconds: 0 });
  // serverUrl comes from the transport. 7Maps itself is the server under test.
  const transport = new StreamableHTTPClientTransport(new URL('https://7it.co.il/7maps/mcp?via=guard-test'), { requestInit: { headers: { 'user-agent': UA } } });
  await client.connect(transport);
  const r = await client.callTool({ name: 'about_7maps', arguments: {} });
  assert.ok(Array.isArray(r.content));
  await client.close();
});
