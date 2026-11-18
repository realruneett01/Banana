import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	assignmentsToCommand,
	searchFootprints,
	suggestFootprintQuery,
} from "../../frontend/src/editor/footprintAssign.js";

const SUGGESTION_CASES = [
	{
		label: "Resistor by ref prefix R",
		part: { ref: "R1", value: "10k" },
		expected: "R_0805",
	},
	{
		label: "Resistor by symbol name",
		part: { ref: "X1", symbol: "Device:R" },
		expected: "R_0805",
	},
	{
		label: "Capacitor by ref prefix C",
		part: { ref: "C1", value: "100nF" },
		expected: "C_0805",
	},
	{
		label: "Capacitor by symbol name",
		part: { ref: "X1", symbol: "Device:C" },
		expected: "C_0805",
	},
	{
		label: "LED by ref prefix LED",
		part: { ref: "LED1", value: "Red" },
		expected: "LED_0805",
	},
	{
		label: "LED by symbol name",
		part: { ref: "D1", symbol: "Device:LED" },
		expected: "LED_0805",
	},
	{
		label: "Diode by ref prefix D",
		part: { ref: "D1", value: "1N4148" },
		expected: "D_SOD-123",
	},
	{
		label: "Generic IC default 8-pin SOIC",
		part: { ref: "U1", value: "NE555", pins: Array(8).fill({}) },
		expected: "SOIC-8",
	},
	{
		label: "Generic IC 16-pin SOIC",
		part: { ref: "U2", pins: Array(16).fill({}) },
		expected: "SOIC-16",
	},
	{
		label: "Generic IC with DIP in value",
		part: { ref: "U3", value: "LM358_DIP", pins: Array(8).fill({}) },
		expected: "DIP-8",
	},
	{
		label: "Connector 2-pin header",
		part: { ref: "J1", pins: Array(2).fill({}) },
		expected: "PinHeader_1x02",
	},
	{
		label: "Connector 4-pin header from value",
		part: { ref: "J2", value: "Conn_01x04", pins: Array(4).fill({}) },
		expected: "PinHeader_1x04",
	},
	{
		label: "Symbol footprint filter overrides rule",
		part: {
			ref: "R1",
			value: "10k",
			props: { ki_fp_filters: "R_0603* Resistor_*" },
		},
		expected: "R_0603",
	},
	{
		label: "Symbol Footprint Filter property overrides rule",
		part: {
			ref: "U1",
			props: { "Footprint Filter": "SOIC-14*" },
		},
		expected: "SOIC-14",
	},
	{
		label: "Empty or invalid part yields empty string",
		part: null,
		expected: "",
	},
];

describe("suggestFootprintQuery", () => {
	for (const { label, part, expected } of SUGGESTION_CASES) {
		test(label, () => {
			assert.equal(suggestFootprintQuery(part), expected);
		});
	}
});

describe("assignmentsToCommand", () => {
	test("converts dictionary of assignments to a batch command", () => {
		const assignments = {
			part_r1: "Resistor_SMD:R_0805",
			part_c1: "Capacitor_SMD:C_0805",
		};
		const cmd = assignmentsToCommand(assignments);
		assert.equal(cmd.type, "batch");
		assert.equal(cmd.commands.length, 2);
		assert.deepEqual(cmd.commands[0], {
			type: "setPartField",
			partId: "part_r1",
			field: "footprint",
			value: "Resistor_SMD:R_0805",
		});
		assert.deepEqual(cmd.commands[1], {
			type: "setPartField",
			partId: "part_c1",
			field: "footprint",
			value: "Capacitor_SMD:C_0805",
		});
	});

	test("converts array of assignments to a batch command", () => {
		const assignments = [{ partId: "part_u1", footprint: "Package_SO:SOIC-8" }];
		const cmd = assignmentsToCommand(assignments);
		assert.equal(cmd.type, "batch");
		assert.deepEqual(cmd.commands, [
			{
				type: "setPartField",
				partId: "part_u1",
				field: "footprint",
				value: "Package_SO:SOIC-8",
			},
		]);
	});

	test("empty assignments produce empty batch", () => {
		const cmd = assignmentsToCommand({});
		assert.deepEqual(cmd, { type: "batch", commands: [] });
	});
});

describe("searchFootprints", () => {
	test("searches real footprint endpoint with query and limit", async () => {
		const fakeResults = [
			{ libId: "Resistor_SMD:R_0805", name: "R_0805" },
			{ libId: "Resistor_SMD:R_0805_2012Metric", name: "R_0805_2012Metric" },
		];
		let fetchedUrl = "";
		const fakeFetch = async (url) => {
			fetchedUrl = url;
			return {
				ok: true,
				status: 200,
				json: async () => ({ footprints: fakeResults }),
			};
		};
		const items = await searchFootprints("R_0805", {
			baseUrl: "http://test-server:5000",
			fetchImpl: fakeFetch,
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
		const fakeFetch = async () => {
			called = true;
			return { ok: true, json: async () => ({ footprints: [] }) };
		};
		const items = await searchFootprints("   ", { fetchImpl: fakeFetch });
		assert.equal(called, false);
		assert.deepEqual(items, []);
	});

	test("rejects when endpoint returns error status", async () => {
		const fakeFetch = async () => ({
			ok: false,
			status: 503,
			json: async () => ({
				error: "KiCad libraries are not installed on this server",
			}),
		});
		await assert.rejects(
			() =>
				searchFootprints("SOIC-8", {
					baseUrl: "http://test-server:5000",
					fetchImpl: fakeFetch,
				}),
			/KiCad libraries are not installed/,
		);
	});
});
