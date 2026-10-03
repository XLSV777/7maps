#!/usr/bin/env node
import { guard, VERSION } from './index.js';

const USAGE = `7maps-guard ${VERSION}

Usage:
  7maps-guard check <serverUrl> [--approved YYYY-MM-DD] [--json]

Asks 7Maps (https://7it.co.il/7maps/) about an MCP server before you connect.
Exit code: 0 allow, 2 deny, 1 usage error.
If 7Maps cannot be reached, the verdict is allow ("7maps unavailable").`;

async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  if (args.includes('--version') || args.includes('-v')) {
    console.log(VERSION);
    return 0;
  }
  if (args[0] !== 'check' || args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return args[0] === 'check' || args.includes('--help') || args.includes('-h') ? 0 : 1;
  }
  args.shift();
  let approvedAt: string | undefined;
  let json = false;
  let server: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--approved') approvedAt = args[++i];
    else if (a.startsWith('--approved=')) approvedAt = a.slice('--approved='.length);
    else if (a === '--json') json = true;
    else if (!a.startsWith('--') && !server) server = a;
    else {
      console.error(`Unknown argument: ${a}\n\n${USAGE}`);
      return 1;
    }
  }
  if (!server) {
    console.error(USAGE);
    return 1;
  }
  if (approvedAt !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(approvedAt)) {
    console.error('--approved must be YYYY-MM-DD');
    return 1;
  }
  const v = await guard(server, { approvedAt, cacheSeconds: 0 });
  if (json) {
    console.log(JSON.stringify(v, null, 2));
  } else {
    console.log(`${v.allow ? 'ALLOW' : 'DENY'}  ${server}`);
    console.log(`reason: ${v.reason}`);
    const c = v.condition;
    if (c) {
      if (c.success_chance != null) console.log(`success chance: ${Math.round(c.success_chance * 100)}%`);
      if (c.latency_ms != null) console.log(`latency: ${c.latency_ms} ms`);
      if (c.risk) console.log(`tools: ${c.risk.read_only} read-only, ${c.risk.needs_approval} need approval, ${c.risk.high_risk} high risk`);
      if (c.page_url) console.log(`page: ${c.page_url}`);
    }
  }
  return v.allow ? 0 : 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    // guard never throws; this only catches a bug here. Fail open.
    console.error(`7maps-guard: ${String((e as Error)?.message || e)}`);
    process.exit(0);
  },
);
