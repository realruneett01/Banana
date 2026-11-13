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

/** V1 (5 V) driving one or two loads in series; midName names the net between two loads. */
function chain(midName, ...loads) {
	const v1 = part("V1", "5");
	const first = loads[0];
	const last = loads.at(-1);
	const nets = [net("in", pin(v1, "1"), pin(first, "1"))];
	if (midName) nets.push(net(midName, pin(first, "2"), pin(last, "1")));
	nets.push(net("GND", pin(v1, "2"), pin(last, "2")));
	return ir([v1, ...loads], nets);
}

const rc = () => chain("out", part("R1", "1k"), part("C1", "1u"));
const led = () =>
	chain("a", part("R1", "330"), part("D1", "red", "Device:LED"));
const capOnly = () => chain(null, part("C1", "1u"));

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
