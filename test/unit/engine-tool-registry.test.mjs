import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";

function createValidTool(overrides = {}) {
	return {
		name: "echo_tool",
		description: "Echoes input text",
		inputSchema: {
			type: "object",
			required: ["text"],
			properties: { text: { type: "string" } },
		},
		outputSchema: {
			type: "object",
			required: ["echo"],
			properties: { echo: { type: "string" } },
		},
		permission: "read",
		handler: (input) => ({ echo: input.text }),
		...overrides,
	};
}

describe("module contract", () => {
	test("exports match the contract exactly", async () => {
		const registryModule = await import(
			"../../backend/src/engine/tool-registry.js"
		);
		assert.deepEqual(Object.keys(registryModule).sort(), ["createRegistry"]);
	});

	test("createRegistry returns registry with register, list, and call", () => {
		const reg = createRegistry();
		for (const method of ["register", "list", "call"]) {
			assert.equal(typeof reg[method], "function");
		}
	});
});

describe("register: valid definitions", () => {
	const PERMISSION_CASES = ["read", "write", "destructive"];
	for (const perm of PERMISSION_CASES) {
		test(`registers tool with permission: ${perm}`, () => {
			const reg = createRegistry();
			reg.register(createValidTool({ name: `tool_${perm}`, permission: perm }));
			const tools = reg.list();
			assert.equal(tools.length, 1);
			assert.equal(tools[0].permission, perm);
		});
	}

	test("accepts valid explicit tool id", () => {
		const reg = createRegistry();
		const toolId = newId("tool");
		reg.register(createValidTool({ id: toolId }));
		assert.equal(reg.list().length, 1);
	});
});

describe("register: rejects invalid definitions", () => {
	const PRIMITIVE_CASES = [
		{ label: "null", def: null },
		{ label: "undefined", def: undefined },
		{ label: "number", def: 42 },
		{ label: "string", def: "not-a-tool" },
		{ label: "array", def: [] },
	];

	for (const { label, def } of PRIMITIVE_CASES) {
		test(`throws when definition has ${label}`, () => {
			const reg = createRegistry();
			assert.throws(() => reg.register(def), Error);
		});
	}

	const TOOL_OVERRIDE_CASES = [
		["missing name", { name: undefined }],
		["empty name", { name: "" }],
		["non-string name", { name: 123 }],
		["missing description", { description: undefined }],
		["non-string description", { description: false }],
		["missing inputSchema", { inputSchema: undefined }],
		["non-object inputSchema", { inputSchema: "string" }],
		["null inputSchema", { inputSchema: null }],
		["missing outputSchema", { outputSchema: undefined }],
		["non-object outputSchema", { outputSchema: 123 }],
		["null outputSchema", { outputSchema: null }],
		["missing permission", { permission: undefined }],
		["invalid permission", { permission: "admin" }],
		["missing handler", { handler: undefined }],
		["non-function handler", { handler: "function" }],
		["invalid id format", { id: "bad-id" }],
		["invalid id kind", { id: newId("part") }],
		["unexpected extra property", { extraField: true }],
	];

	for (const [label, overrides] of TOOL_OVERRIDE_CASES) {
		test(`throws when definition has ${label}`, () => {
			const reg = createRegistry();
			assert.throws(() => reg.register(createValidTool(overrides)), Error);
		});
	}

	test("throws on duplicate tool registration", () => {
		const reg = createRegistry();
		reg.register(createValidTool({ name: "dup_tool" }));
		assert.throws(
			() => reg.register(createValidTool({ name: "dup_tool" })),
			/Tool already registered/,
		);
	});
});

describe("list", () => {
	test("returns empty array for new registry", () => {
		const reg = createRegistry();
		assert.deepEqual(reg.list(), []);
	});

	test("returns declared tools excluding handler and outputSchema", () => {
		const reg = createRegistry();
		reg.register(createValidTool({ name: "t1", permission: "read" }));
		reg.register(createValidTool({ name: "t2", permission: "write" }));
		const list = reg.list();
		assert.equal(list.length, 2);
		assert.deepEqual(list[0], {
			name: "t1",
			description: "Echoes input text",
			inputSchema: {
				type: "object",
				required: ["text"],
				properties: { text: { type: "string" } },
			},
			permission: "read",
		});
		assert.equal("handler" in list[0], false);
		assert.equal("outputSchema" in list[0], false);
	});

	test("returned list cannot mutate internal registry storage", () => {
		const reg = createRegistry();
		reg.register(createValidTool());
		const list = reg.list();
		list.pop();
		assert.equal(reg.list().length, 1);
	});
});

describe("call: permissions and approvals", () => {
	test("runs read tool without ctx", () => {
		const reg = createRegistry();
		reg.register(createValidTool({ permission: "read" }));
		const res = reg.call("echo_tool", { text: "hello" });
		assert.deepEqual(res, { ok: true, output: { echo: "hello" } });
	});

	test("runs write tool without ctx", () => {
		const reg = createRegistry();
		reg.register(createValidTool({ permission: "write" }));
		const res = reg.call("echo_tool", { text: "hello" });
		assert.deepEqual(res, { ok: true, output: { echo: "hello" } });
	});

	const UNAPPROVED_CTX_CASES = [
		{ label: "omitted ctx", ctx: undefined },
		{ label: "null ctx", ctx: null },
		{ label: "empty object ctx", ctx: {} },
		{ label: "ctx with approved false", ctx: { approved: false } },
		{ label: "ctx with approved string", ctx: { approved: "true" } },
		{ label: "ctx with approved number", ctx: { approved: 1 } },
	];

	for (const { label, ctx } of UNAPPROVED_CTX_CASES) {
		test(`destructive tool rejects call with ${label}`, () => {
			const reg = createRegistry();
			reg.register(createValidTool({ permission: "destructive" }));
			const res = reg.call("echo_tool", { text: "wipe" }, ctx);
			assert.deepEqual(res, { ok: false, error: "approval required" });
		});
	}

	test("destructive tool executes when ctx.approved is true", () => {
		const reg = createRegistry();
		reg.register(createValidTool({ permission: "destructive" }));
		const res = reg.call("echo_tool", { text: "wipe" }, { approved: true });
		assert.deepEqual(res, { ok: true, output: { echo: "wipe" } });
	});
});

describe("call: input, output, and handler error handling", () => {
	test("rejects input violating inputSchema", () => {
		const reg = createRegistry();
		reg.register(createValidTool());
		const res = reg.call("echo_tool", { text: 123 });
		assert.equal(res.ok, false);
		assert.match(res.error, /\$\.text: expected string/);
	});

	test("rejects output violating outputSchema", () => {
		const reg = createRegistry();
		reg.register(createValidTool({ handler: () => ({ echo: 999 }) }));
		const res = reg.call("echo_tool", { text: "hello" });
		assert.equal(res.ok, false);
		assert.match(res.error, /\$\.echo: expected string/);
	});

	test("captures synchronous handler exceptions into error string", () => {
		const reg = createRegistry();
		reg.register(
			createValidTool({
				handler: () => {
					throw new Error("handler failure");
				},
			}),
		);
		const res = reg.call("echo_tool", { text: "hello" });
		assert.deepEqual(res, { ok: false, error: "handler failure" });
	});

	test("handles async handler successfully", async () => {
		const reg = createRegistry();
		reg.register(
			createValidTool({
				handler: async (input) => ({ echo: `async_${input.text}` }),
			}),
		);
		const res = await reg.call("echo_tool", { text: "test" });
		assert.deepEqual(res, { ok: true, output: { echo: "async_test" } });
	});

	test("captures async handler rejections into error string", async () => {
		const reg = createRegistry();
		reg.register(
			createValidTool({
				handler: async () => {
					throw new Error("async failure");
				},
			}),
		);
		const res = await reg.call("echo_tool", { text: "test" });
		assert.deepEqual(res, { ok: false, error: "async failure" });
	});
});

describe("call: garbage input never throws", () => {
	const GARBAGE_NAMES = [null, undefined, 42, true, {}, []];
	for (const badName of GARBAGE_NAMES) {
		test(`returns error when tool name is ${String(badName)}`, () => {
			const reg = createRegistry();
			assert.doesNotThrow(() => {
				const res = reg.call(badName, {});
				assert.equal(res.ok, false);
				assert.match(res.error, /unknown tool:/);
			});
		});
	}

	const GARBAGE_INPUTS = [null, undefined, 123, "text", true, []];
	for (const badInput of GARBAGE_INPUTS) {
		test(`returns error when tool input is ${String(badInput)}`, () => {
			const reg = createRegistry();
			reg.register(createValidTool());
			assert.doesNotThrow(() => {
				const res = reg.call("echo_tool", badInput);
				assert.equal(res.ok, false);
			});
		});
	}
});

describe("registry isolation", () => {
	test("separate registries do not share registered tools", () => {
		const reg1 = createRegistry();
		const reg2 = createRegistry();
		reg1.register(createValidTool({ name: "tool_only_in_1" }));
		assert.equal(reg1.list().length, 1);
		assert.equal(reg2.list().length, 0);
		assert.equal(reg2.call("tool_only_in_1", { text: "hi" }).ok, false);
	});
});
