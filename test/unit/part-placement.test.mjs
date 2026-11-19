import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildPlacedPart,
	nextRef,
} from "../../frontend/src/editor/partPlacement.js";

const refParts = (...refs) => refs.map((ref) => ({ ref }));

const pos = (x, y, side) => (side ? { x, y, side } : { x, y });

function placedPart(ref, overrides = {}) {
	const { x = 0, y = 0, side = "F", ...rest } = overrides;
	return {
		ref,
		value: "",
		symbol: "",
		footprint: "",
		...rest,
		placement: { x, y, rot: 0, side },
	};
}

function testBuild(name, expected, options = {}) {
	const { item = {}, parts = [], at } = options;
	it(`buildPlacedPart: ${name}`, () => {
		assert.deepEqual(buildPlacedPart(item, parts, at), expected);
	});
}

describe("partPlacement", () => {
	const NEXT_REF_CASES = [
		["empty parts list", [], "R", "R1"],
		["undefined parts list", undefined, "C", "C1"],
		["fills lowest gap (R1,R3 -> R2)", refParts("R1", "R3"), "R", "R2"],
		["case-insensitive matching (r1 -> R2)", refParts("r1"), "R", "R2"],
		["strips trailing question mark ('R?' -> R1)", [], "R?", "R1"],
		[
			"strips multiple trailing question marks and hashes",
			refParts("R1"),
			"R?#",
			"R2",
		],
		["supports #PWR prefix", refParts("#PWR1"), "#PWR", "#PWR2"],
		["supports #FLG prefix", [], "#FLG", "#FLG1"],
		["defaults to U when prefix is undefined", [], undefined, "U1"],
		[
			"defaults to U when prefix becomes empty after stripping",
			refParts("U1"),
			"???",
			"U2",
		],
		["escapes regex special character (+ -> +1)", refParts("+1"), "+", "+2"],
	];

	for (const [name, parts, prefix, expected] of NEXT_REF_CASES) {
		it(`nextRef: ${name}`, () => {
			assert.equal(nextRef(parts, prefix), expected);
		});
	}

	testBuild("applies default values and placement", placedPart("U1"));
	testBuild(
		"uses custom coordinates",
		placedPart("R1", { value: "10k", x: 12.5, y: -4.2 }),
		{ item: { ref: "R", value: "10k" }, at: pos(12.5, -4.2) },
	);
	testBuild(
		"sets side B when requested",
		placedPart("C1", { symbol: "Cap:C", x: 5, y: 10, side: "B" }),
		{ item: { ref: "C", symbol: "Cap:C" }, at: pos(5, 10, "B") },
	);
	testBuild(
		"falls back to item.prefix when item.ref is omitted",
		placedPart("D2", { footprint: "D_0805" }),
		{
			item: { prefix: "D", footprint: "D_0805" },
			parts: refParts("D1"),
			at: pos(0, 0),
		},
	);
	testBuild(
		"defaults side to F when side is not B",
		placedPart("U1", { value: "NE555" }),
		{ item: { ref: "U", value: "NE555" }, at: pos(0, 0, "T") },
	);
});
