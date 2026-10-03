/**
 * 7maps-guard: check an MCP server on the 7Maps map before connecting, and
 * (only when telemetry is switched on) report how each tool call went.
 *
 * Guarantee: if 7Maps cannot answer (network error, timeout, rate limit,
 * payment required and no payer configured), every check allows the call.
 * A problem on our side never blocks the user's work.
 */

export const VERSION = '0.1.0';
export const DEFAULT_ENDPOINT = 'https://7it.co.il/7maps/mcp?via=guard';
export const USER_AGENT = `7maps-guard/${VERSION} (+https://github.com/XLSV777/7maps)`;
export const UNAVAILABLE = '7maps unavailable';

const REPORT_TIMEOUT_MS = 3000;

export type FailReason =
  | 'unreachable'
  | 'auth'
  | 'args'
  | 'server_error'
  | 'timeout'
  | 'rate_limited'
  | 'wrong_result';

export interface Verdict {
  /** false only when 7Maps says the server is down, or its risk rose since approvedAt. */
  allow: boolean;
  reason: string;
  /** structuredContent of road_conditions, or null when 7Maps did not answer. */
  condition: Record<string, any> | null;
  /** structuredContent of watch (only when approvedAt is set and watch answered), else null. */
  watch?: Record<string, any> | null;
}

/** x402 payment requirements as returned by 7Maps (structuredContent of the PaymentRequired result). */
export type PaymentRequired = Record<string, any> & { x402Version: number };

export interface GuardOptions {
  /** YYYY-MM-DD: when a person approved this server. Enables the watch check. */
  approvedAt?: string;
  /** Seconds to keep a verdict in memory. Default 600. Fail-open verdicts are kept at most 60 s. */
  cacheSeconds?: number;
  /**
   * Called when 7Maps answers with an x402 PaymentRequired result. Return the payment
   * payload to send as _meta["x402/payment"], or null to skip. Without it, guard fails open.
   */
  pay?: (required: PaymentRequired, tool: string) => Promise<unknown | null>;
  /** A 7IT monthly plan license key, if you have one. */
  licenseKey?: string;
  /** Time limit for each 7Maps request. Default 5000 ms. */
  timeoutMs?: number;
  /** Override the 7Maps MCP endpoint. */
  endpoint?: string;
  /** Override the user-agent header. */
  userAgent?: string;
}

export interface Outcome {
  ok: boolean;
  tool?: string;
  fail?: FailReason;
  ms?: number;
}

export interface ReportOptions {
  endpoint?: string;
  userAgent?: string;
}

export class GuardError extends Error {
  readonly verdict: Verdict;
  constructor(verdict: Verdict) {
    super(`7maps-guard: blocked: ${verdict.reason}`);
    this.name = 'GuardError';
    this.verdict = verdict;
  }
}

// ------------------------------------------------------------------ helpers

/**
 * The address sent to 7Maps: scheme, host and path only. Query string, fragment
 * and user:password are removed, since they can carry keys.
 */
export function cleanServer(server: string): string {
  const s = String(server || '').trim();
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return `${u.protocol}//${u.host}${u.pathname}`.slice(0, 300);
    }
  } catch {
    /* not a URL: a registry name or npm:/pypi: package */
  }
  return s.split(/[?#]/)[0].slice(0, 300);
}

/** True when automatic reporting is switched on (opts value wins; else env SEVENMAPS_TELEMETRY=1). */
export function telemetryEnabled(explicit?: boolean): boolean {
  if (explicit === false) return false;
  if (envTelemetry() === '0') return false;
  return explicit === true || envTelemetry() === '1';
}

function envTelemetry(): string | undefined {
  try {
    return typeof process !== 'undefined' ? process.env?.SEVENMAPS_TELEMETRY : undefined;
  } catch {
    return undefined;
  }
}

let rpcId = 0;

class Unavailable extends Error {}

/** One JSON-RPC tools/call to 7Maps. Returns the CallToolResult, or throws Unavailable. */
async function callMaps(
  tool: string,
  args: Record<string, unknown>,
  o: { endpoint?: string; userAgent?: string; timeoutMs?: number; meta?: Record<string, unknown> },
): Promise<Record<string, any>> {
  const id = ++rpcId;
  const params: Record<string, unknown> = { name: tool, arguments: args };
  if (o.meta) params._meta = o.meta;
  let res: Response;
  try {
    res = await fetch(o.endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'user-agent': o.userAgent || USER_AGENT,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 5000),
    });
  } catch (e) {
    throw new Unavailable(String((e as Error)?.message || e));
  }
  if (!res.ok) throw new Unavailable(`HTTP ${res.status}`);
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    throw new Unavailable(String((e as Error)?.message || e));
  }
  const msg = parseRpc(text, id);
  if (!msg || msg.error || !msg.result) throw new Unavailable(msg?.error?.message || 'bad response');
  return msg.result;
}

/** Accepts a plain JSON body or a text/event-stream body and returns the message with our id. */
function parseRpc(text: string, id: number): Record<string, any> | null {
  const candidates: string[] = [];
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) candidates.push(t);
  else {
    let buf: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('data:')) buf.push(line.slice(5).replace(/^ /, ''));
      else if (line === '' && buf.length) {
        candidates.push(buf.join('\n'));
        buf = [];
      }
    }
    if (buf.length) candidates.push(buf.join('\n'));
  }
  for (const c of candidates) {
    try {
      const j = JSON.parse(c);
      for (const m of Array.isArray(j) ? j : [j]) if (m && m.id === id) return m;
    } catch {
      /* skip */
    }
  }
  return null;
}

function isPaymentRequired(r: Record<string, any>): r is { structuredContent: PaymentRequired } {
  return !!(r && r.isError && r.structuredContent && typeof r.structuredContent.x402Version === 'number');
}

function textOf(r: Record<string, any>): string {
  const c = Array.isArray(r?.content) ? r.content : [];
  const t = c.find((x: any) => x && x.type === 'text');
  return t ? String(t.text || '') : '';
}

/** Calls a paid-or-allowance 7Maps tool, paying through opts.pay when asked. Throws Unavailable. */
async function callPaid(tool: string, args: Record<string, unknown>, opts: GuardOptions) {
  const a = opts.licenseKey ? { ...args, license_key: opts.licenseKey } : args;
  let r = await callMaps(tool, a, opts);
  if (isPaymentRequired(r)) {
    if (!opts.pay) throw new Unavailable('payment required');
    let payment: unknown;
    try {
      payment = await opts.pay(r.structuredContent, tool);
    } catch (e) {
      throw new Unavailable(`payment failed: ${String((e as Error)?.message || e)}`);
    }
    if (payment == null) throw new Unavailable('payment required');
    r = await callMaps(tool, a, { ...opts, meta: { 'x402/payment': payment } });
    if (isPaymentRequired(r)) throw new Unavailable('payment not accepted');
  }
  return r;
}

// ------------------------------------------------------------------ guard

const cache = new Map<string, { until: number; verdict: Verdict }>();

/** Clears the in-memory verdict cache. */
export function clearCache(): void {
  cache.clear();
}

/**
 * Asks 7Maps about a server before connecting. Never throws.
 * Denies only when the server is down, or (with approvedAt) when watch reports risk_increased.
 */
export async function guard(serverUrl: string, opts: GuardOptions = {}): Promise<Verdict> {
  const server = cleanServer(serverUrl);
  const key = `${server}|${opts.approvedAt || ''}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.verdict;

  const ttl = Math.max(0, opts.cacheSeconds ?? 600) * 1000;
  const keep = (v: Verdict, ms = ttl) => {
    if (ms > 0) cache.set(key, { until: Date.now() + ms, verdict: v });
    return v;
  };
  const failOpen = (): Verdict => keep({ allow: true, reason: UNAVAILABLE, condition: null }, Math.min(ttl, 60_000));

  let rc: Record<string, any>;
  try {
    rc = await callPaid('road_conditions', { server }, opts);
  } catch {
    return failOpen();
  }

  if (rc.isError) {
    // Not on the map (or rejected input): nothing known, so allow.
    const t = textOf(rc);
    const reason = /not on the map/i.test(t) ? 'not on the map' : UNAVAILABLE;
    return keep({ allow: true, reason, condition: null }, reason === UNAVAILABLE ? Math.min(ttl, 60_000) : ttl);
  }

  const condition = (rc.structuredContent as Record<string, any>) || null;
  const status: string | undefined = condition?.status ?? condition?.package?.status;

  if (status === 'down') {
    return keep({ allow: false, reason: 'server is down (7Maps road_conditions)', condition, watch: null });
  }

  let reason = status ? `status ${status}` : 'on the map';
  let watch: Record<string, any> | null = null;

  if (opts.approvedAt) {
    try {
      const w = await callPaid('watch', { server, approved_at: opts.approvedAt }, opts);
      if (w.isError) {
        reason += `; change check: ${UNAVAILABLE}`;
      } else {
        watch = (w.structuredContent as Record<string, any>) || null;
        const v = watch?.verdict;
        if (v === 'risk_increased') {
          return keep({
            allow: false,
            reason: `risk increased since ${opts.approvedAt}; ask the person to approve again (7Maps watch)`,
            condition,
            watch,
          });
        }
        reason += v ? `; since ${opts.approvedAt}: ${v}` : '';
      }
    } catch {
      reason += `; change check: ${UNAVAILABLE}`;
    }
  }

  return keep({ allow: true, reason, condition, watch });
}

// ------------------------------------------------------------------ report

/**
 * Sends one report_road to 7Maps: server, tool, ok, fail, ms. Nothing else.
 * Never throws; the promise settles within 3 s (true when 7Maps accepted it).
 * Sends whenever you call it, except when SEVENMAPS_TELEMETRY=0.
 */
export function report(serverUrl: string, outcome: Outcome, opts: ReportOptions = {}): Promise<boolean> {
  if (envTelemetry() === '0') return Promise.resolve(false);
  const args: Record<string, unknown> = { server: cleanServer(serverUrl), ok: !!outcome.ok };
  if (outcome.tool) args.tool = String(outcome.tool).slice(0, 120);
  if (!outcome.ok && outcome.fail) args.fail = outcome.fail;
  if (typeof outcome.ms === 'number' && isFinite(outcome.ms)) {
    args.ms = Math.min(600000, Math.max(0, Math.round(outcome.ms)));
  }
  if (String(args.server).length < 3) return Promise.resolve(false);
  const sent = callMaps('report_road', args, { ...opts, timeoutMs: REPORT_TIMEOUT_MS })
    .then((r) => !r.isError && r.structuredContent?.accepted !== false)
    .catch(() => false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), REPORT_TIMEOUT_MS + 50);
    (timer as any)?.unref?.();
  });
  return Promise.race([sent, cap]).finally(() => timer && clearTimeout(timer));
}

/** Maps an error thrown by an MCP client call to a report_road fail value. */
export function failReason(err: unknown): FailReason {
  const e = err as any;
  const code = typeof e?.code === 'number' ? e.code : undefined;
  const name = String(e?.name || '');
  const msg = String(e?.message || e || '');
  if (code === -32001 || name === 'TimeoutError' || name === 'AbortError' || /timed? ?out/i.test(msg)) return 'timeout';
  if (code === 401 || code === 403 || name === 'UnauthorizedError' || /\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(msg)) return 'auth';
  if (code === 429 || /\b429\b|too many requests|rate.?limit/i.test(msg)) return 'rate_limited';
  if (code === -32602 || /invalid (params|arguments)/i.test(msg)) return 'args';
  const cause = String(e?.cause?.code || e?.cause?.message || '');
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH/.test(cause + msg) || /fetch failed/i.test(msg)) return 'unreachable';
  return 'server_error';
}

// ------------------------------------------------------------------ wrapClient

export interface WrapOptions extends GuardOptions {
  /** The server's URL. Taken from a StreamableHTTP/SSE transport when omitted. */
  serverUrl?: string;
  /** Report each callTool outcome to 7Maps. Off unless true or SEVENMAPS_TELEMETRY=1. */
  telemetry?: boolean;
  /** Called when guard denies. Default: throw GuardError. Return normally to connect anyway. */
  onDeny?: (verdict: Verdict) => void | Promise<void>;
  /** Called with every verdict (allow or deny). */
  onVerdict?: (verdict: Verdict) => void;
}

/** The parts of @modelcontextprotocol/sdk Client this wraps. */
export interface ClientLike {
  connect(transport: any, ...rest: any[]): Promise<void>;
  callTool(params: { name: string; arguments?: Record<string, unknown> } & Record<string, any>, ...rest: any[]): Promise<any>;
}

function transportUrl(transport: any): string | undefined {
  const u = transport?._url ?? transport?.url;
  if (u instanceof URL) return u.href;
  return typeof u === 'string' ? u : undefined;
}

/**
 * Wraps an @modelcontextprotocol/sdk Client in place and returns it:
 * connect() runs guard first; callTool() is timed and, with telemetry on, reported.
 */
export function wrapClient<C extends ClientLike>(client: C, options: WrapOptions = {}): C {
  const { telemetry, onDeny, onVerdict, serverUrl: givenUrl, ...guardOpts } = options;
  let serverUrl = givenUrl;
  const origConnect = client.connect.bind(client);
  const origCallTool = client.callTool.bind(client);

  (client as any).connect = async (transport: any, ...rest: any[]) => {
    serverUrl = serverUrl || transportUrl(transport);
    if (serverUrl) {
      const v = await guard(serverUrl, guardOpts);
      onVerdict?.(v);
      if (!v.allow) {
        if (onDeny) await onDeny(v);
        else throw new GuardError(v);
      }
    }
    return origConnect(transport, ...rest);
  };

  (client as any).callTool = async (params: any, ...rest: any[]) => {
    const started = Date.now();
    const send = serverUrl && telemetryEnabled(telemetry);
    try {
      const result = await origCallTool(params, ...rest);
      if (send) {
        const isErr = !!(result && (result as any).isError);
        void report(serverUrl!, { ok: !isErr, tool: params?.name, ms: Date.now() - started }, guardOpts);
      }
      return result;
    } catch (err) {
      if (send) {
        void report(serverUrl!, { ok: false, tool: params?.name, fail: failReason(err), ms: Date.now() - started }, guardOpts);
      }
      throw err;
    }
  };

  return client;
}
