import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { irToSpice } from "../../backend/src/engine/spice/ir-to-spice.js";

const part = (ref, value, symbol) => ({
	id: newId("part"),
	ref,
	value,
	symbol: symbol ?? `Device:${ref.replace(/\d+$/, "")}`,
	footprint: "",
	props: {},
});
const pin = (p, n) => ({ partId: p.id, pin: n });
const net = (name, ...pins) => ({ id: newId("net"), name, pins });
const ir = (parts, nets) => ({
	schemaVersion: 1,
	name: "Save",
	parts,
	nets,
	constraints: [],
});

function rc() {
	const v1 = part("V1", "5");
	const r1 = part("R1", "1k");
	const c1 = part("C1", "1u");
	return ir(
		[v1, r1, c1],
		[
			net("in", pin(v1, "1"), pin(r1, "1")),
			net("out", pin(r1, "2"), pin(c1, "1")),
			net("GND", pin(v1, "2"), pin(c1, "2")),
		],
	);
}

function led() {
	const v1 = part("V1", "5");
	const r1 = part("R1", "330");
	const d1 = part("D1", "red", "Device:LED");
	return ir(
		[v1, r1, d1],
		[
			net("in", pin(v1, "1"), pin(r1, "1")),
			net("a", pin(r1, "2"), pin(d1, "1")),
			net("GND", pin(v1, "2"), pin(d1, "2")),
		],
	);
}

function capOnly() {
	const v1 = part("V1", "5");
	const c1 = part("C1", "1u");
	return ir(
		[v1, c1],
		[
			net("in", pin(v1, "1"), pin(c1, "1")),
			net("GND", pin(v1, "2"), pin(c1, "2")),
		],
	);
}

const saveLineOf = (res) =>
	res.netlist.split("\n").find((l) => l.startsWith(".save"));

describe("irToSpice .save line", () => {
	const cases = [
		["RC circuit", rc, ".save all @r1[i]"],
		["LED circuit", led, ".save all @r1[i] @d1[id]"],
		["no R or D", capOnly, ".save all"],
	];
	for (const [name, build, expected] of cases) {
		test(name, () => {
			const res = irToSpice(build());
			assert.equal(res.ok, true);
			assert.equal(saveLineOf(res), expected);
			assert.equal(res.netlist.includes("*["), false);
		});
	}
});
