import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
	createFreerouting,
	irToDsn,
	parseSes,
} from "../../backend/src/engine/freerouting.js";
import { parse } from "../../backend/src/engine/sexpr.js";

const PART_1_ID = "part_11111111-1111-1111-1111-111111111111";
const PART_2_ID = "part_22222222-2222-2222-2222-222222222222";

function makeSmdPads(xOffset, size) {
	return [
		{ number: "1", at: [-xOffset, 0], size },
		{ number: "2", at: [xOffset, 0], size },
	];
}

const SAMPLE_FOOTPRINTS = {
	"Resistor SMD:R 0805": { pads: makeSmdPads(1.0, [1.2, 1.4]) },
	"Capacitor_SMD:C_0603": { pads: makeSmdPads(0.75, [0.8, 0.9]) },
};

function createSampleParts() {
	return [
		{
			id: PART_1_ID,
			ref: "R1",
			value: "10k",
			symbol: "Device:R",
			footprint: "Resistor SMD:R 0805",
			props: {},
			placement: { x: 20, y: 15, rot: 90, side: "F" },
		},
		{
			id: PART_2_ID,
			ref: "C1",
			value: "100n",
			symbol: "Device:C",
			footprint: "Capacitor_SMD:C_0603",
			props: {},
			placement: { x: 35, y: 25, rot: 0, side: "B" },
		},
	];
}

function makePin(partId, pin) {
	return { partId, pin };
}

function createSampleNets() {
	return [
		{
			id: "net_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
			name: "Net-(R1-Pad1)",
			pins: [makePin(PART_1_ID, "1"), makePin(PART_2_ID, "2")],
		},
		{
			id: "net_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
			name: "+3V3",
			pins: [makePin(PART_1_ID, "2")],
		},
	];
}

function createSampleIr() {
	return {
		schemaVersion: 1,
		name: "TestBoard",
		parts: createSampleParts(),
		nets: createSampleNets(),
		constraints: [],
	};
}

const SAMPLE_SES_TEXT = `(session test_board
	(routes
		(resolution um 10)
		(library_out
			(padstack "Via[T]Pad_600x600_um"
				(shape (circle F.Cu 600))
			)
		)
		(network_out
			(net GND
				(wire
					(path F.Cu 250 10000 20000 30000 20000)
					(type route)
				)
				(via "Via[T]Pad_600x600_um" 30000 20000)
			)
			(net +3V3
				(wire
					(path B.Cu 200 40000 50000 40000 60000 50000 60000)
					(type route)
				)
			)
		)
	)
)`;

const QUOTED_SES_TEXT = `(session test_board
	(routes
		(network_out
			(net "Net-(R1-Pad1)"
				(wire (path F.Cu 250 10000 20000 30000 20000) (type route))
				(via "Via[T]Pad_600x600_um" 30000 20000)
			)
			(net "Motor Drive Net"
				(wire (path B.Cu 200 40000 50000 40000 60000) (type route))
			)
		)
	)
)`;

const SAMPLE_COMPONENT_NAMES = ["Resistor SMD:R 0805", "Capacitor_SMD:C_0603"];

const EXPECTED_PADSTACK_NAMES = [
	"Rect[T]Pad_1200x1400_um",
	"Rect[T]Pad_800x900_um",
];

const EXPECTED_NET_NAMES = ["Net-(R1-Pad1)", "+3V3"];

const EXPECTED_BOUNDARY_PATH = [
	{ sym: "path" },
	{ sym: "pcb" },
	0,
	0,
	0,
	100000,
	0,
	100000,
	80000,
	0,
	80000,
	0,
	0,
];

const EXPECTED_RULE = [
	{ sym: "rule" },
	[{ sym: "width" }, 300],
	[{ sym: "clearance" }, 250],
];

const EXPECTED_PLACES = [
	[{ sym: "place" }, "R1", 20000, 15000, { sym: "front" }, 90],
	[{ sym: "place" }, "C1", 35000, 25000, { sym: "back" }, 0],
];

const EXPECTED_FIXTURE_RESULT = {
	wires: [
		{
			net: "GND",
			layer: "F.Cu",
			widthMm: 0.25,
			points: [
				[10, 20],
				[30, 20],
			],
		},
		{
			net: "+3V3",
			layer: "B.Cu",
			widthMm: 0.2,
			points: [
				[40, 50],
				[40, 60],
				[50, 60],
			],
		},
	],
	vias: [{ net: "GND", x: 30, y: 20 }],
};

function nodeMatchesTag(firstItem, tag) {
	return firstItem?.sym === tag || firstItem === tag;
}

function hasTag(node, tag) {
	if (!Array.isArray(node)) return false;
	return nodeMatchesTag(node[0], tag);
}

function findAllSexprNodes(node, tag, acc = []) {
	if (!Array.isArray(node)) return acc;
	if (hasTag(node, tag)) acc.push(node);
	for (const child of node) {
		findAllSexprNodes(child, tag, acc);
	}
	return acc;
}

function findSexprNode(node, tag) {
	return findAllSexprNodes(node, tag)[0] ?? null;
}

function requireSexprNode(node, tag) {
	const found = findSexprNode(node, tag);
	assert.ok(found);
	return found;
}

function assertNamedNodes(nodes, expectedNames) {
	assert.equal(nodes.length, expectedNames.length);
	for (const name of expectedNames) {
		assert.ok(nodes.some((node) => node[1] === name));
	}
}

function assertWireAndViaCounts(result, wireCount, viaCount) {
	assert.equal(result.wires.length, wireCount);
	assert.equal(result.vias.length, viaCount);
}

function assertBoundaryAndRules(ast) {
	const hostCad = requireSexprNode(ast, "host_cad");
	assert.equal(hostCad[1], "banana");

	const boundary = requireSexprNode(ast, "boundary");
	assert.deepEqual(boundary[1], EXPECTED_BOUNDARY_PATH);

	const rule = requireSexprNode(ast, "rule");
	assert.deepEqual(rule, EXPECTED_RULE);
}

function assertPlacement(ast) {
	const placement = requireSexprNode(ast, "placement");
	const components = findAllSexprNodes(placement, "component");
	assertNamedNodes(components, SAMPLE_COMPONENT_NAMES);

	const places = findAllSexprNodes(placement, "place");
	assert.deepEqual(places, EXPECTED_PLACES);
}

function assertLibrary(ast) {
	const library = requireSexprNode(ast, "library");
	const images = findAllSexprNodes(library, "image");
	assertNamedNodes(images, SAMPLE_COMPONENT_NAMES);

	const padstacks = findAllSexprNodes(library, "padstack");
	assertNamedNodes(padstacks, EXPECTED_PADSTACK_NAMES);
}

function assertNets(ast) {
	const network = requireSexprNode(ast, "network");
	const nets = findAllSexprNodes(network, "net");
	assert.deepEqual(
		nets.map((n) => n[1]),
		EXPECTED_NET_NAMES,
	);

	const gndPins = requireSexprNode(nets[0], "pins");
	assert.deepEqual(gndPins.slice(1), ["R1-1", "C1-2"]);

	const vccPins = requireSexprNode(nets[1], "pins");
	assert.deepEqual(vccPins.slice(1), ["R1-2"]);
}

function makeFakeExec(tmpDir, calls) {
	return (file, args, options, callback) => {
		calls.push({ file, args, options });
		fs.writeFileSync(path.join(tmpDir, "out.ses"), SAMPLE_SES_TEXT, "utf8");
		callback(null, "success", "");
	};
}

function verifyExecCall(call, { javaPath, jarPath, tmpDir }) {
	assert.equal(call.file, javaPath);
	assert.deepEqual(call.args, [
		"-jar",
		jarPath,
		"-de",
		path.join(tmpDir, "in.dsn"),
		"-do",
		path.join(tmpDir, "out.ses"),
		"-mp",
		"20",
	]);
	assert.deepEqual(call.options, { timeout: 150000 });
}

async function withTempDir(prefix, fn) {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	try {
		return await fn(tmpDir);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

const WORK_DIR_REJECT_CASES = [
	{
		name: "route rejects relative workDir",
		getWorkDir: () => "relative/path",
		expectedError: /workDir must be an absolute path/,
	},
	{
		name: "route rejects workDir with .. segments",
		getWorkDir: () => `${os.tmpdir()}${path.sep}..${path.sep}b`,
		expectedError: /workDir must not contain '\.\.' segments/,
	},
	{
		name: "route rejects non-existent workDir",
		getWorkDir: () => path.join(os.tmpdir(), `non-existent-${Date.now()}`),
		expectedError: /workDir does not exist/,
	},
];

describe("irToDsn", () => {
	test("generates valid DSN S-expression with all sections, um units and quoted names", () => {
		const ir = createSampleIr();
		const dsnText = irToDsn(ir, {
			boardW: 100,
			boardH: 80,
			footprints: SAMPLE_FOOTPRINTS,
			rules: { traceWidthMm: 0.3, clearanceMm: 0.25 },
		});
		const ast = parse(dsnText);
		assert.ok(ast);
		assert.equal(ast[0]?.sym, "pcb");
		assertBoundaryAndRules(ast);
		assertPlacement(ast);
		assertLibrary(ast);
		assertNets(ast);
		assert.ok(findSexprNode(ast, "wiring"));
	});
});

describe("parseSes", () => {
	test("parses fixture SES text with wires and vias converting um to mm", () => {
		const result = parseSes(SAMPLE_SES_TEXT);
		assert.deepEqual(result, EXPECTED_FIXTURE_RESULT);
	});

	test("handles quoted net names and names with spaces and parens", () => {
		const result = parseSes(QUOTED_SES_TEXT);
		assertWireAndViaCounts(result, 2, 1);
		assert.deepEqual(
			result.wires.map((w) => w.net),
			["Net-(R1-Pad1)", "Motor Drive Net"],
		);
		assert.equal(result.vias[0].net, "Net-(R1-Pad1)");
	});

	test("ignores unknown nodes without crashing and handles empty input", () => {
		const emptyResult = { wires: [], vias: [] };
		for (const input of ["", "(unknown (node 123) (other (deep)))"]) {
			assert.deepEqual(parseSes(input), emptyResult);
		}
	});
});

describe("createFreerouting", () => {
	test("available() returns false when jarPath is unset and true when set", () => {
		const routerWithoutJar = createFreerouting({ jarPath: undefined });
		assert.equal(routerWithoutJar.available(), false);
		const routerWithJar = createFreerouting({
			jarPath: "/opt/freerouting.jar",
		});
		assert.equal(routerWithJar.available(), true);
	});

	for (const { name, getWorkDir, expectedError } of WORK_DIR_REJECT_CASES) {
		test(name, async () => {
			const router = createFreerouting({ jarPath: "/opt/freerouting.jar" });
			await assert.rejects(
				() => router.route({ dsnText: "(pcb test)", workDir: getWorkDir() }),
				expectedError,
			);
		});
	}

	test("route writes in.dsn, calls execFileFn with exact arguments, and parses out.ses", async () => {
		const calls = [];
		const jarPath = "C:\\tools\\freerouting.jar";
		const javaPath = "C:\\tools\\java.exe";

		await withTempDir("freerouting-test-", async (tmpDir) => {
			const router = createFreerouting({
				jarPath,
				javaPath,
				execFileFn: makeFakeExec(tmpDir, calls),
				timeoutMs: 150000,
			});
			const result = await router.route({
				dsnText: "(pcb Test)",
				workDir: tmpDir,
			});
			assert.equal(
				fs.readFileSync(path.join(tmpDir, "in.dsn"), "utf8"),
				"(pcb Test)",
			);
			assert.equal(calls.length, 1);
			verifyExecCall(calls[0], { javaPath, jarPath, tmpDir });
			assertWireAndViaCounts(result, 2, 1);
		});
	});

	test("route surfaces exec failure without logging file contents", async () => {
		const fakeFailingExec = (_file, _args, _options, callback) => {
			callback(new Error("Java process crashed with exit code 1"), "", "Crash");
		};

		await withTempDir("freerouting-fail-", async (tmpDir) => {
			const router = createFreerouting({
				jarPath: "/opt/freerouting.jar",
				execFileFn: fakeFailingExec,
			});
			await assert.rejects(
				() =>
					router.route({
						dsnText: "(secret-sensitive-dsn-data)",
						workDir: tmpDir,
					}),
				(err) => {
					assert.match(err.message, /Freerouting execution failed/);
					assert.ok(!err.message.includes("secret-sensitive-dsn-data"));
					return true;
				},
			);
		});
	});
});
