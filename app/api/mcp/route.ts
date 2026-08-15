import { createHash } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { neon } from '@neondatabase/serverless';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Phase 1 "runner" MCP server for Post-BDA.
// Exposes a single tool, send_request, that lets a connected LLM construct and
// send an HTTP request. Stateless JSON-RPC over the MCP Streamable HTTP
// transport (POST returns a single JSON response — no SSE, no extra deps).
// Guarded by a static Bearer token (MCP_TOKEN) and an SSRF blocklist; every
// call is recorded in a Neon audit table.

const SERVER_INFO = { name: 'post-bda', version: '1.0.0' };
const DEFAULT_PROTOCOL = '2025-06-18';
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MAX_BODY_CHARS = 100_000;
const blockedHeaders = new Set(['host', 'connection', 'content-length']);

const TOOLS = [
  {
    name: 'send_request',
    description:
      'Send an HTTP request to an external, publicly-reachable URL and return the status, headers, and body. ' +
      'Use this to call APIs on the user\'s behalf. Private/internal addresses are blocked.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ALLOWED_METHODS, description: 'HTTP method (default GET).' },
        url: { type: 'string', description: 'Absolute http(s) URL to call.' },
        headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Optional request headers.' },
        body: { type: 'string', description: 'Optional request body (ignored for GET/HEAD).' },
        timeoutMs: { type: 'number', description: 'Optional timeout in ms (default 15000, max 30000).' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
];

type JsonRpc = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: Record<string, unknown> };

function rpcResult(id: JsonRpc['id'], result: unknown) {
  return { jsonrpc: '2.0' as const, id: id ?? null, result };
}
function rpcError(id: JsonRpc['id'], code: number, message: string) {
  return { jsonrpc: '2.0' as const, id: id ?? null, error: { code, message } };
}
function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local + cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] >= 224) return true; // multicast / reserved
    return false;
  }
  const low = ip.toLowerCase();
  if (low === '::1' || low === '::' || low === '::0') return true;
  if (low.startsWith('fe80')) return true; // link-local
  if (low.startsWith('fc') || low.startsWith('fd')) return true; // unique local
  if (low.startsWith('::ffff:')) return isPrivateIp(low.slice('::ffff:'.length));
  return false;
}

async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http:// and https:// URLs are allowed.');
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Blocked host.');
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Blocked private/reserved IP address.');
    return url;
  }
  const resolved = await dns.lookup(host, { all: true }).catch(() => [] as { address: string }[]);
  if (!resolved.length) throw new Error('Could not resolve host.');
  for (const entry of resolved) {
    if (isPrivateIp(entry.address)) throw new Error('Host resolves to a private/reserved IP address.');
  }
  return url;
}

async function audit(tokenHash: string, method: string, url: string, status: number, ok: boolean, note?: string) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  try {
    const sql = neon(dbUrl);
    await sql.query(`
      CREATE TABLE IF NOT EXISTS agent_calls (
        id bigserial PRIMARY KEY,
        token_hash text NOT NULL,
        method text NOT NULL,
        url text NOT NULL,
        status int NOT NULL,
        ok boolean NOT NULL,
        note text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await sql`INSERT INTO agent_calls (token_hash, method, url, status, ok, note)
              VALUES (${tokenHash}, ${method}, ${url}, ${status}, ${ok}, ${note ?? null})`;
  } catch {
    /* audit is best-effort */
  }
}

async function sendRequest(args: Record<string, unknown>, tokenHash: string) {
  const method = String(args.method ?? 'GET').toUpperCase();
  if (!ALLOWED_METHODS.includes(method)) throw new Error(`Unsupported method: ${method}`);
  const url = await assertPublicUrl(String(args.url ?? ''));

  const headers = new Headers();
  const rawHeaders = (args.headers ?? {}) as Record<string, string>;
  if (rawHeaders && typeof rawHeaders === 'object') {
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (key && !blockedHeaders.has(key.toLowerCase())) headers.set(key, String(value));
    }
  }

  const timeoutMs = Math.min(30_000, Math.max(1, Number(args.timeoutMs) || 15_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const init: RequestInit = { method, headers, redirect: 'follow', signal: controller.signal };
    if (!['GET', 'HEAD'].includes(method) && typeof args.body === 'string' && args.body.length) init.body = args.body;
    const res = await fetch(url.toString(), init);
    const full = await res.text();
    const durationMs = Date.now() - started;
    await audit(tokenHash, method, url.toString(), res.status, res.status < 400);
    return {
      status: res.status,
      statusText: res.statusText,
      durationMs,
      headers: Object.fromEntries(res.headers.entries()),
      truncated: full.length > MAX_BODY_CHARS,
      body: full.slice(0, MAX_BODY_CHARS),
    };
  } catch (error) {
    const message = error instanceof Error ? (error.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : error.message) : 'Request failed';
    await audit(tokenHash, method, url.toString(), 0, false, message);
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

async function handleMessage(msg: JsonRpc, tokenHash: string) {
  const { id, method, params } = msg;
  if (!method) return rpcError(id, -32600, 'Invalid Request');

  if (method === 'initialize') {
    const requested = typeof params?.protocolVersion === 'string' ? (params.protocolVersion as string) : DEFAULT_PROTOCOL;
    return rpcResult(id, { protocolVersion: requested, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
  }
  if (method.startsWith('notifications/')) return null; // notifications get no response
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list') return rpcResult(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const name = params?.name;
    const args = (params?.arguments ?? {}) as Record<string, unknown>;
    if (name !== 'send_request') return rpcError(id, -32602, `Unknown tool: ${String(name)}`);
    try {
      const result = await sendRequest(args, tokenHash);
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool failed';
      return rpcResult(id, { content: [{ type: 'text', text: `Error: ${message}` }], isError: true });
    }
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

export async function POST(request: NextRequest) {
  const token = process.env.MCP_TOKEN;
  if (!token) return jsonResponse(rpcError(null, -32001, 'MCP is not configured (missing MCP_TOKEN).'), 503);

  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${token}`) {
    return new Response(JSON.stringify(rpcError(null, -32001, 'Unauthorized.')), {
      status: 401,
      headers: { 'content-type': 'application/json', 'WWW-Authenticate': 'Bearer' },
    });
  }

  const tokenHash = createHash('sha256').update(token).digest('hex').slice(0, 16);

  let payload: JsonRpc | JsonRpc[];
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, 'Parse error'));
  }

  if (Array.isArray(payload)) {
    const responses = (await Promise.all(payload.map((m) => handleMessage(m, tokenHash)))).filter(Boolean);
    if (!responses.length) return new Response(null, { status: 202 });
    return jsonResponse(responses);
  }

  const response = await handleMessage(payload, tokenHash);
  if (response === null) return new Response(null, { status: 202 });
  return jsonResponse(response);
}

export function GET() {
  // Phase 1 uses POST-only Streamable HTTP (JSON responses). No server-initiated SSE stream.
  return new Response('Method Not Allowed. Use POST (MCP Streamable HTTP).', { status: 405 });
}
