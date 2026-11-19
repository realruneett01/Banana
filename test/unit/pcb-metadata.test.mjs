// All exports of backend/src/pcb-metadata.js are tested in-memory and AST-based without kicad-cli or network.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
	checkFootprintDelta,
	computeFootprintChanges,
	extractPadsFromFootprints,
	extractPcbMetadata,
	tryParseBoard,
} from "../../backend/src/pcb-metadata.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "banana-pcb-metadata-"));

after(() => {
	if (fs.existsSync(tempDir)) {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

function assertMatches(checks) {
	for (const [actual, expected] of checks) {
		assert.equal(actual, expected);
	}
}

function writeTempPcb(fileName, content) {
	const filePath = path.join(tempDir, fileName);
	fs.writeFileSync(filePath, content, "utf8");
	return filePath;
}

function makeFootprint(val, layer, at) {
	return {
		value: { text: val },
		layer,
		at,
	};
}

function makeBoard(specs) {
	return {
		footprints: specs.map(([ref, val, x, y]) => ({
			reference: { text: ref },
			value: { text: val },
			at: { x, y },
		})),
	};
}

function makePad(number, net, x, y = 20.0) {
	return {
		number,
		net,
		absAt: { x, y },
		size: { w: 1.2, h: 0.8 },
		layers: ["F.Cu"],
	};
}

function renderKicadPcb({
	fp = { name: "R_0805", layer: "F.Cu", at: "10 20 0", ref: "R1", val: "10k" },
	pad = null,
	segment = null,
	hasGndNet = true,
} = {}) {
	const nets = ['(net 0 "")'];
	if (hasGndNet) nets.push('(net 1 "GND")');
	const netLines = nets.map((n) => `  ${n}`).join("\n");
	const padLine = pad ? `\n    ${pad}` : "";
	const segLine = segment ? `\n  ${segment}` : "";
	return `(kicad_pcb\n  (version 20240108)\n  (generator pcbnew)\n${netLines}\n  (footprint "${fp.name}" (layer "${fp.layer}")\n    (at ${fp.at})\n    (property "Reference" "${fp.ref}")\n    (property "Value" "${fp.val}")${padLine}\n  )${segLine}\n)`;
}

describe("checkFootprintDelta", () => {
	test("returns ADDED delta when base footprint is missing", () => {
		const targetFp = makeFootprint("10k", "F.Cu", {
			x: 12.5,
			y: 25.0,
			rotation: 90,
		});
		const result = checkFootprintDelta("R1", targetFp, null);
		assert.deepEqual(result, {
			action: "ADDED",
			refDes: "R1",
			value: "10k",
			layer: "F.Cu",
			targetAt: { x: 12.5, y: 25.0, rotation: 90 },
			dist: 0,
		});
	});

	test("returns null when footprint placement and value are unchanged", () => {
		const fp = makeFootprint("100nF", "B.Cu", { x: 5.0, y: 10.0, rotation: 0 });
		const tinyShift = makeFootprint("100nF", "B.Cu", {
			x: 5.0005,
			y: 10.0,
			rotation: 0.005,
		});
		assert.equal(checkFootprintDelta("C1", fp, fp), null);
		assert.equal(checkFootprintDelta("C1", tinyShift, fp), null);
	});

	const changeCases = [
		{
			desc: "position shift beyond 0.001mm",
			targetAt: { x: 8.0, y: 14.0, rotation: 0 },
			baseAt: { x: 5.0, y: 10.0, rotation: 0 },
			tVal: "10k",
			bVal: "10k",
			expectedDist: 5.0,
			expectedValChanged: false,
		},
		{
			desc: "rotation beyond 0.01 degrees",
			targetAt: { x: 5.0, y: 10.0, rotation: 90 },
			baseAt: { x: 5.0, y: 10.0, rotation: 0 },
			tVal: "10k",
			bVal: "10k",
			expectedDist: 0.0,
			expectedValChanged: false,
		},
		{
			desc: "value text change",
			targetAt: { x: 5.0, y: 10.0, rotation: 0 },
			baseAt: { x: 5.0, y: 10.0, rotation: 0 },
			tVal: "22k",
			bVal: "10k",
			expectedDist: 0.0,
			expectedValChanged: true,
		},
	];

	for (const tc of changeCases) {
		test(`returns CHANGED for ${tc.desc}`, () => {
			const targetFp = makeFootprint(tc.tVal, "F.Cu", tc.targetAt);
			const baseFp = makeFootprint(tc.bVal, "F.Cu", tc.baseAt);
			const delta = checkFootprintDelta("R1", targetFp, baseFp);

			assert.ok(delta);
			assertMatches([
				[delta.action, "CHANGED"],
				[delta.refDes, "R1"],
				[delta.valChanged, tc.expectedValChanged],
			]);
			assert.ok(Math.abs(delta.dist - tc.expectedDist) < 1e-6);
		});
	}

	test("handles empty or missing footprint fields gracefully", () => {
		const delta = checkFootprintDelta("U1", {}, null);
		assert.deepEqual(delta, {
			action: "ADDED",
			refDes: "U1",
			value: "",
			layer: "F.Cu",
			targetAt: undefined,
			dist: 0,
		});
	});
});

describe("computeFootprintChanges", () => {
	test("computes ADDED, CHANGED, and DELETED footprints between boards", () => {
		const baseBoard = makeBoard([
			["R1", "10k", 0, 0],
			["C1", "100nF", 10, 10],
			["D1", "Red", 20, 20],
		]);
		const targetBoard = makeBoard([
			["R1", "10k", 0, 0],
			["C1", "100nF", 15, 10],
			["U1", "ATmega", 30, 30],
		]);

		const changes = computeFootprintChanges(baseBoard, targetBoard);
		assertMatches([
			[changes instanceof Map, true],
			[changes.size, 3],
			[changes.get("C1")?.action, "CHANGED"],
			[changes.get("U1")?.action, "ADDED"],
			[changes.get("D1")?.action, "DELETED"],
			[changes.has("R1"), false],
		]);
	});

	test("returns empty Map when baseBoard or targetBoard is missing or invalid", () => {
		const validBoard = { footprints: [] };
		const pairs = [
			[null, validBoard],
			[validBoard, null],
			[null, null],
		];
		for (const [base, target] of pairs) {
			assert.equal(computeFootprintChanges(base, target).size, 0);
		}
	});

	test("ignores footprints with missing or empty reference designators", () => {
		const baseBoard = {
			footprints: [
				{ reference: { text: "" }, value: { text: "test" } },
				{ value: { text: "no-ref" } },
			],
		};
		const targetBoard = {
			footprints: [{ reference: { text: "" }, value: { text: "test-target" } }],
		};
		const changes = computeFootprintChanges(baseBoard, targetBoard);
		assert.equal(changes.size, 0);
	});
});

describe("extractPadsFromFootprints", () => {
	test("extracts and maps pads from multiple footprints with board coordinates", () => {
		const footprints = [
			{
				reference: { text: "R1" },
				pads: [makePad("1", "GND", 10.5), makePad("2", "+3V3", 12.5)],
			},
		];

		const pads = extractPadsFromFootprints(footprints);
		assert.equal(pads.length, 2);
		assert.deepEqual(pads[0], {
			refDes: "R1",
			pin: "1",
			netName: "GND",
			x: 10.5,
			y: 20.0,
			width: 1.2,
			length: 0.8,
			layers: ["F.Cu"],
		});
		assert.equal(pads[1].netName, "+3V3");
	});

	test("returns empty array when footprints are empty or omitted", () => {
		for (const fps of [undefined, []]) {
			assert.deepEqual(extractPadsFromFootprints(fps), []);
		}
	});

	test("applies safe defaults when pad fields or references are omitted", () => {
		const pads = extractPadsFromFootprints([{ pads: [{}] }]);
		assert.equal(pads.length, 1);
		assert.deepEqual(pads[0], {
			refDes: "",
			pin: "",
			netName: "",
			x: 0,
			y: 0,
			width: undefined,
			length: undefined,
			layers: [],
		});
	});
});

describe("tryParseBoard", () => {
	test("returns null when filePath is missing or does not exist", () => {
		const nonExistentPath = path.join(tempDir, "non-existent.kicad_pcb");
		for (const fp of [null, "", nonExistentPath]) {
			assert.equal(tryParseBoard(fp), null);
		}
	});

	test("returns null and catches error when file contains invalid PCB AST", () => {
		const invalidFile = writeTempPcb(
			"corrupt.kicad_pcb",
			"(not_kicad_pcb (unclosed",
		);
		const parsed = tryParseBoard(invalidFile);
		assert.equal(parsed, null);
	});

	test("parses a valid KiCad PCB file into board AST representation", () => {
		const validFile = writeTempPcb(
			"valid.kicad_pcb",
			renderKicadPcb({
				pad: '(pad "1" smd rect (at 0 0 0) (size 1 1) (layers "F.Cu") (net 1 "GND"))',
				segment:
					'(segment (start 0 0) (end 5 5) (width 0.25) (layer "F.Cu") (net 1))',
			}),
		);

		const board = tryParseBoard(validFile);
		assert.ok(board);
		assertMatches([
			[board.footprints.length, 1],
			[board.footprints[0].reference.text, "R1"],
			[board.footprints[0].value.text, "10k"],
			[board.tracks.length, 1],
			[board.nets.get(1), "GND"],
		]);
	});
});

describe("extractPcbMetadata", () => {
	test("returns null when isPcb is false or target file cannot be parsed", () => {
		const missingPath = path.join(tempDir, "missing.kicad_pcb");
		const invalidCases = [
			["base.pcb", "target.pcb", false],
			[null, missingPath, true],
		];
		for (const [base, target, isPcb] of invalidCases) {
			assert.equal(extractPcbMetadata(base, target, isPcb), null);
		}
	});

	test("extracts comprehensive PCB metadata and footprint deltas between boards", () => {
		const baseFile = writeTempPcb("meta-base.kicad_pcb", renderKicadPcb());
		const targetFile = writeTempPcb(
			"meta-target.kicad_pcb",
			renderKicadPcb({
				fp: {
					name: "R_0805",
					layer: "F.Cu",
					at: "15 20 0",
					ref: "R1",
					val: "10k",
				},
				pad: '(pad "1" smd rect (at 0 0 0) (size 1 1) (layers "F.Cu") (net 1 "GND"))',
				segment:
					'(segment (start 0 0) (end 10 0) (width 0.2) (layer "F.Cu") (net 1))',
			}),
		);

		const metadata = extractPcbMetadata(baseFile, targetFile, true);
		assert.ok(metadata);
		assertMatches([
			[metadata.footprints.length, 1],
			[metadata.footprints[0].ref, "R1"],
			[metadata.footprints[0].x, 15],
			[metadata.pads.length, 1],
			[metadata.pads[0].refDes, "R1"],
			[metadata.segments.length, 1],
			[metadata.segments[0].width, 0.2],
			[metadata.nets.includes("GND"), true],
			[metadata.footprintChanges.get("R1")?.action, "CHANGED"],
		]);
	});

	test("extracts metadata when base board is omitted (new target board)", () => {
		const targetFile = writeTempPcb(
			"meta-target-only.kicad_pcb",
			renderKicadPcb({
				fp: {
					name: "C_0603",
					layer: "B.Cu",
					at: "30 40 0",
					ref: "C1",
					val: "22uF",
				},
				hasGndNet: false,
			}),
		);

		const metadata = extractPcbMetadata(null, targetFile, true);
		assert.ok(metadata);
		assertMatches([
			[metadata.footprints.length, 1],
			[metadata.footprints[0].ref, "C1"],
			[metadata.footprintChanges.size, 0],
		]);
	});
});
