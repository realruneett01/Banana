import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	netItemsAt,
	netsOfPart,
} from "../../frontend/src/editor/netHighlight.js";

const ir = {
	parts: [
		{ id: "p1", ref: "R1" },
		{ id: "p2", ref: "R2" },
		{ id: "p3", ref: "C1" },
	],
	nets: [
		{
			id: "n1",
			name: "VCC",
			pins: [
				{ partId: "p1", pin: "1" },
				{ partId: "p2", pin: "A" },
				{ partId: "p3", pin: "+" },
			],
		},
		{
			id: "n2",
			name: "GND",
			pins: [
				{ partId: "p1", pin: "2" },
				{ partId: "p3", pin: "-" },
			],
		},
	],
};

describe("netItemsAt – hit by pin", () => {
	const cases = [
		{
			label: "pin on 3-pin net returns all 3 pins and correct partIds",
			hit: { partId: "p1", pin: "1" },
			check(r) {
				assert.equal(r.netId, "n1");
				assert.equal(r.netName, "VCC");
				assert.deepEqual(r.partIds, new Set(["p1", "p2", "p3"]));
				assert.equal(r.pins.length, 3);
			},
		},
		{
			label: "another pin on same net returns same net",
			hit: { partId: "p2", pin: "A" },
			check(r) {
				assert.equal(r.netId, "n1");
			},
		},
		{
			label: "pin on 2-pin net returns correct data",
			hit: { partId: "p3", pin: "-" },
			check(r) {
				assert.equal(r.netId, "n2");
				assert.deepEqual(r.partIds, new Set(["p1", "p3"]));
				assert.equal(r.pins.length, 2);
			},
		},
		{
			label: "unconnected pin -> null",
			hit: { partId: "p2", pin: "Z" },
			check(r) {
				assert.equal(r, null);
			},
		},
		{
			label: "unknown part -> null",
			hit: { partId: "p99", pin: "1" },
			check(r) {
				assert.equal(r, null);
			},
		},
	];

	for (const { label, hit, check } of cases) {
		it(label, () => check(netItemsAt(ir, hit)));
	}
});

describe("netItemsAt – hit by netId", () => {
	it("known netId returns net data", () => {
		const r = netItemsAt(ir, { netId: "n2" });
		assert.equal(r.netId, "n2");
		assert.equal(r.netName, "GND");
		assert.equal(r.pins.length, 2);
	});

	it("unknown netId -> null", () => {
		assert.equal(netItemsAt(ir, { netId: "nX" }), null);
	});
});

describe("netItemsAt – edge cases", () => {
	it("null ir -> null", () =>
		assert.equal(netItemsAt(null, { netId: "n1" }), null));
	it("null hit -> null", () => assert.equal(netItemsAt(ir, null), null));
});

describe("netsOfPart", () => {
	it("part on 2 nets returns both ids", () => {
		const ids = netsOfPart(ir, "p1");
		assert.deepEqual(ids.sort(), ["n1", "n2"]);
	});

	it("part on 1 net returns that id", () => {
		assert.deepEqual(netsOfPart(ir, "p2"), ["n1"]);
	});

	it("unknown part -> empty array", () => {
		assert.deepEqual(netsOfPart(ir, "p99"), []);
	});

	it("null ir -> empty array", () => {
		assert.deepEqual(netsOfPart(null, "p1"), []);
	});
});
