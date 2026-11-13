import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runErc } from "../../backend/src/engine/erc.js";
import { newId } from "../../backend/src/engine/ids.js";
import { validateIssue } from "../../backend/src/engine/issue.js";
import { kicadSchToIr } from "../../backend/src/engine/kicad-sch-to-ir.js";

const COMMIT = "1a2b3c4d5e6f";

function part(ref, pinTypes) {
	const p = {
		id: newId("part"),
		ref,
		value: "X",
		symbol: "Lib:X",
		footprint: "FP:X",
		props: {},
	};
	if (pinTypes) p.pinTypes = pinTypes;
	return p;
}

function irWith(a, b) {
	const net = {
		id: newId("net"),
		name: "SIG",
		pins: [
			{ partId: a.id, pin: "1" },
			{ partId: b.id, pin: "1" },
		],
	};
	return {
		schemaVersion: 1,
		name: "B",
		parts: [a, b],
		nets: [net],
		constraints: [],
	};
}

function pinTypeIssues(issues) {
	return issues.filter((i) => /pin type|driven/.test(i.message));
}

describe("runErc pin-type checks", () => {
	test("two outputs on one net is an error", () => {
		const ir = irWith(part("U1", { 1: "output" }), part("U2", { 1: "output" }));
		const found = pinTypeIssues(runErc(ir, { commit: COMMIT }));
		assert.equal(found.length, 1);
		const [issue] = found;
		assert.equal(issue.severity, "error");
		assert.match(issue.message, /SIG/);
		assert.match(issue.message, /U1\.1/);
		assert.match(issue.message, /U2\.1/);
		assert.equal(issue.commit, COMMIT);
		assert.ok(issue.itemIds.includes(ir.nets[0].id));
		assert.ok(issue.itemIds.includes(ir.parts[0].id));
		assert.equal(validateIssue(issue).ok, true);
	});

	test("output driving an input has no pin-type issue", () => {
		const ir = irWith(part("U1", { 1: "output" }), part("U2", { 1: "input" }));
		assert.deepEqual(pinTypeIssues(runErc(ir, { commit: COMMIT })), []);
	});

	test("power_in with no driver is an error", () => {
		const ir = irWith(
			part("U1", { 1: "power_in" }),
			part("R1", { 1: "passive" }),
		);
		const found = pinTypeIssues(runErc(ir, { commit: COMMIT }));
		assert.equal(found.length, 1);
		assert.equal(found[0].severity, "error");
		assert.match(found[0].message, /power_in not driven/);
		assert.match(found[0].message, /U1\.1/);
	});

	test("same-named outputs of one part are one pin", () => {
		const u1 = part("U1", { 1: "output", 2: "output" });
		u1.pinNames = { 1: "SW", 2: "SW" };
		const ir = irWith(u1, part("L1", { 1: "passive" }));
		ir.nets[0].pins[1] = { partId: u1.id, pin: "2" };
		assert.deepEqual(pinTypeIssues(runErc(ir, { commit: COMMIT })), []);
	});

	test("IR without pinTypes yields the same issues as before", () => {
		const ir = irWith(part("R1"), part("R2"));
		const plain = runErc(ir, { commit: COMMIT }).map((i) => i.message);
		assert.deepEqual(pinTypeIssues(runErc(ir, { commit: COMMIT })), []);
		ir.parts[0].pinTypes = { 1: "passive" };
		ir.parts[1].pinTypes = { 1: "passive" };
		const typed = runErc(ir, { commit: COMMIT }).map((i) => i.message);
		assert.deepEqual(typed, plain);
	});
});

const TYPED_SCH = `(kicad_sch
	(version 20250114)
	(lib_symbols
		(symbol "Reg:LDO"
			(symbol "LDO_1_1"
				(pin power_in line (at -5 0 0) (number "1"))
				(pin power_out line (at 5 0 0) (number "2"))
				(pin weird_type line (at 0 5 0) (number "3"))
			)
		)
	)
	(symbol
		(lib_id "Reg:LDO")
		(at 50 50 0)
		(property "Reference" "U1")
		(property "Value" "LDO")
		(property "Footprint" "SOT-23")
	)
)`;

// Power ports (lib entry has a (power) marker) name their net by Value and,
// like PWR_FLAG (power_out pin), drive it. Global/hierarchical labels and
// sheet pins reach other sheets, so the driver may live elsewhere.
const LIB = `(lib_symbols
	(symbol "Device:R"
		(pin passive line (at -5 0 0) (number "1"))
		(pin passive line (at 5 0 0) (number "2"))
	)
	(symbol "MCU:U"
		(pin power_in line (at -5 0 0) (number "1"))
		(pin input line (at 5 0 0) (number "2"))
	)
	(symbol "power:GND" (power)
		(pin power_in line (at 0 0 270) (number ""))
	)
	(symbol "power:PWR_FLAG" (power)
		(pin power_out line (at 0 0 90) (number "1"))
	)
)`;

function sym(lib, ref, value, at) {
	return `(symbol (lib_id "${lib}") (at ${at} 0)
		(property "Reference" "${ref}") (property "Value" "${value}")
		(property "Footprint" "FP"))`;
}

const sch = (body) => `(kicad_sch (version 20250114) ${LIB} ${body})`;

function importNets(body) {
	const res = kicadSchToIr(sch(body));
	assert.equal(res.ok, true, JSON.stringify(res.errors));
	return res;
}

const notDriven = (ir) => runErc(ir).filter((i) => /driven/.test(i.message));

// Every net is named as listed, is driven, and raises no not-driven issue.
function assertDrivenNets(res, names) {
	const nets = res.ir.nets.map((n) => [n.name, n.driven]).sort();
	assert.deepEqual(
		nets,
		names.map((n) => [n, true]),
	);
	assert.deepEqual(notDriven(res.ir), []);
}

describe("kicadSchToIr power ports, PWR_FLAG and off-sheet links", () => {
	test("power symbols join rail islands by Value and mark the net driven", () => {
		const res = importNets(`
			${sym("MCU:U", "U1", "MCU", "50 50")}
			${sym("Device:R", "R1", "1k", "100 50")}
			${sym("power:GND", "#PWR01", "GND", "45 50")}
			${sym("power:GND", "#PWR02", "GND", "95 50")}`);
		const pinCounts = res.ir.nets.map((n) => n.pins.length);
		assertDrivenNets(res, ["GND"]);
		assert.deepEqual(pinCounts, [2], "U1.1 and R1.1 share GND");
	});

	test("PWR_FLAG marks the net driven", () => {
		const res = importNets(`
			${sym("MCU:U", "U1", "MCU", "50 50")}
			${sym("Device:R", "R1", "1k", "40 50")}
			${sym("power:PWR_FLAG", "#FLG01", "PWR_FLAG", "45 50")}`);
		assertDrivenNets(res, ["Net-(R1-Pad2)"]);
	});

	test("hierarchical label and sheet pin mark nets driven", () => {
		const res = importNets(`
			${sym("MCU:U", "U1", "MCU", "50 50")}
			(hierarchical_label "IN" (shape input) (at 55 50 0))
			(wire (pts (xy 45 50) (xy 30 50)))
			(symbol (lib_id "Device:R") (at 30 50 90)
				(property "Reference" "R1") (property "Value" "1k"))
			(wire (pts (xy 30 50) (xy 30 45)))
			(sheet (at 10 40) (size 10 20)
				(pin "PWR" output (at 20 50 0))
			)
			(wire (pts (xy 20 50) (xy 30 50)))`);
		assertDrivenNets(res, ["IN", "Net-(R1-Pad2)"]);
	});

	test("local-only net stays undriven", () => {
		const res = importNets(`
			${sym("MCU:U", "U1", "MCU", "50 50")}
			(label "LOCAL" (at 55 50 0))`);
		const { nets } = res.ir;
		const seen = [nets.length, nets[0].driven, notDriven(res.ir).length];
		assert.deepEqual(seen, [1, undefined, 1]);
	});
});

function firstPart(text) {
	const res = kicadSchToIr(text);
	assert.equal(res.ok, true, JSON.stringify(res.errors));
	return res.ir.parts[0];
}

describe("kicadSchToIr pin types", () => {
	test("records lib symbol pin electrical types on the part", () => {
		assert.deepEqual(firstPart(TYPED_SCH).pinTypes, {
			1: "power_in",
			2: "power_out",
		});
	});

	test("records pin names, skipping KiCad's unnamed marker ~", () => {
		const named = TYPED_SCH.replace(
			'(number "1")',
			'(name "VIN") (number "1")',
		);
		const text = named.replace('(number "2")', '(name "~") (number "2")');
		assert.deepEqual(firstPart(text).pinNames, { 1: "VIN" });
	});
});
