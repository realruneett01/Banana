import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { editsFromIrChange } from "../../frontend/src/editor/kicadEdits.js";

const ir = (annotations = []) => ({ parts: [], nets: [], annotations });

const KIND_CASES = [
	{
		name: "addLabel local without rot",
		before: ir([]),
		after: ir([{ id: "a1", kind: "label", x: 10, y: 20, text: "CLK" }]),
		sch: [{ op: "addLabel", net: "CLK", x: 10, y: 20, kind: "local" }],
	},
	{
		name: "addLabel local with rot",
		before: ir([]),
		after: ir([
			{ id: "a2", kind: "label", x: 10, y: 20, text: "CLK", rot: 90 },
		]),
		sch: [{ op: "addLabel", net: "CLK", x: 10, y: 20, rot: 90, kind: "local" }],
	},
	{
		name: "addLabel global",
		before: ir([]),
		after: ir([
			{ id: "a3", kind: "globalLabel", x: 15, y: 25, text: "VCC", rot: 180 },
		]),
		sch: [
			{ op: "addLabel", net: "VCC", x: 15, y: 25, rot: 180, kind: "global" },
		],
	},
	{
		name: "addLabel hierarchical",
		before: ir([]),
		after: ir([{ id: "a4", kind: "hierLabel", x: 30, y: 40, text: "DATA_TX" }]),
		sch: [
			{ op: "addLabel", net: "DATA_TX", x: 30, y: 40, kind: "hierarchical" },
		],
	},
	{
		name: "addNoConnect",
		before: ir([]),
		after: ir([{ id: "a5", kind: "noConnect", x: 50, y: 60 }]),
		sch: [{ op: "addNoConnect", x: 50, y: 60 }],
	},
	{
		name: "addJunction",
		before: ir([]),
		after: ir([{ id: "a6", kind: "junction", x: 70, y: 80 }]),
		sch: [{ op: "addJunction", x: 70, y: 80 }],
	},
	{
		name: "addText with rot",
		before: ir([]),
		after: ir([
			{ id: "a7", kind: "text", text: "Rev A", x: 12, y: 34, rot: 270 },
		]),
		sch: [{ op: "addText", text: "Rev A", x: 12, y: 34, rot: 270 }],
	},
	{
		name: "addLine",
		before: ir([]),
		after: ir([{ id: "a8", kind: "line", x: 1, y: 2, x2: 3, y2: 4 }]),
		sch: [{ op: "addLine", x1: 1, y1: 2, x2: 3, y2: 4 }],
	},
	{
		name: "addBus",
		before: ir([]),
		after: ir([{ id: "a9", kind: "bus", x: 5, y: 6, x2: 7, y2: 8 }]),
		sch: [{ op: "addBus", x1: 5, y1: 6, x2: 7, y2: 8 }],
	},
];

const LIFECYCLE_CASES = [
	{
		name: "remove annotation with uuid emits deleteItem",
		before: ir([
			{ id: "a10", kind: "junction", x: 10, y: 20, uuid: "u-junc-1" },
		]),
		after: ir([]),
		sch: [{ op: "deleteItem", uuid: "u-junc-1" }],
		canSaveInPlace: true,
	},
	{
		name: "remove annotation without uuid emits no deleteItem",
		before: ir([{ id: "a11", kind: "junction", x: 10, y: 20 }]),
		after: ir([]),
		sch: [],
		canSaveInPlace: false,
	},
	{
		name: "move annotation with uuid emits deleteItem then add op",
		before: ir([
			{
				id: "a12",
				kind: "label",
				x: 10,
				y: 20,
				text: "SIG",
				uuid: "u-sig-1",
			},
		]),
		after: ir([
			{
				id: "a12",
				kind: "label",
				x: 15,
				y: 25,
				text: "SIG",
				uuid: "u-sig-1",
			},
		]),
		sch: [
			{ op: "deleteItem", uuid: "u-sig-1" },
			{ op: "addLabel", net: "SIG", x: 15, y: 25, kind: "local" },
		],
		canSaveInPlace: true,
	},
	{
		name: "move line annotation with uuid emits deleteItem then addLine",
		before: ir([
			{
				id: "a13",
				kind: "line",
				x: 0,
				y: 0,
				x2: 10,
				y2: 10,
				uuid: "u-line-1",
			},
		]),
		after: ir([
			{
				id: "a13",
				kind: "line",
				x: 5,
				y: 5,
				x2: 15,
				y2: 15,
				uuid: "u-line-1",
			},
		]),
		sch: [
			{ op: "deleteItem", uuid: "u-line-1" },
			{ op: "addLine", x1: 5, y1: 5, x2: 15, y2: 15 },
		],
		canSaveInPlace: true,
	},
	{
		name: "no change on identical annotation emits no edits",
		before: ir([
			{ id: "a14", kind: "text", text: "Hold", x: 1, y: 1, uuid: "u-text-1" },
		]),
		after: ir([
			{ id: "a14", kind: "text", text: "Hold", x: 1, y: 1, uuid: "u-text-1" },
		]),
		sch: [],
		canSaveInPlace: false,
	},
	{
		name: "no change on empty annotations emits no edits",
		before: ir([]),
		after: ir([]),
		sch: [],
		canSaveInPlace: false,
	},
];

describe("kicadEdits annotations mapping", () => {
	for (const tc of KIND_CASES) {
		test(tc.name, () => {
			const res = editsFromIrChange(tc.before, tc.after);
			assert.deepStrictEqual(res.sch, tc.sch);
			assert.equal(res.canSaveInPlace, true);
		});
	}

	for (const tc of LIFECYCLE_CASES) {
		test(tc.name, () => {
			const res = editsFromIrChange(tc.before, tc.after);
			assert.deepStrictEqual(res.sch, tc.sch);
			assert.equal(res.canSaveInPlace, tc.canSaveInPlace);
		});
	}
});
