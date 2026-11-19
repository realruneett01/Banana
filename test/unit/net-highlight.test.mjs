import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	netItemsAt,
	netsOfPart,
} from "../../frontend/src/editor/netHighlight.js";

const makeNet = (id, name, pins) => ({
	id,
	name,
	pins: pins.map(([partId, pin]) => ({ partId, pin })),
});

const ir = {
	parts: [
		{ id: "p1", ref: "R1" },
		{ id: "p2", ref: "R2" },
		{ id: "p3", ref: "C1" },
	],
	nets: [
		makeNet("n1", "VCC", [
			["p1", "1"],
			["p2", "A"],
			["p3", "+"],
		]),
		makeNet("n2", "GND", [
			["p1", "2"],
			["p3", "-"],
		]),
	],
};

function assertNetMatch(actual, expected) {
	if (!expected) {
		assert.equal(actual, null);
		return;
	}
	assert.equal(actual.netId, expected.netId);
	if (expected.netName !== undefined) {
		assert.equal(actual.netName, expected.netName);
	}
	if (expected.partIds !== undefined) {
		assert.deepEqual(actual.partIds, new Set(expected.partIds));
	}
	if (expected.pinsLength !== undefined) {
		assert.equal(actual.pins.length, expected.pinsLength);
	}
}

function runNetCases(cases) {
	for (const [label, hit, expected, targetIr = ir] of cases) {
		it(label, () => assertNetMatch(netItemsAt(targetIr, hit), expected));
	}
}

describe("netItemsAt – hit by pin", () => {
	runNetCases([
		[
			"pin on 3-pin net returns all 3 pins and correct partIds",
			{ partId: "p1", pin: "1" },
			{
				netId: "n1",
				netName: "VCC",
				partIds: ["p1", "p2", "p3"],
				pinsLength: 3,
			},
		],
		[
			"another pin on same net returns same net",
			{ partId: "p2", pin: "A" },
			{ netId: "n1" },
		],
		[
			"pin on 2-pin net returns correct data",
			{ partId: "p3", pin: "-" },
			{ netId: "n2", partIds: ["p1", "p3"], pinsLength: 2 },
		],
		["unconnected pin -> null", { partId: "p2", pin: "Z" }, null],
		["unknown part -> null", { partId: "p99", pin: "1" }, null],
	]);
});

describe("netItemsAt – hit by netId", () => {
	runNetCases([
		[
			"known netId returns net data",
			{ netId: "n2" },
			{ netId: "n2", netName: "GND", pinsLength: 2 },
		],
		["unknown netId -> null", { netId: "nX" }, null],
	]);
});

describe("netItemsAt – edge cases", () => {
	runNetCases([
		["null ir -> null", { netId: "n1" }, null, null],
		["null hit -> null", null, null],
	]);
});

describe("netsOfPart", () => {
	const cases = [
		["part on 2 nets returns both ids", ir, "p1", ["n1", "n2"], true],
		["part on 1 net returns that id", ir, "p2", ["n1"], false],
		["unknown part -> empty array", ir, "p99", [], false],
		["null ir -> empty array", null, "p1", [], false],
	];

	for (const [label, targetIr, partId, expected, sort] of cases) {
		it(label, () => {
			const res = netsOfPart(targetIr, partId);
			assert.deepEqual(sort ? res.sort() : res, expected);
		});
	}
});
