import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildPlacedPart,
	nextRef,
} from "../../frontend/src/editor/partPlacement.js";

describe("partPlacement", () => {
	const NEXT_REF_CASES = [
		{
			name: "empty parts list",
			parts: [],
			prefix: "R",
			expected: "R1",
		},
		{
			name: "undefined parts list",
			parts: undefined,
			prefix: "C",
			expected: "C1",
		},
		{
			name: "fills lowest gap (R1,R3 -> R2)",
			parts: [{ ref: "R1" }, { ref: "R3" }],
			prefix: "R",
			expected: "R2",
		},
		{
			name: "case-insensitive matching (r1 -> R2)",
			parts: [{ ref: "r1" }],
			prefix: "R",
			expected: "R2",
		},
		{
			name: "strips trailing question mark ('R?' -> R1)",
			parts: [],
			prefix: "R?",
			expected: "R1",
		},
		{
			name: "strips multiple trailing question marks and hashes",
			parts: [{ ref: "R1" }],
			prefix: "R?#",
			expected: "R2",
		},
		{
			name: "supports #PWR prefix",
			parts: [{ ref: "#PWR1" }],
			prefix: "#PWR",
			expected: "#PWR2",
		},
		{
			name: "supports #FLG prefix",
			parts: [],
			prefix: "#FLG",
			expected: "#FLG1",
		},
		{
			name: "defaults to U when prefix is undefined",
			parts: [],
			prefix: undefined,
			expected: "U1",
		},
		{
			name: "defaults to U when prefix becomes empty after stripping",
			parts: [{ ref: "U1" }],
			prefix: "???",
			expected: "U2",
		},
		{
			name: "escapes regex special character (+ -> +1)",
			parts: [{ ref: "+1" }],
			prefix: "+",
			expected: "+2",
		},
	];

	for (const tc of NEXT_REF_CASES) {
		it(`nextRef: ${tc.name}`, () => {
			assert.equal(nextRef(tc.parts, tc.prefix), tc.expected);
		});
	}

	const BUILD_PART_CASES = [
		{
			name: "applies default values and placement",
			item: {},
			parts: [],
			at: undefined,
			expected: {
				ref: "U1",
				value: "",
				symbol: "",
				footprint: "",
				placement: { x: 0, y: 0, rot: 0, side: "F" },
			},
		},
		{
			name: "uses custom coordinates",
			item: { ref: "R", value: "10k" },
			parts: [],
			at: { x: 12.5, y: -4.2 },
			expected: {
				ref: "R1",
				value: "10k",
				symbol: "",
				footprint: "",
				placement: { x: 12.5, y: -4.2, rot: 0, side: "F" },
			},
		},
		{
			name: "sets side B when requested",
			item: { ref: "C", symbol: "Cap:C" },
			parts: [],
			at: { x: 5, y: 10, side: "B" },
			expected: {
				ref: "C1",
				value: "",
				symbol: "Cap:C",
				footprint: "",
				placement: { x: 5, y: 10, rot: 0, side: "B" },
			},
		},
		{
			name: "falls back to item.prefix when item.ref is omitted",
			item: { prefix: "D", footprint: "D_0805" },
			parts: [{ ref: "D1" }],
			at: { x: 0, y: 0 },
			expected: {
				ref: "D2",
				value: "",
				symbol: "",
				footprint: "D_0805",
				placement: { x: 0, y: 0, rot: 0, side: "F" },
			},
		},
		{
			name: "defaults side to F when side is not B",
			item: { ref: "U", value: "NE555" },
			parts: [],
			at: { x: 0, y: 0, side: "T" },
			expected: {
				ref: "U1",
				value: "NE555",
				symbol: "",
				footprint: "",
				placement: { x: 0, y: 0, rot: 0, side: "F" },
			},
		},
	];

	for (const tc of BUILD_PART_CASES) {
		it(`buildPlacedPart: ${tc.name}`, () => {
			assert.deepEqual(buildPlacedPart(tc.item, tc.parts, tc.at), tc.expected);
		});
	}
});
