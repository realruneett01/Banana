import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	assignmentsToCommand,
	searchFootprints,
	suggestFootprintQuery,
} from "../../frontend/src/editor/footprintAssign.js";

const pins = (n) => Array(n).fill({});
const partVal = (ref, value) => ({ ref, value });
const partSym = (ref, symbol) => ({ ref, symbol });
const partPins = (ref, count, value) => ({
	ref,
	...(value ? { value } : {}),
	pins: pins(count),
});

const fpCmd = (partId, value) => ({
	type: "setPartField",
	partId,
	field: "footprint",
	value,
});

const mockFetch = ({ ok = true, status = 200, data = {}, onCall } = {}) => {
	return async (url) => {
		onCall?.(url);
		return {
			ok,
			status,
			json: async () => data,
		};
	};
};

const SUGGESTION_CASES = [
	["Resistor by ref prefix R", partVal("R1", "10k"), "R_0805"],
	["Resistor by symbol name", partSym("X1", "Device:R"), "R_0805"],
	["Capacitor by ref prefix C", partVal("C1", "100nF"), "C_0805"],
	["Capacitor by symbol name", partSym("X1", "Device:C"), "C_0805"],
	["LED by ref prefix LED", partVal("LED1", "Red"), "LED_0805"],
	["LED by symbol name", partSym("D1", "Device:LED"), "LED_0805"],
	["Diode by ref prefix D", partVal("D1", "1N4148"), "D_SOD-123"],
	["Generic IC default 8-pin SOIC", partPins("U1", 8, "NE555"), "SOIC-8"],
	["Generic IC 16-pin SOIC", partPins("U2", 16), "SOIC-16"],
	["Generic IC with DIP in value", partPins("U3", 8, "LM358_DIP"), "DIP-8"],
	["Connector 2-pin header", partPins("J1", 2), "PinHeader_1x02"],
	[
		"Connector 4-pin header from value",
		partPins("J2", 4, "Conn_01x04"),
		"PinHeader_1x04",
	],
	[
		"Symbol footprint filter overrides rule",
		{
			ref: "R1",
			value: "10k",
			props: { ki_fp_filters: "R_0603* Resistor_*" },
		},
		"R_0603",
	],
	[
		"Symbol Footprint Filter property overrides rule",
		{
			ref: "U1",
			props: { "Footprint Filter": "SOIC-14*" },
		},
		"SOIC-14",
	],
	["Empty or invalid part yields empty string", null, ""],
];

describe("suggestFootprintQuery", () => {
	for (const [label, part, expected] of SUGGESTION_CASES) {
		test(label, () => {
			assert.equal(suggestFootprintQuery(part), expected);
		});
	}
});

describe("assignmentsToCommand", () => {
	const expectBatch = (input, expectedCmds) => {
		assert.deepEqual(assignmentsToCommand(input), {
			type: "batch",
			commands: expectedCmds,
		});
	};

	test("converts dictionary of assignments to a batch command", () => {
		expectBatch(
			{
				part_r1: "Resistor_SMD:R_0805",
				part_c1: "Capacitor_SMD:C_0805",
			},
			[
				fpCmd("part_r1", "Resistor_SMD:R_0805"),
				fpCmd("part_c1", "Capacitor_SMD:C_0805"),
			],
		);
	});

	test("converts array of assignments to a batch command", () => {
		expectBatch(
			[{ partId: "part_u1", footprint: "Package_SO:SOIC-8" }],
			[fpCmd("part_u1", "Package_SO:SOIC-8")],
		);
	});

	test("empty assignments produce empty batch", () => {
		expectBatch({}, []);
	});
});

describe("searchFootprints", () => {
	test("searches real footprint endpoint with query and limit", async () => {
		const fakeResults = [
			{ libId: "Resistor_SMD:R_0805", name: "R_0805" },
			{ libId: "Resistor_SMD:R_0805_2012Metric", name: "R_0805_2012Metric" },
		];
		let fetchedUrl = "";
		const items = await searchFootprints("R_0805", {
			baseUrl: "http://test-server:5000",
			fetchImpl: mockFetch({
				data: { footprints: fakeResults },
				onCall: (url) => {
					fetchedUrl = url;
				},
			}),
		});
		assert.equal(
			fetchedUrl,
			"http://test-server:5000/api/library/footprints?q=R_0805&limit=50",
		);
		assert.equal(items.length, 2);
		assert.equal(items[0].name, "R_0805");
	});

	test("returns empty array immediately when query is blank", async () => {
		let called = false;
		const items = await searchFootprints("   ", {
			fetchImpl: () => {
				called = true;
			},
		});
		assert.equal(called, false);
		assert.deepEqual(items, []);
	});

	test("rejects when endpoint returns error status", async () => {
		await assert.rejects(
			() =>
				searchFootprints("SOIC-8", {
					baseUrl: "http://test-server:5000",
					fetchImpl: mockFetch({
						ok: false,
						status: 503,
						data: {
							error: "KiCad libraries are not installed on this server",
						},
					}),
				}),
			/KiCad libraries are not installed/,
		);
	});
});
