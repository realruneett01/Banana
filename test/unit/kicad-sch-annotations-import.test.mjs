import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateCircuitIR } from "../../backend/src/engine/circuit-ir.js";
import { kicadSchToIr } from "../../backend/src/engine/kicad-sch-to-ir.js";

function makeIdCounter() {
	let count = 0;
	return (kind) => {
		count++;
		return `${kind}-${count}`;
	};
}

function buildSchematic(body = "") {
	return `(kicad_sch\n\t(version 20231120)${body ? `\n${body}` : ""}\n)`;
}

function makeTextAnnotation(index, kind, [x, y, rot], [text, uuid]) {
	return {
		id: `annotation-${index}`,
		kind,
		x,
		y,
		rot,
		text,
		uuid,
	};
}

function makePointAnnotation(index, kind, [x, y], uuid) {
	return {
		id: `annotation-${index}`,
		kind,
		x,
		y,
		uuid,
	};
}

function makeSegmentAnnotation(index, kind, [x, y, x2, y2], uuid) {
	return {
		id: `annotation-${index}`,
		kind,
		x,
		y,
		x2,
		y2,
		uuid,
	};
}

const ALL_KINDS_SCHEMATIC = buildSchematic(`\t(generator "banana")
\t(uuid "00000000-0000-0000-0000-000000000000")
\t(paper "A4")
\t(label "NET_LOC" (at 10 20 90) (effects (font (size 1.27 1.27))) (uuid "uuid-label-1"))
\t(global_label "NET_GLOB" (shape input) (at 30 40 180) (effects (font (size 1.27 1.27))) (uuid "uuid-glabel-1"))
\t(hierarchical_label "NET_HIER" (shape input) (at 50 60 270) (effects (font (size 1.27 1.27))) (uuid "uuid-hlabel-1"))
\t(no_connect (at 70 80) (uuid "uuid-nc-1"))
\t(junction (at 90 100) (diameter 0) (color 0 0 0 0) (uuid "uuid-junc-1"))
\t(text "Notes" (at 110 120 0) (effects (font (size 1.27 1.27))) (uuid "uuid-text-1"))
\t(polyline (pts (xy 10 10) (xy 20 20)) (stroke (width 0) (type default)) (uuid "uuid-line-1"))
\t(polyline (pts (xy 1 1) (xy 2 2) (xy 3 3)) (stroke (width 0) (type default)) (uuid "uuid-line-skip"))
\t(bus (pts (xy 30 30) (xy 40 40) (xy 50 50)) (stroke (width 0) (type default)) (uuid "uuid-bus-1"))`);

const EXPECTED_ANNOTATIONS = [
	makeTextAnnotation(1, "label", [10, 20, 90], ["NET_LOC", "uuid-label-1"]),
	makeTextAnnotation(
		2,
		"globalLabel",
		[30, 40, 180],
		["NET_GLOB", "uuid-glabel-1"],
	),
	makeTextAnnotation(
		3,
		"hierLabel",
		[50, 60, 270],
		["NET_HIER", "uuid-hlabel-1"],
	),
	makePointAnnotation(4, "noConnect", [70, 80], "uuid-nc-1"),
	makePointAnnotation(5, "junction", [90, 100], "uuid-junc-1"),
	makeTextAnnotation(6, "text", [110, 120, 0], ["Notes", "uuid-text-1"]),
	makeSegmentAnnotation(7, "line", [10, 10, 20, 20], "uuid-line-1"),
	makeSegmentAnnotation(8, "bus", [30, 30, 40, 40], "uuid-bus-1"),
	makeSegmentAnnotation(9, "bus", [40, 40, 50, 50], "uuid-bus-1"),
];

function buildBaseIr(annotations) {
	return {
		schemaVersion: 1,
		name: "test-circuit",
		parts: [],
		nets: [],
		constraints: [],
		annotations,
	};
}

function assertCircuitIrValid(annotations) {
	const res = validateCircuitIR(buildBaseIr(annotations));
	assert.deepEqual(
		{ ok: res.ok, errors: res.errors },
		{ ok: true, errors: [] },
	);
}

function assertAnnotationsImport(
	schematic,
	expectedAnnotations,
	useIdCounter = false,
) {
	const res = kicadSchToIr(
		schematic,
		useIdCounter ? { idFn: makeIdCounter() } : undefined,
	);
	assert.deepEqual(
		{ ok: res.ok, annotations: res.ir.annotations },
		{ ok: true, annotations: expectedAnnotations },
	);
}

const EXTRACTION_TEST_CASES = [
	{
		name: "extracts all 8 annotation kinds from schematic",
		schematic: ALL_KINDS_SCHEMATIC,
		useIdCounter: true,
		expected: EXPECTED_ANNOTATIONS,
	},
	{
		name: "empty schematic outputs empty annotations array",
		schematic: buildSchematic('\t(generator "banana")'),
		useIdCounter: false,
		expected: [],
	},
	{
		name: "omits optional fields when missing from schematic",
		schematic: buildSchematic(
			'\t(label "SIG" (at 15 25))\n\t(junction (at 35 45))',
		),
		useIdCounter: true,
		expected: [
			{ id: "annotation-1", kind: "label", x: 15, y: 25, text: "SIG" },
			{ id: "annotation-2", kind: "junction", x: 35, y: 45 },
		],
	},
];

describe("validateCircuitIR annotations validation", () => {
	test("accepts an IR with valid annotations", () => {
		assertCircuitIrValid([
			{ id: "ann-1", kind: "label", x: 10, y: 20, text: "CLK" },
			{ id: "ann-2", kind: "junction", x: 30, y: 40 },
			{ id: "ann-3", kind: "line", x: 0, y: 0, x2: 10, y2: 10 },
		]);
	});

	test("rejects an annotation with an unknown kind", () => {
		const res = validateCircuitIR(
			buildBaseIr([{ id: "ann-1", kind: "invalid_kind", x: 10, y: 20 }]),
		);
		assert.equal(res.ok, false);
		assert.ok(
			res.errors.some((err) => err.includes("must be one of")),
			`expected enum validation error, got: ${JSON.stringify(res.errors)}`,
		);
	});
});

describe("kicadSchToIr annotations extraction", () => {
	for (const tc of EXTRACTION_TEST_CASES) {
		test(tc.name, () => {
			assertAnnotationsImport(tc.schematic, tc.expected, tc.useIdCounter);
		});
	}
});
