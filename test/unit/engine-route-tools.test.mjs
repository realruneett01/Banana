import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { createRegistry } from "../../backend/src/engine/tool-registry.js";
import { registerRouteTools } from "../../backend/src/engine/tools/route-tools.js";

const CANNED_SES_TEXT = `(session test_board
	(routes
		(network_out
			(net "Net-(R1-Pad1)"
				(wire
					(path F.Cu 250 10000 20000 30000 20000)
				)
				(via "Via[T]Pad_600x600_um" 30000 20000)
			)
		)
	)
)`;

function makeSampleIr(parts) {
	return {
		schemaVersion: 1,
		name: "RouteTestBoard",
		parts: parts ?? [
			{
				id: "part-1",
				ref: "R1",
				footprint: "Resistor_SMD:R_0603",
				placement: { x: 10, y: 10, rot: 0, side: "F" },
			},
		],
		nets: [
			{
				id: "net-1",
				name: "Net-(R1-Pad1)",
				pins: [{ partId: "part-1", pin: "1" }],
			},
		],
	};
}

function makeValidInput(overrides = {}) {
	return {
		ir: makeSampleIr(),
		boardW: 50,
		boardH: 40,
		...overrides,
	};
}

function setupRouteTest(depsOverrides = {}) {
	const registry = createRegistry();
	const defaultFreerouting = {
		available: () => true,
		route: async () => CANNED_SES_TEXT,
	};
	const deps = {
		freerouting: defaultFreerouting,
		tempDir: os.tmpdir(),
		autoPlaceFn: (ir) => ({ ir, placed: [] }),
		...depsOverrides,
	};
	registerRouteTools(registry, deps);
	return { registry, deps };
}

describe("registerRouteTools metadata", () => {
	test("registers ir.route tool with permission read", () => {
		const { registry } = setupRouteTest();
		const tool = registry.list().find((t) => t.name === "ir.route");
		assert.ok(tool);
		assert.equal(tool.permission, "read");
		assert.equal(typeof tool.description, "string");
		assert.equal(tool.inputSchema.type, "object");
	});
});

describe("freerouting configuration check", () => {
	test("returns error when freerouting is not available", async () => {
		const { registry } = setupRouteTest({
			freerouting: { available: () => false, route: async () => "" },
		});
		const res = await registry.call("ir.route", makeValidInput());
		assert.equal(res.ok, false);
		assert.equal(
			res.error,
			"Freerouting is not configured (set FREEROUTING_JAR)",
		);
	});
});

describe("input validation via registry", () => {
	const VALID_IR = makeSampleIr();
	const TABLE_CASES = [
		{ label: "missing ir", input: { boardW: 50, boardH: 40 } },
		{ label: "missing boardW", input: { ir: VALID_IR, boardH: 40 } },
		{ label: "missing boardH", input: { ir: VALID_IR, boardW: 50 } },
		{
			label: "extra property",
			input: { ir: VALID_IR, boardW: 50, boardH: 40, extra: true },
		},
		{
			label: "boardW is string",
			input: { ir: VALID_IR, boardW: "bad", boardH: 40 },
		},
		{
			label: "boardH is string",
			input: { ir: VALID_IR, boardW: 50, boardH: "bad" },
		},
		{
			label: "boardW <= 0",
			input: { ir: VALID_IR, boardW: 0, boardH: 40 },
		},
		{
			label: "boardH <= 0",
			input: { ir: VALID_IR, boardW: 50, boardH: -5 },
		},
		{
			label: "rules with extra property",
			input: {
				ir: VALID_IR,
				boardW: 50,
				boardH: 40,
				rules: { unexpectedField: 123 },
			},
		},
	];

	for (const { label, input } of TABLE_CASES) {
		test(`rejects input with ${label}`, async () => {
			const { registry } = setupRouteTest();
			const res = await registry.call("ir.route", input);
			assert.equal(res.ok, false);
			assert.ok(typeof res.error === "string" && res.error.length > 0);
		});
	}
});

describe("happy path routing", () => {
	test("routes tracks and vias from canned SES text", async () => {
		const { registry } = setupRouteTest();
		const res = await registry.call("ir.route", makeValidInput());
		assert.equal(res.ok, true);
		assert.ok(res.output.placedIr);
		assert.equal(res.output.routes.wires.length, 1);
		assert.equal(res.output.routes.vias.length, 1);
		assert.equal(res.output.routes.wires[0].net, "Net-(R1-Pad1)");
		assert.equal(res.output.routes.wires[0].layer, "F.Cu");
		assert.equal(res.output.routes.vias[0].net, "Net-(R1-Pad1)");
	});
});

describe("auto-place integration", () => {
	test("does not invoke auto-place when all parts have positions", async () => {
		let autoPlaceCalled = false;
		const { registry } = setupRouteTest({
			autoPlaceFn: () => {
				autoPlaceCalled = true;
				return { ir: {}, placed: [] };
			},
		});
		const res = await registry.call("ir.route", makeValidInput());
		assert.equal(res.ok, true);
		assert.equal(autoPlaceCalled, false);
	});

	test("invokes auto-place when any part lacks placement", async () => {
		let autoPlaceCalled = false;
		const unplacedIr = makeSampleIr([
			{
				id: "part-1",
				ref: "R1",
				footprint: "Resistor_SMD:R_0603",
				placement: { x: 10, y: 10, rot: 0, side: "F" },
			},
			{
				id: "part-2",
				ref: "R2",
				footprint: "Resistor_SMD:R_0603",
			},
		]);
		const placedTargetIr = {
			...unplacedIr,
			parts: [
				unplacedIr.parts[0],
				{
					...unplacedIr.parts[1],
					placement: { x: 25, y: 25, rot: 0, side: "F" },
				},
			],
		};
		const { registry } = setupRouteTest({
			autoPlaceFn: () => {
				autoPlaceCalled = true;
				return { ir: placedTargetIr, placed: ["part-2"] };
			},
		});
		const res = await registry.call(
			"ir.route",
			makeValidInput({ ir: unplacedIr }),
		);
		assert.equal(res.ok, true);
		assert.equal(autoPlaceCalled, true);
		assert.deepEqual(res.output.placedIr, placedTargetIr);
	});
});

describe("work directory lifecycle and cleanup", () => {
	test("creates workDir under tempDir and cleans it up after success", async () => {
		const tempBase = await fs.promises.mkdtemp(
			path.join(os.tmpdir(), "rt-test-base-"),
		);
		let capturedWorkDir = null;
		const { registry } = setupRouteTest({
			tempDir: tempBase,
			freerouting: {
				available: () => true,
				route: async ({ workDir }) => {
					capturedWorkDir = workDir;
					assert.ok(fs.existsSync(workDir));
					return CANNED_SES_TEXT;
				},
			},
		});
		try {
			const res = await registry.call("ir.route", makeValidInput());
			assert.equal(res.ok, true);
			assert.ok(capturedWorkDir);
			assert.ok(capturedWorkDir.startsWith(tempBase));
			assert.equal(fs.existsSync(capturedWorkDir), false);
		} finally {
			await fs.promises.rm(tempBase, { recursive: true, force: true });
		}
	});

	test("removes workDir even when freerouting route throws", async () => {
		const tempBase = await fs.promises.mkdtemp(
			path.join(os.tmpdir(), "rt-fail-base-"),
		);
		let capturedWorkDir = null;
		const { registry } = setupRouteTest({
			tempDir: tempBase,
			freerouting: {
				available: () => true,
				route: async ({ workDir }) => {
					capturedWorkDir = workDir;
					assert.ok(fs.existsSync(workDir));
					throw new Error("Java router process died");
				},
			},
		});
		try {
			const res = await registry.call("ir.route", makeValidInput());
			assert.equal(res.ok, false);
			assert.equal(res.error, "Java router process died");
			assert.ok(capturedWorkDir);
			assert.equal(fs.existsSync(capturedWorkDir), false);
		} finally {
			await fs.promises.rm(tempBase, { recursive: true, force: true });
		}
	});
});
