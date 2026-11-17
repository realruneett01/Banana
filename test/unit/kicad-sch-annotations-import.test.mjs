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

const ALL_KINDS_SCHEMATIC = `(kicad_sch
	(version 20231120)
	(generator "banana")
	(uuid "00000000-0000-0000-0000-000000000000")
	(paper "A4")
	(label "NET_LOC" (at 10 20 90) (effects (font (size 1.27 1.27))) (uuid "uuid-label-1"))
	(global_label "NET_GLOB" (shape input) (at 30 40 180) (effects (font (size 1.27 1.27))) (uuid "uuid-glabel-1"))
	(hierarchical_label "NET_HIER" (shape input) (at 50 60 270) (effects (font (size 1.27 1.27))) (uuid "uuid-hlabel-1"))
	(no_connect (at 70 80) (uuid "uuid-nc-1"))
	(junction (at 90 100) (diameter 0) (color 0 0 0 0) (uuid "uuid-junc-1"))
	(text "Notes" (at 110 120 0) (effects (font (size 1.27 1.27))) (uuid "uuid-text-1"))
	(polyline (pts (xy 10 10) (xy 20 20)) (stroke (width 0) (type default)) (uuid "uuid-line-1"))
	(polyline (pts (xy 1 1) (xy 2 2) (xy 3 3)) (stroke (width 0) (type default)) (uuid "uuid-line-skip"))
	(bus (pts (xy 30 30) (xy 40 40) (xy 50 50)) (stroke (width 0) (type default)) (uuid "uuid-bus-1"))
)`;

const EXPECTED_ANNOTATIONS = [
	{
		id: "annotation-1",
		kind: "label",
		x: 10,
		y: 20,
		rot: 90,
		text: "NET_LOC",
		uuid: "uuid-label-1",
	},
	{
		id: "annotation-2",
		kind: "globalLabel",
		x: 30,
		y: 40,
		rot: 180,
		text: "NET_GLOB",
		uuid: "uuid-glabel-1",
	},
	{
		id: "annotation-3",
		kind: "hierLabel",
		x: 50,
		y: 60,
		rot: 270,
		text: "NET_HIER",
		uuid: "uuid-hlabel-1",
	},
	{
		id: "annotation-4",
		kind: "noConnect",
		x: 70,
		y: 80,
		uuid: "uuid-nc-1",
	},
	{
		id: "annotation-5",
		kind: "junction",
		x: 90,
		y: 100,
		uuid: "uuid-junc-1",
	},
	{
		id: "annotation-6",
		kind: "text",
		x: 110,
		y: 120,
		rot: 0,
		text: "Notes",
		uuid: "uuid-text-1",
	},
	{
		id: "annotation-7",
		kind: "line",
		x: 10,
		y: 10,
		x2: 20,
		y2: 20,
		uuid: "uuid-line-1",
	},
	{
		id: "annotation-8",
		kind: "bus",
		x: 30,
		y: 30,
		x2: 40,
		y2: 40,
		uuid: "uuid-bus-1",
	},
	{
		id: "annotation-9",
		kind: "bus",
		x: 40,
		y: 40,
		x2: 50,
		y2: 50,
		uuid: "uuid-bus-1",
	},
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

describe("validateCircuitIR annotations validation", () => {
	test("accepts an IR with valid annotations", () => {
		const ir = buildBaseIr([
			{ id: "ann-1", kind: "label", x: 10, y: 20, text: "CLK" },
			{ id: "ann-2", kind: "junction", x: 30, y: 40 },
			{ id: "ann-3", kind: "line", x: 0, y: 0, x2: 10, y2: 10 },
		]);
		const res = validateCircuitIR(ir);
		assert.equal(res.ok, true);
		assert.deepEqual(res.errors, []);
	});

	test("rejects an annotation with an unknown kind", () => {
		const ir = buildBaseIr([
			{ id: "ann-1", kind: "invalid_kind", x: 10, y: 20 },
		]);
		const res = validateCircuitIR(ir);
		assert.equal(res.ok, false);
		assert.ok(
			res.errors.some((err) => err.includes("must be one of")),
			`expected enum validation error, got: ${JSON.stringify(res.errors)}`,
		);
	});
});

describe("kicadSchToIr annotations extraction", () => {
	test("extracts all 8 annotation kinds from schematic", () => {
		const res = kicadSchToIr(ALL_KINDS_SCHEMATIC, { idFn: makeIdCounter() });
		assert.equal(res.ok, true);
		assert.deepEqual(res.ir.annotations, EXPECTED_ANNOTATIONS);
	});

	test("empty schematic outputs empty annotations array", () => {
		const emptySch = `(kicad_sch (version 20231120) (generator "banana"))`;
		const res = kicadSchToIr(emptySch);
		assert.equal(res.ok, true);
		assert.deepEqual(res.ir.annotations, []);
	});

	test("omits optional fields when missing from schematic", () => {
		const sch = `(kicad_sch
			(version 20231120)
			(label "SIG" (at 15 25))
			(junction (at 35 45))
		)`;
		const res = kicadSchToIr(sch, { idFn: makeIdCounter() });
		assert.equal(res.ok, true);
		assert.deepEqual(res.ir.annotations, [
			{ id: "annotation-1", kind: "label", x: 15, y: 25, text: "SIG" },
			{ id: "annotation-2", kind: "junction", x: 35, y: 45 },
		]);
	});
});
