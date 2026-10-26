#!/usr/bin/env node
/**
 * Banana MCP server (stdio). Add it to any MCP-capable assistant, for example:
 *   { "mcpServers": { "banana": { "command": "node", "args": ["/path/to/banana/scripts/banana-mcp.mjs"] } } }
 * Environment: BANANA_PROJECTS_DIR (where boards live), KICAD_CLI_PATH, NGSPICE_PATH.
 */
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--print-config")) {
	const script = fileURLToPath(import.meta.url);
	const snippet = { mcpServers: { banana: { command: process.execPath, args: [path.resolve(script)] } } };
	process.stdout.write(`${JSON.stringify(snippet, null, 2)}\n`);
	process.exit(0);
}

// stdout carries the protocol; everything human-readable must go to stderr.
console.log = (...a) => console.error(...a);
console.info = (...a) => console.error(...a);

const { handleLine } = await import("../backend/src/mcp/protocol.js");

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let pending = 0;
let closed = false;
const finish = () => {
	if (closed && pending === 0) process.exit(0);
};
rl.on("line", (line) => {
	if (!line.trim()) return;
	pending++;
	handleLine(line)
		.then((reply) => {
			if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
		})
		.catch((err) => {
			console.error("[Banana MCP] fatal handler error:", err);
			process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } })}\n`);
		})
		.finally(() => {
			pending--;
			finish();
		});
});
rl.on("close", () => {
	closed = true;
	finish();
});
console.error("[Banana MCP] ready");
