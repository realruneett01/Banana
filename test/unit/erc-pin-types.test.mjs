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

describe("kicadSchToIr pin types", () => {
	test("records lib symbol pin electrical types on the part", () => {
		const res = kicadSchToIr(TYPED_SCH);
		assert.equal(res.ok, true, JSON.stringify(res.errors));
		assert.deepEqual(res.ir.parts[0].pinTypes, {
			1: "power_in",
			2: "power_out",
		});
	});
});
