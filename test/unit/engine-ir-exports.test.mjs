import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	irToBomCsv,
	irToBomRows,
	irToKicadNetlist,
} from "../../backend/src/engine/ir-exports.js";

function makePart(spec) {
	return {
		id: spec.id,
		ref: spec.ref,
		value: spec.value,
		symbol: spec.symbol,
		footprint: spec.footprint,
		props: {},
	};
}

function buildSampleCircuitIR() {
	return {
		schemaVersion: 1,
		name: "SampleBoard",
		parts: [
			makePart({
				id: "p_r1",
				ref: "R1",
				value: "10k",
				symbol: "Device:R",
				footprint: "Resistor_SMD:R_0603_1608Metric",
			}),
			makePart({
				id: "p_r10",
				ref: "R10",
				value: "10k",
				symbol: "Device:R",
				footprint: "Resistor_SMD:R_0603_1608Metric",
			}),
			makePart({
				id: "p_r2",
				ref: "R2",
				value: "10k",
				symbol: "Device:R",
				footprint: "Resistor_SMD:R_0603_1608Metric",
			}),
			makePart({
				id: "p_c1",
				ref: "C1",
				value: "100n",
				symbol: "Device:C",
				footprint: "Capacitor_SMD:C_0402_1005Metric",
			}),
		],
		nets: [
			{
				id: "n_gnd",
				name: "GND",
				pins: [
					{ partId: "p_r1", pin: "1" },
					{ partId: "p_unknown", pin: "99" },
				],
			},
			{
				id: "n_empty",
				name: "",
				pins: [{ partId: "p_r2", pin: "1" }],
			},
		],
		constraints: [],
	};
}

const BOM_ROW_CASES = [
	{
		rowIdx: 0,
		firstRef: "C1",
		expectedRefs: ["C1"],
		expectedQty: 1,
		expectedValue: "100n",
		expectedFp: "Capacitor_SMD:C_0402_1005Metric",
		expectedSym: "Device:C",
	},
	{
		rowIdx: 1,
		firstRef: "R1",
		expectedRefs: ["R1", "R2", "R10"],
		expectedQty: 3,
		expectedValue: "10k",
		expectedFp: "Resistor_SMD:R_0603_1608Metric",
		expectedSym: "Device:R",
	},
];

function assertBomRow(actualRow, tc) {
	assert.deepStrictEqual(actualRow.refs, tc.expectedRefs);
	assert.strictEqual(actualRow.qty, tc.expectedQty);
	assert.strictEqual(actualRow.value, tc.expectedValue);
	assert.strictEqual(actualRow.footprint, tc.expectedFp);
	assert.strictEqual(actualRow.symbol, tc.expectedSym);
}

describe("irToBomRows grouping and natural ordering", () => {
	const ir = buildSampleCircuitIR();
	const rows = irToBomRows(ir);

	test("produces expected row count", () => {
		assert.strictEqual(rows.length, BOM_ROW_CASES.length);
	});

	for (const tc of BOM_ROW_CASES) {
		test(`row ${tc.rowIdx} matches group starting with ${tc.firstRef}`, () => {
			assertBomRow(rows[tc.rowIdx], tc);
		});
	}
});

const CSV_FORMULA_CASES = [
	{ label: "quoted double quote", val: '10" 5%', expected: '"10"" 5%"' },
	{ label: "formula equals", val: "=1+1", expected: '"\'=1+1"' },
	{ label: "formula plus", val: "+5V", expected: '"\'+5V"' },
	{ label: "formula minus", val: "-12V", expected: '"\'-12V"' },
	{ label: "formula at", val: "@ref", expected: '"\'@ref"' },
];

describe("irToBomCsv formatting, quoting and injection protection", () => {
	test("emits CRLF endings and header line", () => {
		const ir = buildSampleCircuitIR();
		const csv = irToBomCsv(ir);
		assert.ok(csv.startsWith("Reference,Qty,Value,Footprint,Symbol\r\n"));
		assert.ok(csv.endsWith("\r\n"));
		const noCrlf = csv.replaceAll("\r\n", "");
		assert.strictEqual(noCrlf.includes("\n"), false);
		assert.strictEqual(noCrlf.includes("\r"), false);
	});

	for (const tc of CSV_FORMULA_CASES) {
		test(`handles ${tc.label} safely`, () => {
			const ir = {
				schemaVersion: 1,
				name: "Test",
				parts: [
					makePart({
						id: "p1",
						ref: "R1",
						value: tc.val,
						symbol: "Device:R",
						footprint: "R_0603",
					}),
				],
				nets: [],
				constraints: [],
			};
			const csv = irToBomCsv(ir);
			assert.ok(csv.includes(tc.expected));
		});
	}
});

function areIndicesOrdered(indices) {
	const allPresent = indices.every((idx) => idx !== -1);
	const inOrder = indices.slice(1).every((idx, i) => idx > indices[i]);
	return Boolean(allPresent && inOrder);
}

describe("irToKicadNetlist component and net structure", () => {
	const ir = buildSampleCircuitIR();
	const netlist = irToKicadNetlist(ir);

	test("contains design header and source", () => {
		assert.ok(netlist.includes('(export (version "E")'));
		assert.ok(
			netlist.includes('(design (source "SampleBoard") (tool "Banana"))'),
		);
	});

	test("sorts components naturally (C1 before R1 before R2 before R10)", () => {
		const positions = [
			netlist.indexOf('(comp (ref "C1")'),
			netlist.indexOf('(comp (ref "R1")'),
			netlist.indexOf('(comp (ref "R2")'),
			netlist.indexOf('(comp (ref "R10")'),
		];
		assert.strictEqual(areIndicesOrdered(positions), true);
	});

	test("formats component with footprint and parsed libsource", () => {
		const expectedComp =
			'(comp (ref "R1") (value "10k") (footprint "Resistor_SMD:R_0603_1608Metric") (libsource (lib "Device") (part "R")))';
		assert.ok(netlist.includes(expectedComp));
	});

	test("numbers nets from 1 and names empty net /N-1", () => {
		const expectedNet1 =
			'(net (code "1") (name "/N-1") (node (ref "R2") (pin "1")))';
		const expectedNet2 =
			'(net (code "2") (name "GND") (node (ref "R1") (pin "1")))))';
		assert.ok(netlist.includes(expectedNet1));
		assert.ok(netlist.includes(expectedNet2));
	});

	test("skips pins whose partId is unknown", () => {
		assert.strictEqual(netlist.includes("p_unknown"), false);
		assert.strictEqual(netlist.includes('(pin "99")'), false);
	});
});

const ESCAPE_NETLIST_CASES = [
	{
		label: "quotes and backslash in value",
		val: '10" \\ 5%',
		expectedSnippet: '(value "10\\" \\\\ 5%")',
	},
	{
		label: "quotes in component ref",
		val: "10k",
		expectedSnippet: '(value "10k")',
	},
];

describe("irToKicadNetlist escaping and purity", () => {
	for (const tc of ESCAPE_NETLIST_CASES) {
		test(`escapes ${tc.label}`, () => {
			const ir = {
				schemaVersion: 1,
				name: 'Test"Board\\1',
				parts: [
					makePart({
						id: "p1",
						ref: "R1",
						value: tc.val,
						symbol: "Device:R",
						footprint: "R_0603",
					}),
				],
				nets: [],
				constraints: [],
			};
			const netlist = irToKicadNetlist(ir);
			assert.ok(netlist.includes('(source "Test\\"Board\\\\1")'));
			assert.ok(netlist.includes(tc.expectedSnippet));
		});
	}

	test("never mutates input ir object", () => {
		const ir = buildSampleCircuitIR();
		const before = JSON.stringify(ir);
		irToBomRows(ir);
		irToBomCsv(ir);
		irToKicadNetlist(ir);
		assert.strictEqual(JSON.stringify(ir), before);
	});
});
