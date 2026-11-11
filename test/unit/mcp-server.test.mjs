import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { createMcpServer } from "../../backend/src/mcp/server.js";

function registerReadTool(registry) {
	registry.register({
		name: "tool_read",
		description: "Reads data",
		inputSchema: {
			type: "object",
			required: ["id"],
			properties: { id: { type: "string" } },
		},
		outputSchema: {
			type: "object",
			required: ["data"],
			properties: { data: { type: "string" } },
		},
		permission: "read",
		handler: (input) => ({ data: `read-${input.id}` }),
	});
}

function registerWriteTool(registry) {
	registry.register({
		name: "tool_write",
		description: "Writes data",
		inputSchema: {
			type: "object",
			required: ["value"],
			properties: { value: { type: "string" } },
		},
		outputSchema: {
			type: "object",
			required: ["status"],
			properties: { status: { type: "string" } },
		},
		permission: "write",
		handler: (input) => ({ status: `wrote-${input.value}` }),
	});
}

function registerDestructiveTool(registry) {
	registry.register({
		name: "tool_destructive",
		description: "Destroys data",
		inputSchema: {
			type: "object",
			required: ["target"],
			properties: { target: { type: "string" } },
		},
		outputSchema: {
			type: "object",
			required: ["destroyed"],
			properties: { destroyed: { type: "boolean" } },
		},
		permission: "destructive",
		handler: (_input) => ({ destroyed: true }),
	});
}

function registerTestTools(registry) {
	registerReadTool(registry);
	registerWriteTool(registry);
	registerDestructiveTool(registry);
}

async function setupTestClient(options = {}) {
	const { registry, approveDestructive = false } = options;
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const server = createMcpServer({
		registry,
		approveDestructive,
	});
	const client = new Client(
		{ name: "test-client", version: "1.0.0" },
		{ capabilities: {} },
	);
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	return {
		client,
		server,
		cleanup: async () => {
			await client.close();
			await server.close();
		},
	};
}

function assertToolHints(tool, expectedHints) {
	assert.ok(tool);
	assert.equal(tool.annotations?.readOnlyHint, expectedHints.readOnlyHint);
	assert.equal(
		tool.annotations?.destructiveHint,
		expectedHints.destructiveHint,
	);
	assert.equal(tool.inputSchema.type, "object");
}

function assertToolsListHints(tools) {
	assert.equal(tools.length, 3);
	assertToolHints(
		tools.find((t) => t.name === "tool_read"),
		{
			readOnlyHint: true,
			destructiveHint: false,
		},
	);
	assertToolHints(
		tools.find((t) => t.name === "tool_write"),
		{
			readOnlyHint: false,
			destructiveHint: false,
		},
	);
	assertToolHints(
		tools.find((t) => t.name === "tool_destructive"),
		{
			readOnlyHint: false,
			destructiveHint: true,
		},
	);
}

describe("mcp server", () => {
	test("tools/list returns all three tools with correct hints", async () => {
		const registry = createRegistry();
		registerTestTools(registry);
		const { client, cleanup } = await setupTestClient({ registry });

		try {
			const res = await client.listTools();
			assertToolsListHints(res.tools);
		} finally {
			await cleanup();
		}
	});

	test("calling the read tool returns its output as text and structuredContent", async () => {
		const registry = createRegistry();
		registerTestTools(registry);
		const { client, cleanup } = await setupTestClient({ registry });

		try {
			const res = await client.callTool({
				name: "tool_read",
				arguments: { id: "item-42" },
			});
			assert.equal(res.isError, undefined);
			assert.deepEqual(res.structuredContent, { data: "read-item-42" });
			assert.equal(res.content.length, 1);
			assert.equal(res.content[0].type, "text");
			assert.equal(
				res.content[0].text,
				JSON.stringify({ data: "read-item-42" }),
			);
		} finally {
			await cleanup();
		}
	});

	test("calling a tool with invalid input returns isError", async () => {
		const registry = createRegistry();
		registerTestTools(registry);
		const { client, cleanup } = await setupTestClient({ registry });

		try {
			const res = await client.callTool({
				name: "tool_read",
				arguments: {},
			});
			assert.equal(res.isError, true);
			assert.equal(res.content[0].type, "text");
			assert.ok(res.content[0].text.length > 0);
		} finally {
			await cleanup();
		}
	});

	test("destructive tool returns isError 'approval required' by default", async () => {
		const registry = createRegistry();
		registerTestTools(registry);
		const { client, cleanup } = await setupTestClient({
			registry,
			approveDestructive: false,
		});

		try {
			const res = await client.callTool({
				name: "tool_destructive",
				arguments: { target: "board" },
			});
			assert.equal(res.isError, true);
			assert.equal(res.content[0].type, "text");
			assert.match(res.content[0].text, /approval required/i);
		} finally {
			await cleanup();
		}
	});

	test("destructive tool succeeds when approveDestructive is true", async () => {
		const registry = createRegistry();
		registerTestTools(registry);
		const { client, cleanup } = await setupTestClient({
			registry,
			approveDestructive: true,
		});

		try {
			const res = await client.callTool({
				name: "tool_destructive",
				arguments: { target: "board" },
			});
			assert.equal(res.isError, undefined);
			assert.deepEqual(res.structuredContent, { destroyed: true });
			assert.equal(res.content[0].text, JSON.stringify({ destroyed: true }));
		} finally {
			await cleanup();
		}
	});

	test("calling unknown tool returns isError and does not crash", async () => {
		const registry = createRegistry();
		registerTestTools(registry);
		const { client, cleanup } = await setupTestClient({ registry });

		try {
			const res = await client.callTool({
				name: "tool_unknown",
				arguments: {},
			});
			assert.equal(res.isError, true);
			assert.equal(res.content[0].type, "text");
			assert.match(res.content[0].text, /unknown tool/i);
		} finally {
			await cleanup();
		}
	});
});
