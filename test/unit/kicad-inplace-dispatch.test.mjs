import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { irToKicadPcb } from "../../backend/src/engine/kicad-pcb-writer.js";
import { irToKicadSch } from "../../backend/src/engine/kicad-sch-writer.js";

function ir(name, parts) {
	return { schemaVersion: 1, name, parts, nets: [], constraints: [] };
}

const R1 = {
	id: "part_00000000-0000-0000-0000-000000000001",
	ref: "R1",
	value: "10k",
	symbol: "Device:R",
	footprint: "Resistor_SMD:R_0805",
	props: {},
};

const { text: schText } = irToKicadSch(ir("test_circuit", [R1]));
const { text: pcbText } = irToKicadPcb(ir("test_board", []));

const LABEL = { op: "addLabel", net: "CLK", x: 10, y: 20 };
const SET_VALUE = { op: "setValue", ref: "R1", value: "20k" };
const VIA = { op: "addVia", net: "GND", x: 15, y: 25 };

// Successful edits: [name, text, kind, edit, expectedSubstring]
const OK_CASES = [
	["setValue still works", schText, "sch", SET_VALUE, "20k"],
	[
		"addLabel on a schematic built with irToKicadSch returns ok and contains (label",
		schText,
		"sch",
		LABEL,
		"(label",
	],
	[
		"addVia on a board from irToKicadPcb returns ok and contains (via",
		pcbText,
		"pcb",
		VIA,
		"(via",
	],
];

describe("kicad-inplace dispatch", () => {
	for (const [name, text, kind, edit, substring] of OK_CASES) {
		test(name, () => {
			const res = patchKicadText(text, { kind, edits: [edit] });
			assert.equal(res.ok, true);
			assert.ok(res.text?.includes(substring));
		});
	}

	test("new op without kind -> ok false", () => {
		const res = patchKicadText(schText, { edits: [LABEL] });
		assert.equal(res.ok, false);
		assert.equal(res.error, "kind required for edit ops");
	});
});
