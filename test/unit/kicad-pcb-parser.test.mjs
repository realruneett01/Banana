/**
 * Characterization tests for kicad-pcb-parser.js
 * All exported functions can be tested without kicad-cli or network access.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
	parseKiCadBoard,
	parsePcbMetadata,
	parsePcbNetSegments,
	parseSExpr,
	toBoardAbsolute,
} from "../../backend/src/kicad-pcb-parser.js";

function assertPartialMatch(actual, expected) {
	for (const [key, val] of Object.entries(expected)) {
		assert.deepEqual(actual[key], val);
	}
}

function assertTrackSegments(actualSegments, expectedSegments) {
	assert.equal(actualSegments.length, expectedSegments.length);
	for (const [i, expected] of expectedSegments.entries()) {
		assertPartialMatch(actualSegments[i], expected);
	}
}

function assertBoardSummary(board) {
	const checks = [
		[board.metadata.version, "20211014"],
		[board.metadata.generator, "pcbnew"],
		[board.metadata.thickness, 1.6],
		[board.metadata.titleBlock?.title, "Demo Board"],
		[board.layers.get("F.Cu")?.type, "signal"],
		[board.nets.get(1), "GND"],
		[board.netClasses.length, 1],
		[board.footprints.length, 1],
		[board.footprints[0].reference.text, "R1"],
		[board.footprints[0].pads.length, 1],
		[board.tracks.length, 1],
		[board.vias.length, 1],
		[board.zones.length, 1],
		[board.groups.length, 1],
	];
	for (const [actual, expected] of checks) {
		assert.equal(actual, expected);
	}
}

function withTempPcbFile(fileName, content, callback) {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kicad-test-"));
	const pcbPath = path.join(tmpDir, fileName);
	fs.writeFileSync(pcbPath, content, "utf8");
	try {
		return callback(pcbPath);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

const SAMPLE_NET_AST = [
	"kicad_pcb",
	["net", 0, ""],
	["net", 1, "GND"],
	["net", 2, "+3V3"],
	[
		"segment",
		["start", 10, 20],
		["end", 30, 40],
		["width", 0.25],
		["layer", "F.Cu"],
		["net", 1],
	],
	[
		"segment",
		["start", 50, 60],
		["end", 70, 80],
		["layer", "B.Cu"],
		["net", 2],
	],
];

const METADATA_CASES = [
	{
		name: "extracts netMap, segments, and footprints from KiCad PCB content",
		pcbContent: `
			(kicad_pcb (version 20211014)
				(net 0 "")
				(net 1 "GND")
				(segment (start 10.5 20.5) (end 30.5 40.5) (width 0.25) (layer "F.Cu") (net 1))
				(footprint "Resistor_SMD:R_0805" (layer "F.Cu") (at 100 200 90)
					(property "Reference" "R1" (at 0 0 0))
					(property "Value" "10k" (at 0 1 0))
				)
			)
		`,
		expectedNets: [[1, "GND"]],
		expectedSegments: [
			{
				start: { x: 10.5, y: 20.5 },
				end: { x: 30.5, y: 40.5 },
				layer: "F.Cu",
				netId: 1,
				netName: "GND",
			},
		],
		expectedFootprints: [
			{
				layer: "F.Cu",
				center: { x: 100, y: 200 },
				ref: "R1",
				value: "10k",
			},
		],
	},
	{
		name: "parses arc segments and unquoted net names with fallback naming",
		pcbContent: `
			(kicad_pcb
				(net 3 VCC_IO)
				(arc (start 12 14) (end 16 18) (layer B.Cu) (net 3))
				(segment (start 20 22) (end 24 26) (layer F.Cu) (net 42))
				(footprint "Cap:C0603" (layer B.Cu) (at 50 60)
					(property "Reference" "C1")
				)
			)
		`,
		expectedNets: [[3, "VCC_IO"]],
		expectedSegments: [
			{ netName: "VCC_IO", layer: "B.Cu" },
			{ netName: "Net-42" },
		],
		expectedFootprints: [{ ref: "C1", value: "" }],
	},
];

describe("parseSExpr", () => {
	test("parses nested S-expressions with tokens and quoted strings", () => {
		const input = '(kicad_pcb (version 20211014) (generator "pcbnew"))';
		const result = parseSExpr(input);
		assert.deepEqual(result, [
			"kicad_pcb",
			["version", "20211014"],
			["generator", "pcbnew"],
		]);
	});

	test("returns null for empty, whitespace, or invalid non-S-expression input", () => {
		const invalidInputs = ["", "   ", "\n\t", "plain text without parens"];
		for (const input of invalidInputs) {
			assert.equal(parseSExpr(input), null);
		}
	});

	test("handles escaped quotes inside strings and empty lists", () => {
		const inputEscaped = '(item "quoted \\"value\\" text")';
		assert.deepEqual(parseSExpr(inputEscaped), ["item", 'quoted "value" text']);

		const inputEmptyList = "()";
		assert.deepEqual(parseSExpr(inputEmptyList), []);
	});
});

describe("toBoardAbsolute", () => {
	test("computes board-absolute coordinates for front layer (F.Cu)", () => {
		const fp = { at: { x: 100, y: 50, rotation: 0 }, layer: "F.Cu" };
		const result = toBoardAbsolute(fp, 10, 5, 90);
		assert.equal(result.x, 110);
		assert.equal(result.y, 55);
		assert.equal(result.rotation, 90);
	});

	test("computes mirrored board-absolute coordinates for back layer (B.Cu)", () => {
		const fp = { at: { x: 100, y: 50, rotation: 90 }, layer: "B.Cu" };
		const result = toBoardAbsolute(fp, 10, 5, 45);
		assert.equal(Math.round(result.x), 105);
		assert.equal(Math.round(result.y), 40);
		assert.equal(result.rotation, 225);
	});

	test("defaults localRot to 0 when omitted", () => {
		const fp = { at: { x: 20, y: 30, rotation: 0 }, layer: "F.Cu" };
		const result = toBoardAbsolute(fp, 5, 10);
		assert.equal(result.x, 25);
		assert.equal(result.y, 40);
		assert.equal(result.rotation, 0);
	});

	test("normalizes rotation angle within [0, 360)", () => {
		const fp = { at: { x: 0, y: 0, rotation: 270 }, layer: "F.Cu" };
		const result = toBoardAbsolute(fp, 0, 0, 180);
		assert.equal(result.rotation, 90);
	});
});

describe("parsePcbNetSegments", () => {
	test("extracts net declarations and track segments with resolved net names", () => {
		const { netIndexMap, trackSegments } = parsePcbNetSegments(SAMPLE_NET_AST);
		assert.equal(netIndexMap.size, 3);
		assert.equal(netIndexMap.get(1), "GND");
		assert.equal(netIndexMap.get(2), "+3V3");
		const expectedTracks = [
			{
				start: { x: 10, y: 20 },
				end: { x: 30, y: 40 },
				netId: 1,
				netName: "GND",
				layer: "F.Cu",
			},
			{
				start: { x: 50, y: 60 },
				end: { x: 70, y: 80 },
				netId: 2,
				netName: "+3V3",
				layer: "B.Cu",
			},
		];
		assertTrackSegments(trackSegments, expectedTracks);
	});

	test("returns empty netIndexMap and trackSegments for empty AST", () => {
		const { netIndexMap, trackSegments } = parsePcbNetSegments([]);
		assert.equal(netIndexMap.size, 0);
		assert.equal(trackSegments.length, 0);
	});

	test("labels unmapped net ids as unconnected and ignores segments without endpoints", () => {
		const ast = [
			"kicad_pcb",
			["segment", ["start", 1, 2], ["end", 3, 4], ["net", 99]],
			["segment", ["start", 5, 6]],
		];
		const { trackSegments } = parsePcbNetSegments(ast);
		assertTrackSegments(trackSegments, [
			{
				netName: "unconnected",
				layer: "F.Cu",
			},
		]);
	});
});

describe("parsePcbMetadata", () => {
	for (const tc of METADATA_CASES) {
		test(tc.name, () => {
			const { netMap, segments, footprints } = parsePcbMetadata(tc.pcbContent);
			for (const [netId, netName] of tc.expectedNets) {
				assert.equal(netMap.get(netId), netName);
			}
			assert.equal(segments.length, tc.expectedSegments.length);
			for (const [i, expSeg] of tc.expectedSegments.entries()) {
				assertPartialMatch(segments[i], expSeg);
			}
			assert.equal(footprints.length, tc.expectedFootprints.length);
			for (const [i, expFp] of tc.expectedFootprints.entries()) {
				assertPartialMatch(footprints[i], expFp);
			}
		});
	}

	test("returns empty collections for null, undefined, or non-string input", () => {
		const falsyInputs = [null, undefined, "", 123, {}];
		for (const input of falsyInputs) {
			const res = parsePcbMetadata(input);
			assert.equal(res.netMap.size, 0);
			assert.equal(res.segments.length, 0);
			assert.equal(res.footprints.length, 0);
		}
	});
});

describe("parseKiCadBoard", () => {
	const sampleBoardText = `(kicad_pcb (version 20211014) (generator pcbnew) (generator_version "6.0")
		(general (thickness 1.6))
		(paper "A4")
		(title_block (title "Demo Board") (date "2026-01-01") (rev "1.0") (company "Test Corp") (comment 1 "Sample"))
		(layers
			(0 "F.Cu" signal)
			(31 "B.Cu" signal)
		)
		(net 0 "")
		(net 1 "GND")
		(net_class "Default" (description "Std") (clearance 0.2) (trace_width 0.25) (via_dia 0.8) (via_drill 0.4) (add_net "GND"))
		(footprint "Resistor_SMD:R_0805" (layer "F.Cu") (at 10 20 0)
			(property "Reference" "R1" (at 0 0 0))
			(property "Value" "10k" (at 0 1 0))
			(pad "1" smd roundrect (at -1 0 0) (size 1 1) (layers "F.Cu") (net 1 "GND"))
		)
		(segment (start 0 0) (end 10 10) (width 0.25) (layer "F.Cu") (net 1))
		(via (at 15 15) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
		(zone (net 1) (net_name "GND") (layers "F.Cu")
			(polygon (pts (xy 0 0) (xy 20 0) (xy 20 20) (xy 0 20)))
		)
		(group "GroupA" (uuid "u-1") (members "R1"))
	)`;

	test("parses a valid kicad_pcb file into typed board data structure", () => {
		withTempPcbFile("board.kicad_pcb", sampleBoardText, (pcbPath) => {
			const board = parseKiCadBoard(pcbPath);
			assertBoardSummary(board);
		});
	});

	test("throws error when root S-expression is not kicad_pcb", () => {
		withTempPcbFile(
			"invalid.kicad_pcb",
			"(other_root (version 1))",
			(pcbPath) => {
				assert.throws(
					() => parseKiCadBoard(pcbPath),
					/Invalid \.kicad_pcb file: root S-expression must be \(kicad_pcb \.\.\.\)/,
				);
			},
		);
	});

	test("throws error when file does not exist", () => {
		const nonexistentPath = path.join(
			os.tmpdir(),
			"nonexistent-kicad-file.kicad_pcb",
		);
		assert.throws(() => parseKiCadBoard(nonexistentPath), /ENOENT/);
	});
});
