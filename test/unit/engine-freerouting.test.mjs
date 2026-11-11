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

const SAMPLE_FOOTPRINTS = {
	"Resistor SMD:R 0805": {
		pads: [
			{ number: "1", at: [-1.0, 0], size: [1.2, 1.4] },
			{ number: "2", at: [1.0, 0], size: [1.2, 1.4] },
		],
	},
	"Capacitor_SMD:C_0603": {
		pads: [
			{ number: "1", at: [-0.75, 0], size: [0.8, 0.9] },
			{ number: "2", at: [0.75, 0], size: [0.8, 0.9] },
		],
	},
};

function createSampleParts() {
	return [
		{
			id: "part_11111111-1111-1111-1111-111111111111",
			ref: "R1",
			value: "10k",
			symbol: "Device:R",
			footprint: "Resistor SMD:R 0805",
			props: {},
			placement: { x: 20, y: 15, rot: 90, side: "F" },
		},
		{
			id: "part_22222222-2222-2222-2222-222222222222",
			ref: "C1",
			value: "100n",
			symbol: "Device:C",
			footprint: "Capacitor_SMD:C_0603",
			props: {},
			placement: { x: 35, y: 25, rot: 0, side: "B" },
		},
	];
}

function createSampleNets() {
	return [
		{
			id: "net_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
			name: "Net-(R1-Pad1)",
			pins: [
				{
					partId: "part_11111111-1111-1111-1111-111111111111",
					pin: "1",
				},
				{
					partId: "part_22222222-2222-2222-2222-222222222222",
					pin: "2",
				},
			],
		},
		{
			id: "net_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
			name: "+3V3",
			pins: [
				{
					partId: "part_11111111-1111-1111-1111-111111111111",
					pin: "2",
				},
			],
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

function findSexprNode(node, tag) {
	if (!Array.isArray(node)) return null;
	if (node[0]?.sym === tag || node[0] === tag) return node;
	for (const child of node) {
		const found = findSexprNode(child, tag);
		if (found) return found;
	}
	return null;
}

function findAllSexprNodes(node, tag, acc = []) {
	if (!Array.isArray(node)) return acc;
	if (node[0]?.sym === tag || node[0] === tag) acc.push(node);
	for (const child of node) {
		findAllSexprNodes(child, tag, acc);
	}
	return acc;
}

function assertBoundaryAndRules(ast) {
	const hostCad = findSexprNode(ast, "host_cad");
	assert.ok(hostCad);
	assert.equal(hostCad[1], "banana");

	const boundary = findSexprNode(ast, "boundary");
	assert.ok(boundary);
	assert.deepEqual(boundary[1], [
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
	]);

	const rule = findSexprNode(ast, "rule");
	assert.ok(rule);
	assert.deepEqual(rule[1], [{ sym: "width" }, 300]);
	assert.deepEqual(rule[2], [{ sym: "clearance" }, 250]);
}

function assertPlacement(ast) {
	const placement = findSexprNode(ast, "placement");
	assert.ok(placement);
	const components = findAllSexprNodes(placement, "component");
	assert.equal(components.length, 2);
	assert.ok(components.some((c) => c[1] === "Resistor SMD:R 0805"));
	assert.ok(components.some((c) => c[1] === "Capacitor_SMD:C_0603"));
	const places = findAllSexprNodes(placement, "place");
	assert.equal(places.length, 2);
	assert.deepEqual(places[0], [
		{ sym: "place" },
		"R1",
		20000,
		15000,
		{ sym: "front" },
		90,
	]);
	assert.deepEqual(places[1], [
		{ sym: "place" },
		"C1",
		35000,
		25000,
		{ sym: "back" },
		0,
	]);
}

function assertLibrary(ast) {
	const library = findSexprNode(ast, "library");
	assert.ok(library);
	const images = findAllSexprNodes(library, "image");
	assert.equal(images.length, 2);
	assert.ok(images.some((img) => img[1] === "Resistor SMD:R 0805"));
	assert.ok(images.some((img) => img[1] === "Capacitor_SMD:C_0603"));

	const padstacks = findAllSexprNodes(library, "padstack");
	assert.equal(padstacks.length, 2);
	assert.ok(padstacks.some((p) => p[1] === "Rect[T]Pad_1200x1400_um"));
	assert.ok(padstacks.some((p) => p[1] === "Rect[T]Pad_800x900_um"));
}

function assertNets(ast) {
	const network = findSexprNode(ast, "network");
	assert.ok(network);
	const nets = findAllSexprNodes(network, "net");
	assert.equal(nets.length, 2);
	assert.equal(nets[0][1], "Net-(R1-Pad1)");
	assert.equal(nets[1][1], "+3V3");

	const gndPins = findSexprNode(nets[0], "pins");
	assert.deepEqual(gndPins.slice(1), ["R1-1", "C1-2"]);

	const vccPins = findSexprNode(nets[1], "pins");
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
		assert.deepEqual(result, {
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
		});
	});

	test("handles quoted net names and names with spaces and parens", () => {
		const quotedSes = `(session test_board
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
		const result = parseSes(quotedSes);
		assert.equal(result.wires.length, 2);
		assert.equal(result.wires[0].net, "Net-(R1-Pad1)");
		assert.equal(result.wires[1].net, "Motor Drive Net");
		assert.equal(result.vias.length, 1);
		assert.equal(result.vias[0].net, "Net-(R1-Pad1)");
	});

	test("ignores unknown nodes without crashing and handles empty input", () => {
		assert.deepEqual(parseSes(""), { wires: [], vias: [] });
		assert.deepEqual(parseSes("(unknown (node 123) (other (deep)))"), {
			wires: [],
			vias: [],
		});
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

	test("route rejects relative workDir", async () => {
		const router = createFreerouting({ jarPath: "/opt/freerouting.jar" });
		await assert.rejects(
			() => router.route({ dsnText: "(pcb test)", workDir: "relative/path" }),
			/workDir must be an absolute path/,
		);
	});

	test("route rejects workDir with .. segments", async () => {
		const router = createFreerouting({ jarPath: "/opt/freerouting.jar" });
		const invalidPath = `${os.tmpdir()}${path.sep}..${path.sep}b`;
		await assert.rejects(
			() => router.route({ dsnText: "(pcb test)", workDir: invalidPath }),
			/workDir must not contain '\.\.' segments/,
		);
	});

	test("route rejects non-existent workDir", async () => {
		const router = createFreerouting({ jarPath: "/opt/freerouting.jar" });
		const nonExistent = path.join(os.tmpdir(), `non-existent-${Date.now()}`);
		await assert.rejects(
			() => router.route({ dsnText: "(pcb test)", workDir: nonExistent }),
			/workDir does not exist/,
		);
	});

	test("route writes in.dsn, calls execFileFn with exact arguments, and parses out.ses", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "freerouting-test-"));
		const calls = [];
		const jarPath = "C:\\tools\\freerouting.jar";
		const javaPath = "C:\\tools\\java.exe";
		const fakeExec = makeFakeExec(tmpDir, calls);

		try {
			const router = createFreerouting({
				jarPath,
				javaPath,
				execFileFn: fakeExec,
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
			assert.equal(result.wires.length, 2);
			assert.equal(result.vias.length, 1);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("route surfaces exec failure without logging file contents", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "freerouting-fail-"));
		const fakeFailingExec = (_file, _args, _options, callback) => {
			callback(new Error("Java process crashed with exit code 1"), "", "Crash");
		};

		try {
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
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
