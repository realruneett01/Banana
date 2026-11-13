import assert from "node:assert/strict";
import { test } from "node:test";
import { NETLIST_LIMITS } from "../../backend/src/engine/spice/ngspice-runner.js";

test("NETLIST_LIMITS cannot be loosened at runtime", () => {
	for (const value of [
		NETLIST_LIMITS,
		NETLIST_LIMITS.forbiddenPrefixes,
		NETLIST_LIMITS.forbiddenSubstrings,
	]) {
		assert.ok(Object.isFrozen(value));
	}
	assert.throws(() => {
		NETLIST_LIMITS.forbiddenPrefixes.pop();
	}, TypeError);
});
