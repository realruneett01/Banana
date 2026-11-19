import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { createMcpServer } from "../../backend/src/mcp/server.js";

function makeSchema(property, type = "string") {
	return {
		type: "object",
		required: [property],
		properties: { [property]: { type } },
	};
}

const TEST_TOOLS = [
	{
		name: "tool_read",
		description: "Reads data",
		inputSchema: makeSchema("id"),
		outputSchema: makeSchema("data"),
		permission: "read",
		handler: (input) => ({ data: `read-${input.id}` }),
	},
	{
		name: "tool_write",
		description: "Writes data",
		inputSchema: makeSchema("value"),
		outputSchema: makeSchema("status"),
		permission: "write",
		handler: (input) => ({ status: `wrote-${input.value}` }),
	},
	{
		name: "tool_destructive",
		description: "Destroys data",
		inputSchema: makeSchema("target"),
		outputSchema: makeSchema("destroyed", "boolean"),
		permission: "destructive",
		handler: (_input) => ({ destroyed: true }),
	},
];

function registerReadTool(registry) {
	registry.register(TEST_TOOLS[0]);
}

function registerWriteTool(registry) {
	registry.register(TEST_TOOLS[1]);
}

function registerDestructiveTool(registry) {
	registry.register(TEST_TOOLS[2]);
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

async function withTestClient(options = {}, fn) {
	const registry = createRegistry();
	registerTestTools(registry);
	const { client, cleanup } = await setupTestClient({ registry, ...options });
	try {
		await fn(client);
	} finally {
		await cleanup();
	}
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

const EXPECTED_HINTS = [
	{ name: "tool_read", readOnlyHint: true, destructiveHint: false },
	{ name: "tool_write", readOnlyHint: false, destructiveHint: false },
	{ name: "tool_destructive", readOnlyHint: false, destructiveHint: true },
];

function assertToolsListHints(tools) {
	assert.equal(tools.length, EXPECTED_HINTS.length);
	for (const { name, ...hints } of EXPECTED_HINTS) {
		assertToolHints(
			tools.find((t) => t.name === name),
			hints,
		);
	}
}

function assertToolSuccess(res, expectedData) {
	assert.equal(res.isError, undefined);
	assert.deepEqual(res.structuredContent, expectedData);
	assert.equal(res.content.length, 1);
	assert.equal(res.content[0].type, "text");
	assert.equal(res.content[0].text, JSON.stringify(expectedData));
}

function assertToolError(res, pattern) {
	assert.equal(res.isError, true);
	assert.equal(res.content[0].type, "text");
	if (pattern) {
		assert.match(res.content[0].text, pattern);
	} else {
		assert.ok(res.content[0].text.length > 0);
	}
}

async function runTestCase(client, testCase) {
	if (testCase.run) {
		await testCase.run(client);
		return;
	}
	const res = await client.callTool(testCase.call);
	testCase.assert(res);
}

const CASES = [
	{
		name: "tools/list returns all three tools with correct hints",
		run: async (client) => {
			const res = await client.listTools();
			assertToolsListHints(res.tools);
		},
	},
	{
		name: "calling the read tool returns its output as text and structuredContent",
		call: { name: "tool_read", arguments: { id: "item-42" } },
		assert: (res) => assertToolSuccess(res, { data: "read-item-42" }),
	},
	{
		name: "calling a tool with invalid input returns isError",
		call: { name: "tool_read", arguments: {} },
		assert: (res) => assertToolError(res),
	},
	{
		name: "destructive tool returns isError 'approval required' by default",
		options: { approveDestructive: false },
		call: { name: "tool_destructive", arguments: { target: "board" } },
		assert: (res) => assertToolError(res, /approval required/i),
	},
	{
		name: "destructive tool succeeds when approveDestructive is true",
		options: { approveDestructive: true },
		call: { name: "tool_destructive", arguments: { target: "board" } },
		assert: (res) => assertToolSuccess(res, { destroyed: true }),
	},
	{
		name: "calling unknown tool returns isError and does not crash",
		call: { name: "tool_unknown", arguments: {} },
		assert: (res) => assertToolError(res, /unknown tool/i),
	},
];

describe("mcp server", () => {
	for (const testCase of CASES) {
		test(testCase.name, async () => {
			await withTestClient(testCase.options, (client) =>
				runTestCase(client, testCase),
			);
		});
	}
});
