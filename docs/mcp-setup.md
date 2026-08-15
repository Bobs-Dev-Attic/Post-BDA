# Post-BDA MCP Server — Setup & Configuration

Post-BDA ships a **Phase 1 "runner" MCP server** that lets a connected LLM
(Claude Desktop, Claude Code, or any MCP client) construct and send HTTP
requests on your behalf. It exposes a single tool, `send_request`.

> **Status: tabled.** The endpoint is deployed and ready, but it stays
> inert until you set an `MCP_TOKEN` (see below). Phase 2 (read-only access
> to saved collections/variables) is not built yet.

---

## What it is

- **Endpoint:** `https://post-bda.vercel.app/api/mcp`
- **Transport:** MCP Streamable HTTP, POST-only. Each POST returns a single
  JSON response (no SSE stream, no extra dependencies).
- **Auth:** a static bearer token you generate (`MCP_TOKEN`).
- **Tool exposed:** `send_request(url, method?, headers?, body?, timeoutMs?)`
  — only `url` is required.
- **Not exposed:** your saved requests, collections, variables, history, or
  any workspace data. Phase 1 is a runner only.

### `send_request` behavior

| Aspect        | Detail                                                        |
|---------------|---------------------------------------------------------------|
| Methods       | GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS                   |
| SSRF guard    | Blocks `localhost`, `*.local`, `*.internal`, cloud metadata, and any host that resolves to a private / reserved / loopback / link-local / CGNAT IP (IPv4 and IPv6, including IPv4-mapped). |
| Timeout       | Default 15000 ms, max 30000 ms (via `AbortController`).        |
| Body cap      | Response body truncated to 100,000 chars (`truncated: true` flag set). |
| Stripped hdrs | `host`, `connection`, `content-length` are never forwarded.   |
| Audit         | Each call is logged best-effort to a Neon `agent_calls` table (token hash prefix, method, url, status, ok, note, timestamp). Uses the same `DATABASE_URL` as sync; if unset, auditing is silently skipped. |

---

## Step 1 — Generate a token

```bash
openssl rand -hex 32
```

Copy the output. This is your `MCP_TOKEN`; treat it like a password.

## Step 2 — Add the env var in Vercel

1. Vercel → your **post-bda** project → **Settings → Environment Variables**.
2. Add `MCP_TOKEN` = *(the value from Step 1)*, scope **Production**.
3. **Redeploy** (Deployments → latest → Redeploy, or push a commit). Env-var
   changes only take effect on a new deployment.

Without `MCP_TOKEN` the endpoint responds `503` to every request. With it,
requests carrying the wrong token get `401`.

## Step 3 — Verify

```bash
curl -s https://post-bda.vercel.app/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

You should get a JSON result listing the `send_request` tool. A `503` means
`MCP_TOKEN` isn't set on the deployment yet; a `401` means the token in the
header doesn't match.

Optional end-to-end check:

```bash
curl -s https://post-bda.vercel.app/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"send_request",
                 "arguments":{"url":"https://api.github.com/zen"}}}'
```

---

## Step 4 — Connect a client

### Claude Code (CLI)

```bash
claude mcp add --transport http post-bda \
  https://post-bda.vercel.app/api/mcp \
  --header "Authorization: Bearer <your MCP_TOKEN>"
```

### Claude Desktop (`claude_desktop_config.json`)

Claude Desktop speaks stdio, so bridge to the HTTP endpoint with
`mcp-remote`:

```json
{
  "mcpServers": {
    "post-bda": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://post-bda.vercel.app/api/mcp",
        "--header", "Authorization: Bearer <your MCP_TOKEN>"
      ]
    }
  }
}
```

Restart the client. `send_request` should appear in its tool list.

---

## Security notes

- The token is the only gate. Anyone holding it can make the server send
  outbound HTTP requests. Rotate it by generating a new value, updating the
  Vercel env var, redeploying, and updating every client header.
- The SSRF blocklist stops the tool from reaching your private network or
  cloud metadata endpoints, but it is **not** a substitute for the token —
  keep the token secret.
- Auditing is best-effort. If `DATABASE_URL` is unset or the write fails, the
  request still proceeds; only the log entry is skipped.

## Source

Implementation: [`app/api/mcp/route.ts`](../app/api/mcp/route.ts).
