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

describe("checkFootprintDelta", () => {
	test("returns ADDED delta when base footprint is missing", () => {
		const targetFp = {
			value: { text: "10k" },
			layer: "F.Cu",
			at: { x: 12.5, y: 25.0, rotation: 90 },
		};
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
		const fp = {
			value: { text: "100nF" },
			layer: "B.Cu",
			at: { x: 5.0, y: 10.0, rotation: 0 },
		};
		const identical = checkFootprintDelta("C1", fp, fp);
		assert.equal(identical, null);

		const tinyShift = {
			value: { text: "100nF" },
			layer: "B.Cu",
			at: { x: 5.0005, y: 10.0, rotation: 0.005 },
		};
		const belowThreshold = checkFootprintDelta("C1", tinyShift, fp);
		assert.equal(belowThreshold, null);
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
			const targetFp = {
				value: { text: tc.tVal },
				layer: "F.Cu",
				at: tc.targetAt,
			};
			const baseFp = { value: { text: tc.bVal }, layer: "F.Cu", at: tc.baseAt };
			const delta = checkFootprintDelta("R1", targetFp, baseFp);

			assert.ok(delta);
			assert.equal(delta.action, "CHANGED");
			assert.equal(delta.refDes, "R1");
			assert.equal(delta.valChanged, tc.expectedValChanged);
			assert.ok(Math.abs(delta.dist - tc.expectedDist) < 1e-6);
		});
	}

	test("handles empty or missing footprint fields gracefully", () => {
		const minimalTarget = {};
		const delta = checkFootprintDelta("U1", minimalTarget, null);
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
		const baseBoard = {
			footprints: [
				{
					reference: { text: "R1" },
					value: { text: "10k" },
					at: { x: 0, y: 0 },
				},
				{
					reference: { text: "C1" },
					value: { text: "100nF" },
					at: { x: 10, y: 10 },
				},
				{
					reference: { text: "D1" },
					value: { text: "Red" },
					at: { x: 20, y: 20 },
				},
			],
		};
		const targetBoard = {
			footprints: [
				{
					reference: { text: "R1" },
					value: { text: "10k" },
					at: { x: 0, y: 0 },
				},
				{
					reference: { text: "C1" },
					value: { text: "100nF" },
					at: { x: 15, y: 10 },
				},
				{
					reference: { text: "U1" },
					value: { text: "ATmega" },
					at: { x: 30, y: 30 },
				},
			],
		};

		const changes = computeFootprintChanges(baseBoard, targetBoard);
		assert.equal(changes instanceof Map, true);
		assert.equal(changes.size, 3);
		assert.equal(changes.get("C1")?.action, "CHANGED");
		assert.equal(changes.get("U1")?.action, "ADDED");
		assert.equal(changes.get("D1")?.action, "DELETED");
		assert.equal(changes.has("R1"), false);
	});

	test("returns empty Map when baseBoard or targetBoard is missing or invalid", () => {
		const validBoard = { footprints: [] };
		assert.equal(computeFootprintChanges(null, validBoard).size, 0);
		assert.equal(computeFootprintChanges(validBoard, null).size, 0);
		assert.equal(computeFootprintChanges(null, null).size, 0);
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
				pads: [
					{
						number: "1",
						net: "GND",
						absAt: { x: 10.5, y: 20.0 },
						size: { w: 1.2, h: 0.8 },
						layers: ["F.Cu"],
					},
					{
						number: "2",
						net: "+3V3",
						absAt: { x: 12.5, y: 20.0 },
						size: { w: 1.2, h: 0.8 },
						layers: ["F.Cu"],
					},
				],
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
		assert.deepEqual(extractPadsFromFootprints(), []);
		assert.deepEqual(extractPadsFromFootprints([]), []);
	});

	test("applies safe defaults when pad fields or references are omitted", () => {
		const footprints = [{ pads: [{}] }];
		const pads = extractPadsFromFootprints(footprints);
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
		assert.equal(tryParseBoard(null), null);
		assert.equal(tryParseBoard(""), null);
		assert.equal(
			tryParseBoard(path.join(tempDir, "non-existent.kicad_pcb")),
			null,
		);
	});

	test("returns null and catches error when file contains invalid PCB AST", () => {
		const invalidFile = path.join(tempDir, "corrupt.kicad_pcb");
		fs.writeFileSync(invalidFile, "(not_kicad_pcb (unclosed", "utf8");

		const parsed = tryParseBoard(invalidFile);
		assert.equal(parsed, null);
	});

	test("parses a valid KiCad PCB file into board AST representation", () => {
		const validFile = path.join(tempDir, "valid.kicad_pcb");
		const content = `(kicad_pcb
  (version 20240108)
  (generator pcbnew)
  (net 0 "")
  (net 1 "GND")
  (footprint "R_0805" (layer "F.Cu")
    (at 10 20 0)
    (property "Reference" "R1")
    (property "Value" "10k")
    (pad "1" smd rect (at 0 0 0) (size 1 1) (layers "F.Cu") (net 1 "GND"))
  )
  (segment (start 0 0) (end 5 5) (width 0.25) (layer "F.Cu") (net 1))
)`;
		fs.writeFileSync(validFile, content, "utf8");

		const board = tryParseBoard(validFile);
		assert.ok(board);
		assert.equal(board.footprints.length, 1);
		assert.equal(board.footprints[0].reference.text, "R1");
		assert.equal(board.footprints[0].value.text, "10k");
		assert.equal(board.tracks.length, 1);
		assert.equal(board.nets.get(1), "GND");
	});
});

describe("extractPcbMetadata", () => {
	test("returns null when isPcb is false or target file cannot be parsed", () => {
		assert.equal(extractPcbMetadata("base.pcb", "target.pcb", false), null);
		assert.equal(
			extractPcbMetadata(null, path.join(tempDir, "missing.kicad_pcb"), true),
			null,
		);
	});

	test("extracts comprehensive PCB metadata and footprint deltas between boards", () => {
		const baseFile = path.join(tempDir, "meta-base.kicad_pcb");
		const targetFile = path.join(tempDir, "meta-target.kicad_pcb");

		const baseContent = `(kicad_pcb
  (version 20240108)
  (generator pcbnew)
  (net 0 "")
  (net 1 "GND")
  (footprint "R_0805" (layer "F.Cu")
    (at 10 20 0)
    (property "Reference" "R1")
    (property "Value" "10k")
  )
)`;
		const targetContent = `(kicad_pcb
  (version 20240108)
  (generator pcbnew)
  (net 0 "")
  (net 1 "GND")
  (footprint "R_0805" (layer "F.Cu")
    (at 15 20 0)
    (property "Reference" "R1")
    (property "Value" "10k")
    (pad "1" smd rect (at 0 0 0) (size 1 1) (layers "F.Cu") (net 1 "GND"))
  )
  (segment (start 0 0) (end 10 0) (width 0.2) (layer "F.Cu") (net 1))
)`;
		fs.writeFileSync(baseFile, baseContent, "utf8");
		fs.writeFileSync(targetFile, targetContent, "utf8");

		const metadata = extractPcbMetadata(baseFile, targetFile, true);
		assert.ok(metadata);
		assert.equal(metadata.footprints.length, 1);
		assert.equal(metadata.footprints[0].ref, "R1");
		assert.equal(metadata.footprints[0].x, 15);
		assert.equal(metadata.pads.length, 1);
		assert.equal(metadata.pads[0].refDes, "R1");
		assert.equal(metadata.segments.length, 1);
		assert.equal(metadata.segments[0].width, 0.2);
		assert.equal(metadata.nets.includes("GND"), true);
		assert.equal(metadata.footprintChanges.get("R1")?.action, "CHANGED");
	});

	test("extracts metadata when base board is omitted (new target board)", () => {
		const targetFile = path.join(tempDir, "meta-target-only.kicad_pcb");
		const targetContent = `(kicad_pcb
  (version 20240108)
  (generator pcbnew)
  (net 0 "")
  (footprint "C_0603" (layer "B.Cu")
    (at 30 40 0)
    (property "Reference" "C1")
    (property "Value" "22uF")
  )
)`;
		fs.writeFileSync(targetFile, targetContent, "utf8");

		const metadata = extractPcbMetadata(null, targetFile, true);
		assert.ok(metadata);
		assert.equal(metadata.footprints.length, 1);
		assert.equal(metadata.footprints[0].ref, "C1");
		assert.equal(metadata.footprintChanges.size, 0);
	});
});
