import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	netItemsAt,
	netRingPoints,
} from "../../frontend/src/editor/netHighlight.js";
import { pinPositions } from "../../frontend/src/editor/schematicGeometry.js";

const ir = {
	parts: [
		{ id: "p1", ref: "R1", pins: ["1", "2"], placement: { x: 0, y: 0 } },
		{ id: "p2", ref: "R2", pins: ["1", "2"], placement: { x: 20, y: 0 } },
	],
	nets: [
		{
			id: "n1",
			name: "VCC",
			pins: [
				{ partId: "p1", pin: "1" },
				{ partId: "p2", pin: "2" },
			],
		},
	],
};

function pinMap(parts) {
	const map = new Map();
	for (const part of parts) {
		for (const [pin, pos] of pinPositions(part, part.pins)) {
			map.set(`${part.id}:${pin}`, pos);
		}
	}
	return map;
}

const allPinPos = pinMap(ir.parts);

describe("netRingPoints", () => {
	it("returns one point per pin of the highlighted net", () => {
		const hl = netItemsAt(ir, { partId: "p1", pin: "1" });
		const pts = netRingPoints(hl, allPinPos);
		const a = allPinPos.get("p1:1");
		const b = allPinPos.get("p2:2");
		assert.deepEqual(pts, [
			{ x: a[0], y: a[1] },
			{ x: b[0], y: b[1] },
		]);
	});

	it("unknown pin yields no points", () => {
		const hl = netItemsAt(ir, { partId: "p1", pin: "9" });
		assert.deepEqual(netRingPoints(hl, allPinPos), []);
	});

	it("skips net pins that have no known position", () => {
		const hl = {
			netId: "x",
			netName: "X",
			partIds: new Set(["zz"]),
			pins: [{ partId: "zz", pin: "1" }],
		};
		assert.deepEqual(netRingPoints(hl, allPinPos), []);
	});

	it("null highlight yields no points", () => {
		assert.deepEqual(netRingPoints(null, allPinPos), []);
	});
});
