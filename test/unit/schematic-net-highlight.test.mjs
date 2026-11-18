import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	netItemsAt,
	netRingPoints,
} from "../../frontend/src/editor/netHighlight.js";
import { pinPositions } from "../../frontend/src/editor/schematicGeometry.js";

function createCircuitFixture() {
	const createPart = (id, x) => ({
		id,
		ref: id.toUpperCase(),
		pins: ["1", "2"],
		placement: { x, y: 0 },
	});
	const parts = [createPart("p1", 0), createPart("p2", 20)];
	const pins = [
		{ partId: "p1", pin: "1" },
		{ partId: "p2", pin: "2" },
	];
	const ir = { parts, nets: [{ id: "n1", name: "VCC", pins }] };
	const pinMap = new Map();
	for (const part of parts) {
		for (const [pin, pos] of pinPositions(part, part.pins)) {
			pinMap.set(`${part.id}:${pin}`, pos);
		}
	}
	return { ir, pinMap };
}

const { ir, pinMap: allPinPos } = createCircuitFixture();

describe("netRingPoints", () => {
	it("returns one point per pin of the highlighted net", () => {
		const hl = netItemsAt(ir, { partId: "p1", pin: "1" });
		const pts = netRingPoints(hl, allPinPos);
		const [a, b] = [allPinPos.get("p1:1"), allPinPos.get("p2:2")];
		assert.deepEqual(pts, [
			{ x: a[0], y: a[1] },
			{ x: b[0], y: b[1] },
		]);
	});

	const emptyScenarios = [
		[
			"unknown pin yields no points",
			() => netItemsAt(ir, { partId: "p1", pin: "9" }),
		],
		[
			"skips net pins that have no known position",
			() => ({
				netId: "x",
				netName: "X",
				partIds: new Set(["zz"]),
				pins: [{ partId: "zz", pin: "1" }],
			}),
		],
		["null highlight yields no points", () => null],
	];

	for (const [name, target] of emptyScenarios) {
		it(name, () => {
			assert.deepEqual(netRingPoints(target(), allPinPos), []);
		});
	}
});
