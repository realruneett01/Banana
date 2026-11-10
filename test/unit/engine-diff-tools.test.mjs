import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { registerDiffTools } from "../../backend/src/engine/tools/diff-tools.js";

const VALID_PCB_BASE = "/abs/path/project/board_base.kicad_pcb";
const VALID_PCB_TARGET = "/abs/path/project/board_target.kicad_pcb";
const VALID_SCH_BASE = "/abs/path/project/schematic_base.kicad_sch";
const VALID_SCH_TARGET = "/abs/path/project/schematic_target.kicad_sch";
const VALID_WIN_BASE = "C:/projects/board_base.kicad_pcb";
const VALID_WIN_TARGET = "C:\\projects\\board_target.kicad_pcb";

function setupRegistryWithFake(fakeRunDiff) {
	const registry = createRegistry();
	registerDiffTools(registry, { runDiff: fakeRunDiff });
	return registry;
}

describe("module contract", () => {
	test("exports match the contract exactly", async () => {
		const mod = await import("../../backend/src/engine/tools/diff-tools.js");
		const exportedKeys = Object.keys(mod).sort();
		assert.deepEqual(exportedKeys, ["registerDiffTools"]);
	});
});

describe("tool registration and schema", () => {
	test("registers read-only tool diff.compare_files", () => {
		const registry = createRegistry();
		registerDiffTools(registry, {
			runDiff: async () => ({ modifications: [] }),
		});
		const tools = registry.list();
		assert.equal(tools.length, 1);
		const tool = tools[0];
		assert.equal(tool.name, "diff.compare_files");
		assert.equal(tool.permission, "read");
		assert.equal(typeof tool.description, "string");
		assert.equal(tool.description.length > 0, true);
	});

	test("input schema requires basePath and targetPath", () => {
		const registry = createRegistry();
		registerDiffTools(registry, {
			runDiff: async () => ({ modifications: [] }),
		});
		const [tool] = registry.list();
		assert.equal(tool.inputSchema.type, "object");
		assert.deepEqual(tool.inputSchema.required, ["basePath", "targetPath"]);
		assert.equal(tool.inputSchema.properties.basePath.type, "string");
		assert.equal(tool.inputSchema.properties.targetPath.type, "string");
		assert.equal(tool.inputSchema.properties.isPcb.type, "boolean");
	});

	test("registers successfully with default deps when deps omitted", () => {
		const registry = createRegistry();
		registerDiffTools(registry);
		assert.equal(registry.list().length, 1);
		assert.equal(registry.list()[0].name, "diff.compare_files");
	});
});

describe("call execution with fake runDiff", () => {
	test("executes PCB diff and infers isPcb=true from .kicad_pcb", async () => {
		let capturedArgs = null;
		const fakeResult = {
			modifications: [{ type: "add", id: "mod_1" }],
			pcbMetadata: { padCount: 42 },
			telemetry: { tDiff: 15.2 },
		};
		const registry = setupRegistryWithFake(async (args) => {
			capturedArgs = args;
			return fakeResult;
		});

		const res = await registry.call("diff.compare_files", {
			basePath: VALID_PCB_BASE,
			targetPath: VALID_PCB_TARGET,
		});

		assert.equal(res.ok, true);
		assert.deepEqual(res.output, fakeResult);
		assert.deepEqual(capturedArgs, {
			basePath: VALID_PCB_BASE,
			targetPath: VALID_PCB_TARGET,
			isPcb: true,
		});
	});

	test("executes schematic diff and infers isPcb=false from .kicad_sch", async () => {
		let capturedArgs = null;
		const registry = setupRegistryWithFake(async (args) => {
			capturedArgs = args;
			return { modifications: [] };
		});

		const res = await registry.call("diff.compare_files", {
			basePath: VALID_SCH_BASE,
			targetPath: VALID_SCH_TARGET,
		});

		assert.equal(res.ok, true);
		assert.deepEqual(res.output, { modifications: [] });
		assert.equal(capturedArgs.isPcb, false);
	});

	test("respects explicit isPcb override", async () => {
		let capturedArgs = null;
		const registry = setupRegistryWithFake(async (args) => {
			capturedArgs = args;
			return { modifications: [] };
		});

		const res = await registry.call("diff.compare_files", {
			basePath: VALID_PCB_BASE,
			targetPath: VALID_PCB_TARGET,
			isPcb: false,
		});

		assert.equal(res.ok, true);
		assert.equal(capturedArgs.isPcb, false);
	});

	test("accepts Windows absolute paths with drive letters and backslashes", async () => {
		const registry = setupRegistryWithFake(async () => ({ modifications: [] }));
		const res = await registry.call("diff.compare_files", {
			basePath: VALID_WIN_BASE,
			targetPath: VALID_WIN_TARGET,
		});
		assert.equal(res.ok, true);
	});

	test("accepts output with null pcbMetadata", async () => {
		const registry = setupRegistryWithFake(async () => ({
			modifications: [],
			pcbMetadata: null,
		}));
		const res = await registry.call("diff.compare_files", {
			basePath: VALID_SCH_BASE,
			targetPath: VALID_SCH_TARGET,
		});
		assert.equal(res.ok, true);
		assert.deepEqual(res.output, { modifications: [], pcbMetadata: null });
	});
});

describe("input validation rejects invalid paths and shapes", () => {
	const BAD_INPUT_CASES = [
		{ label: "missing basePath", input: { targetPath: VALID_PCB_TARGET } },
		{ label: "missing targetPath", input: { basePath: VALID_PCB_BASE } },
		{
			label: "relative basePath without leading slash",
			input: { basePath: "board.kicad_pcb", targetPath: VALID_PCB_TARGET },
		},
		{
			label: "relative basePath with dot-slash",
			input: { basePath: "./board.kicad_pcb", targetPath: VALID_PCB_TARGET },
		},
		{
			label: "relative basePath with dot-dot",
			input: { basePath: "../board.kicad_pcb", targetPath: VALID_PCB_TARGET },
		},
		{
			label: "basePath ending in wrong extension",
			input: { basePath: "/abs/board.txt", targetPath: VALID_PCB_TARGET },
		},
		{
			label: "targetPath ending in wrong extension",
			input: { basePath: VALID_PCB_BASE, targetPath: "/abs/board.kicad_pro" },
		},
		{
			label: "basePath ending with extra extension suffix",
			input: {
				basePath: "/abs/board.kicad_pcb.bak",
				targetPath: VALID_PCB_TARGET,
			},
		},
		{
			label: "non-string basePath",
			input: { basePath: 12345, targetPath: VALID_PCB_TARGET },
		},
		{
			label: "non-boolean isPcb",
			input: {
				basePath: VALID_PCB_BASE,
				targetPath: VALID_PCB_TARGET,
				isPcb: "true",
			},
		},
		{
			label: "unexpected extra property",
			input: {
				basePath: VALID_PCB_BASE,
				targetPath: VALID_PCB_TARGET,
				unknownKey: "value",
			},
		},
	];

	for (const { label, input } of BAD_INPUT_CASES) {
		test(`rejects ${label}`, async () => {
			let called = false;
			const registry = setupRegistryWithFake(async () => {
				called = true;
				return { modifications: [] };
			});

			const res = await registry.call("diff.compare_files", input);
			assert.equal(res.ok, false);
			assert.equal(typeof res.error, "string");
			assert.equal(called, false);
		});
	}

	const GARBAGE_INPUTS = [null, undefined, 42, "not-an-object", true, []];
	for (const garbage of GARBAGE_INPUTS) {
		test(`handles garbage input without throwing: ${String(garbage)}`, async () => {
			const registry = setupRegistryWithFake(async () => ({
				modifications: [],
			}));
			assert.doesNotThrow(async () => {
				const res = await registry.call("diff.compare_files", garbage);
				assert.equal(res.ok, false);
			});
		});
	}
});

describe("error handling", () => {
	test("returns ok:false on async runDiff rejection", async () => {
		const registry = setupRegistryWithFake(async () => {
			throw new Error("KiCad CLI diff crashed");
		});

		const res = await registry.call("diff.compare_files", {
			basePath: VALID_PCB_BASE,
			targetPath: VALID_PCB_TARGET,
		});

		assert.equal(res.ok, false);
		assert.equal(res.error, "KiCad CLI diff crashed");
	});

	test("returns ok:false on synchronous runDiff throw", async () => {
		const registry = setupRegistryWithFake(() => {
			throw new Error("Synchronous diff setup error");
		});

		const res = await registry.call("diff.compare_files", {
			basePath: VALID_PCB_BASE,
			targetPath: VALID_PCB_TARGET,
		});

		assert.equal(res.ok, false);
		assert.equal(res.error, "Synchronous diff setup error");
	});

	test("returns ok:false when runDiff output violates outputSchema", async () => {
		const registry = setupRegistryWithFake(async () => ({
			invalidField: "no-modifications",
		}));

		const res = await registry.call("diff.compare_files", {
			basePath: VALID_PCB_BASE,
			targetPath: VALID_PCB_TARGET,
		});

		assert.equal(res.ok, false);
		assert.match(res.error, /\$\.modifications: missing/);
	});
});
