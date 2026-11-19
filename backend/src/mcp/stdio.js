import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export async function runStdioServer() {
	console.log = console.error;
	console.info = console.error;
	console.debug = console.error;

	const { createRegistry } = await import("../engine/tool-registry.js");
	const { registerDesignTools } = await import(
		"../engine/tools/design-tools.js"
	);
	const { registerDiffTools } = await import("../engine/tools/diff-tools.js");
	const { registerKicadTools } = await import("../engine/tools/kicad-tools.js");
	const { registerCommitTools } = await import(
		"../engine/tools/commit-tools.js"
	);
	const { registerRouteTools } = await import("../engine/tools/route-tools.js");
	const { registerProjectTools } = await import(
		"../engine/tools/project-tools.js"
	);
	const { createMcpServer } = await import("./server.js");

	const registry = createRegistry();
	registerDiffTools(registry);
	registerKicadTools(registry);
	registerDesignTools(registry);
	registerRouteTools(registry);
	registerCommitTools(registry);
	registerProjectTools(registry);

	const server = createMcpServer({ registry });
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Banana MCP server running on stdio");
	return { server, transport };
}

function isDirectExecution() {
	if (!process.argv[1]) {
		return false;
	}
	const currentFile = fileURLToPath(import.meta.url);
	const targetPath = path.resolve(process.argv[1]);
	return targetPath === currentFile || `${targetPath}.js` === currentFile;
}

if (isDirectExecution()) {
	runStdioServer().catch((err) => {
		// Log startup error to stderr and exit
		console.error(
			"Fatal error starting Banana MCP server:",
			err?.message || err,
		);
		process.exit(1);
	});
}
