# Connecting AI assistants to Banana (MCP)

Banana ships a [Model Context Protocol](https://modelcontextprotocol.io) server, so an AI assistant can diff KiCad files, run ERC/DRC, generate and route boards, and run simulations through Banana's tools.

There are two ways to connect:

| Transport | Use it for | Code |
|-----------|------------|------|
| **stdio** | Local clients that start Banana themselves: Claude Desktop, Claude Code, Cursor, Gemini CLI | `backend/src/mcp/stdio.js` |
| **Streamable HTTP** at `/mcp` | Clients that connect over the network, through an HTTPS tunnel | `backend/src/mcp/http.js` (mounted by `backend/src/app.js`) |

Both expose the same tools (see [Tools](#tools)). Input and output schemas are in [mcp-reference.md](mcp-reference.md).

---

## Local clients (stdio)

stdio needs no token: the client starts the server as a child process and talks to it over stdin/stdout. Test that it starts:

```bash
node backend/src/mcp/stdio.js
```

It logs `Banana MCP server running on stdio` to stderr and waits for JSON-RPC on stdin (Ctrl+C to stop). stdout is reserved for protocol messages; all logging goes to stderr.

### Claude Code

Use an absolute path:

```bash
claude mcp add banana -- node /absolute/path/to/Banana2.0/backend/src/mcp/stdio.js
```

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings > Developer > Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "banana": {
      "command": "node",
      "args": ["/absolute/path/to/Banana2.0/backend/src/mcp/stdio.js"]
    }
  }
}
```

On Windows, write the path with forward slashes or escaped backslashes (`C:/Users/you/Banana2.0/...`).

Other stdio clients (Cursor, Gemini CLI, ...) take the same `command` + `args` pair in their own MCP settings.

---

## Network clients (Streamable HTTP)

The backend serves MCP at `http://<host>:5000/mcp` (port from `PORT`, default `5000`). The endpoint is **off by default**: it answers `404` until a token is configured.

### 1. Enable it with a token

Set `BANANA_MCP_TOKEN` to a random string of **at least 32 characters**. Generate one with Node:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

That prints 64 hex characters. Put it in `backend/.env` (loaded by `dotenv` when the backend starts from `backend/`) or in the process environment:

```
BANANA_MCP_TOKEN=<paste the generated value>
```

Never commit the token. `.env` files stay out of git; do not paste the token into issues, chats, or screenshots. To revoke it, change the value and restart the backend.

Start the backend as usual (`cd backend && npm run dev`). A token shorter than 32 characters leaves the endpoint disabled.

### 2. Allowed hosts and origins

Every request is checked before it reaches the MCP server:

| Variable | Format | Default | Effect |
|----------|--------|---------|--------|
| `BANANA_MCP_ALLOWED_HOSTS` | comma list of hostnames, e.g. `abc.trycloudflare.com,my.example.com` | `127.0.0.1`, `localhost` (always allowed) | The request's `Host` header hostname (port ignored) must be in the list, otherwise `403`. Blocks DNS-rebinding. |
| `BANANA_MCP_ALLOWED_ORIGINS` | comma list of full origins, e.g. `https://app.example.com` | empty | If a request carries an `Origin` header, it must match one entry exactly, otherwise `403`. Requests with no `Origin` (most server-side clients) pass. |

### 3. Reach it from a cloud client through an HTTPS tunnel

Cloud-hosted assistants cannot reach `localhost`. Expose the backend through an HTTPS tunnel, for example:

```bash
cloudflared tunnel --url http://localhost:5000
# or
ngrok http 5000
```

The tunnel prints a public hostname (e.g. `random-words.trycloudflare.com`). Add that **hostname** (no scheme, no path) to the allowed hosts and restart the backend:

```
BANANA_MCP_ALLOWED_HOSTS=random-words.trycloudflare.com
```

Quick tunnels get a new hostname on every run, so update the variable each time (or use a named tunnel with a fixed hostname). The connector URL is then `https://<tunnel-host>/mcp`, and the client must send:

```
Authorization: Bearer <BANANA_MCP_TOKEN>
```

Client notes:

- **Claude Code over HTTP:**
  `claude mcp add --transport http banana https://<tunnel-host>/mcp --header "Authorization: Bearer <token>"`
- **Claude.ai custom connector:** add a custom connector with the URL `https://<tunnel-host>/mcp`. Banana authenticates only with a static bearer token and does not implement OAuth, so this works only if the connector form lets you send an `Authorization` header. If it does not, use Claude Desktop or Claude Code over stdio instead.
- **Gemini (Gemini CLI) and other Streamable HTTP clients:** configure the server URL `https://<tunnel-host>/mcp` and a custom header `Authorization: Bearer <token>` in the client's MCP settings. Any client that speaks MCP Streamable HTTP and can set that header works.

A tunnel makes your backend reachable from the internet. Keep it running only while you need it.

---

## Tools

Registered in `backend/src/engine/tools/*.js`. All are read-only except `design.commit`.

| Tool | What it does |
|------|--------------|
| `diff.compare_files` | Compares two KiCad files (`.kicad_pcb` or `.kicad_sch`) and returns the visual/structural diff. |
| `kicad.erc` | Runs KiCad's electrical rules check on a schematic. |
| `kicad.drc` | Runs KiCad's design rules check on a PCB layout. |
| `kicad.export_netlist` | Exports a netlist from a KiCad schematic. |
| `ir.validate` | Validates a Circuit IR document against the schema and semantic rules. |
| `erc.run` | Runs the electrical rules check on a Circuit IR. |
| `ir.auto_place` | Places unplaced components on a PCB grid. |
| `ir.to_kicad_sch` | Generates KiCad schematic S-expression text from a Circuit IR. |
| `ir.to_kicad_pcb` | Generates KiCad PCB S-expression text from a Circuit IR. |
| `sim.run` | Runs a thermal, trace-current, or IR-drop simulation. |
| `ir.route` | Routes PCB tracks with Freerouting. |
| `design.commit` | Saves a design to a local git repo as KiCad files and commits it. **Destructive: refused over MCP** (see below). |

The `kicad.*` tools need `kicad-cli` (KiCad installed); `ir.route` needs Freerouting (`FREEROUTING_JAR` set to the Freerouting jar).

---

## Security notes

- **Bearer on every request.** The HTTP endpoint checks `Authorization: Bearer <token>` on every request, not just the first one, with a constant-time comparison. A missing or wrong token gets `401`.
- **Host and Origin checks** run before the token check (see [step 2](#2-allowed-hosts-and-origins)).
- **Destructive tools are refused.** MCP calls never carry approval, so `design.commit` returns `approval required` (`isError: true`) over HTTP, and over stdio as well. Tools are advertised with `readOnlyHint` / `destructiveHint` annotations.
- **Sessions:** a session starts with an `initialize` request and is tracked by the `Mcp-Session-Id` header. Sessions idle for **30 minutes** are dropped, and at most **50** are kept; opening a 51st closes the oldest. An unknown session id gets `404`; the client should re-initialize.
- **Request size:** JSON bodies are limited to 1 MB.
- **Off by default:** without a token of at least 32 characters, `/mcp` returns `404`.
