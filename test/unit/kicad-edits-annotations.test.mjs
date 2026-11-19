import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { editsFromIrChange } from "../../frontend/src/editor/kicadEdits.js";

const ir = (annotations = []) => ({ parts: [], nets: [], annotations });

const testCase = (name, before, after, sch) => ({
	name,
	before,
	after,
	sch,
	canSaveInPlace: true,
});

const unchangedCase = (name, before = ir(), after = ir()) => ({
	name,
	before,
	after,
	sch: [],
	canSaveInPlace: false,
});

const LABEL_ANNO_KIND = {
	local: "label",
	global: "globalLabel",
	hierarchical: "hierLabel",
};

const labelCase = ([name, id, text, kind, x, y, rot]) => {
	const annoKind = LABEL_ANNO_KIND[kind];
	return testCase(
		name,
		ir(),
		ir([{ id, kind: annoKind, x, y, text, ...(rot ? { rot } : {}) }]),
		[{ op: "addLabel", net: text, x, y, ...(rot ? { rot } : {}), kind }],
	);
};

const pointCase = (name, kind, id, [x, y]) => {
	const op = `add${kind[0].toUpperCase()}${kind.slice(1)}`;
	return testCase(name, ir(), ir([{ id, kind, x, y }]), [{ op, x, y }]);
};

const segmentCase = (name, kind, id, [x, y, x2, y2]) => {
	const op = `add${kind[0].toUpperCase()}${kind.slice(1)}`;
	return testCase(name, ir(), ir([{ id, kind, x, y, x2, y2 }]), [
		{ op, x1: x, y1: y, x2, y2 },
	]);
};

const moveCase = (name, beforeAnno, delta, addOp) => {
	const afterAnno = { ...beforeAnno, ...delta };
	return testCase(name, ir([beforeAnno]), ir([afterAnno]), [
		{ op: "deleteItem", uuid: beforeAnno.uuid },
		addOp,
	]);
};

const LABEL_CASES = [
	["addLabel local without rot", "a1", "CLK", "local", 10, 20],
	["addLabel local with rot", "a2", "CLK", "local", 10, 20, 90],
	["addLabel global", "a3", "VCC", "global", 15, 25, 180],
	["addLabel hierarchical", "a4", "DATA_TX", "hierarchical", 30, 40],
].map(labelCase);

const CASES = [
	...LABEL_CASES,
	pointCase("addNoConnect", "noConnect", "a5", [50, 60]),
	pointCase("addJunction", "junction", "a6", [70, 80]),
	testCase(
		"addText with rot",
		ir(),
		ir([{ id: "a7", kind: "text", text: "Rev A", x: 12, y: 34, rot: 270 }]),
		[{ op: "addText", text: "Rev A", x: 12, y: 34, rot: 270 }],
	),
	segmentCase("addLine", "line", "a8", [1, 2, 3, 4]),
	segmentCase("addBus", "bus", "a9", [5, 6, 7, 8]),
	testCase(
		"remove annotation with uuid emits deleteItem",
		ir([{ id: "a10", kind: "junction", x: 10, y: 20, uuid: "u-junc-1" }]),
		ir(),
		[{ op: "deleteItem", uuid: "u-junc-1" }],
	),
	unchangedCase(
		"remove annotation without uuid emits no deleteItem",
		ir([{ id: "a11", kind: "junction", x: 10, y: 20 }]),
	),
	moveCase(
		"move annotation with uuid emits deleteItem then add op",
		{ id: "a12", kind: "label", x: 10, y: 20, text: "SIG", uuid: "u-sig-1" },
		{ x: 15, y: 25 },
		{ op: "addLabel", net: "SIG", x: 15, y: 25, kind: "local" },
	),
	moveCase(
		"move line annotation with uuid emits deleteItem then addLine",
		{ id: "a13", kind: "line", x: 0, y: 0, x2: 10, y2: 10, uuid: "u-line-1" },
		{ x: 5, y: 5, x2: 15, y2: 15 },
		{ op: "addLine", x1: 5, y1: 5, x2: 15, y2: 15 },
	),
	unchangedCase(
		"no change on identical annotation emits no edits",
		ir([
			{ id: "a14", kind: "text", text: "Hold", x: 1, y: 1, uuid: "u-text-1" },
		]),
		ir([
			{ id: "a14", kind: "text", text: "Hold", x: 1, y: 1, uuid: "u-text-1" },
		]),
	),
	unchangedCase("no change on empty annotations emits no edits"),
];

function verifyEdits({ before, after, sch, canSaveInPlace }) {
	const res = editsFromIrChange(before, after);
	assert.deepStrictEqual(res.sch, sch);
	assert.equal(res.canSaveInPlace, canSaveInPlace);
}

describe("kicadEdits annotations mapping", () => {
	for (const tc of CASES) {
		test(tc.name, () => {
			verifyEdits(tc);
		});
	}
});
