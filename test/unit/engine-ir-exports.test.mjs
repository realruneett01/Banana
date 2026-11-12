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

function makeResistor(id, ref) {
	return makePart({
		id,
		ref,
		value: "10k",
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0603_1608Metric",
	});
}

function makeCapacitor(id, ref) {
	return makePart({
		id,
		ref,
		value: "100n",
		symbol: "Device:C",
		footprint: "Capacitor_SMD:C_0402_1005Metric",
	});
}

const SAMPLE_CIRCUIT_NETS = [
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
];

function buildSampleCircuitIR() {
	return {
		schemaVersion: 1,
		name: "SampleBoard",
		parts: [
			makeResistor("p_r1", "R1"),
			makeResistor("p_r10", "R10"),
			makeResistor("p_r2", "R2"),
			makeCapacitor("p_c1", "C1"),
		],
		nets: SAMPLE_CIRCUIT_NETS,
		constraints: [],
	};
}

function makeSinglePartIR(val, name = "Test") {
	return {
		schemaVersion: 1,
		name,
		parts: [
			makePart({
				id: "p1",
				ref: "R1",
				value: val,
				symbol: "Device:R",
				footprint: "R_0603",
			}),
		],
		nets: [],
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

describe("irToBomRows grouping and natural ordering", () => {
	const ir = buildSampleCircuitIR();
	const rows = irToBomRows(ir);

	test("produces expected row count", () => {
		assert.strictEqual(rows.length, BOM_ROW_CASES.length);
	});

	for (const tc of BOM_ROW_CASES) {
		test(`row ${tc.rowIdx} matches refs (${tc.firstRef})`, () => {
			assert.deepStrictEqual(rows[tc.rowIdx].refs, tc.expectedRefs);
		});
		test(`row ${tc.rowIdx} matches qty (${tc.firstRef})`, () => {
			assert.strictEqual(rows[tc.rowIdx].qty, tc.expectedQty);
		});
		test(`row ${tc.rowIdx} matches value (${tc.firstRef})`, () => {
			assert.strictEqual(rows[tc.rowIdx].value, tc.expectedValue);
		});
		test(`row ${tc.rowIdx} matches footprint (${tc.firstRef})`, () => {
			assert.strictEqual(rows[tc.rowIdx].footprint, tc.expectedFp);
		});
		test(`row ${tc.rowIdx} matches symbol (${tc.firstRef})`, () => {
			assert.strictEqual(rows[tc.rowIdx].symbol, tc.expectedSym);
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
	test("emits header line with CRLF", () => {
		const ir = buildSampleCircuitIR();
		const csv = irToBomCsv(ir);
		assert.ok(csv.startsWith("Reference,Qty,Value,Footprint,Symbol\r\n"));
	});

	test("emits CRLF ending", () => {
		const ir = buildSampleCircuitIR();
		const csv = irToBomCsv(ir);
		assert.ok(csv.endsWith("\r\n"));
	});

	test("contains no bare LF characters", () => {
		const noCrlf = irToBomCsv(buildSampleCircuitIR()).replaceAll("\r\n", "");
		assert.strictEqual(noCrlf.includes("\n"), false);
	});

	test("contains no bare CR characters", () => {
		const noCrlf = irToBomCsv(buildSampleCircuitIR()).replaceAll("\r\n", "");
		assert.strictEqual(noCrlf.includes("\r"), false);
	});

	for (const tc of CSV_FORMULA_CASES) {
		test(`handles ${tc.label} safely`, () => {
			const ir = makeSinglePartIR(tc.val);
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

	test("contains export version header", () => {
		assert.ok(netlist.includes('(export (version "E")'));
	});

	test("contains design source and tool", () => {
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

	test("names empty net /N-1 with code 1", () => {
		const expectedNet1 =
			'(net (code "1") (name "/N-1") (node (ref "R2") (pin "1")))';
		assert.ok(netlist.includes(expectedNet1));
	});

	test("numbers GND net with code 2", () => {
		const expectedNet2 =
			'(net (code "2") (name "GND") (node (ref "R1") (pin "1")))))';
		assert.ok(netlist.includes(expectedNet2));
	});

	test("skips unknown partId in nets", () => {
		assert.strictEqual(netlist.includes("p_unknown"), false);
	});

	test("skips pins whose partId is unknown", () => {
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
	test("escapes quotes and backslash in design source name", () => {
		const ir = makeSinglePartIR("10k", 'Test"Board\\1');
		const netlist = irToKicadNetlist(ir);
		assert.ok(netlist.includes('(source "Test\\"Board\\\\1")'));
	});

	for (const tc of ESCAPE_NETLIST_CASES) {
		test(`escapes ${tc.label}`, () => {
			const ir = makeSinglePartIR(tc.val);
			const netlist = irToKicadNetlist(ir);
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
