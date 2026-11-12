import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { irToKicadPcb } from "../../backend/src/engine/kicad-pcb-writer.js";
import { irToKicadSch } from "../../backend/src/engine/kicad-sch-writer.js";

const SCH_IR = {
	schemaVersion: 1,
	name: "test_circuit",
	parts: [
		{
			id: "part_00000000-0000-0000-0000-000000000001",
			ref: "R1",
			value: "10k",
			symbol: "Device:R",
			footprint: "Resistor_SMD:R_0805",
			props: {},
		},
	],
	nets: [],
	constraints: [],
};

const PCB_IR = {
	schemaVersion: 1,
	name: "test_board",
	parts: [],
	nets: [],
	constraints: [],
};

const { text: schText } = irToKicadSch(SCH_IR);
const { text: pcbText } = irToKicadPcb(PCB_IR);

const CASES = [
	{
		name: "setValue still works",
		text: schText,
		options: {
			kind: "sch",
			edits: [{ op: "setValue", ref: "R1", value: "20k" }],
		},
		expectedOk: true,
		expectedSubstring: "20k",
	},
	{
		name: "addLabel on a schematic built with irToKicadSch returns ok and contains (label",
		text: schText,
		options: {
			kind: "sch",
			edits: [{ op: "addLabel", net: "CLK", x: 10, y: 20 }],
		},
		expectedOk: true,
		expectedSubstring: "(label",
	},
	{
		name: "addVia on a board from irToKicadPcb returns ok and contains (via",
		text: pcbText,
		options: {
			kind: "pcb",
			edits: [{ op: "addVia", net: "GND", x: 15, y: 25 }],
		},
		expectedOk: true,
		expectedSubstring: "(via",
	},
	{
		name: "new op without kind -> ok false",
		text: schText,
		options: {
			edits: [{ op: "addLabel", net: "CLK", x: 10, y: 20 }],
		},
		expectedOk: false,
		expectedSubstring: null,
		expectedError: "kind required for edit ops",
	},
];

describe("kicad-inplace dispatch", () => {
	for (const tc of CASES) {
		test(tc.name, () => {
			const res = patchKicadText(tc.text, tc.options);
			assert.equal(res.ok, tc.expectedOk);
			if (tc.expectedSubstring) {
				assert.ok(res.text?.includes(tc.expectedSubstring));
			}
			if (tc.expectedError) {
				assert.equal(res.error, tc.expectedError);
			}
		});
	}
});
