// Adapter for the official MCP TypeScript SDK (@modelcontextprotocol/sdk) Client.
// The SDK has no middleware API for tool calls, so this wraps Client.callTool in place:
// it times the call, records {server, ok, fail, ms, tool, at} on the reporter, and returns
// the SDK's own result or rethrows its own error, unchanged. Recording never awaits.
import { Reporter, failReason } from './index.js';

function transportUrl(transport) {
  const u = transport?._url ?? transport?.url;
  if (u instanceof URL) return u.href;
  return typeof u === 'string' ? u : undefined;
}

/**
 * Wraps an @modelcontextprotocol/sdk Client and returns it.
 * @param {object} client  a Client (anything with connect() and callTool())
 * @param {object} [opts]  { serverUrl, reporter, enabled, kind }  serverUrl is read from a
 *   StreamableHTTPClientTransport or SSEClientTransport when left out. For a stdio server pass a
 *   registry name (io.github.owner/repo) as serverUrl, or nothing is recorded.
 */
export function wrapClient(client, opts = {}) {
  const reporter = opts.reporter || new Reporter({ kind: opts.kind || 'mcp-sdk-js', enabled: opts.enabled });
  let server = opts.serverUrl;
  const connect = client.connect.bind(client);
  const callTool = client.callTool.bind(client);
  client.connect = (transport, ...rest) => { server = server || transportUrl(transport); return connect(transport, ...rest); };
  client.callTool = async (params, ...rest) => {
    const started = Date.now();
    try {
      const result = await callTool(params, ...rest);
      if (server) reporter.record({ server, ok: !result?.isError, tool: params?.name, ms: Date.now() - started });
      return result;
    } catch (err) {
      if (server) reporter.record({ server, ok: false, fail: failReason(err), tool: params?.name, ms: Date.now() - started });
      throw err;
    }
  };
  return client;
}
