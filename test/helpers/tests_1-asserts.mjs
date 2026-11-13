import assert from "node:assert/strict";

/** Asserts that every given value is frozen. */
export function assertAllFrozen(...targets) {
	for (const target of targets) {
		assert.equal(Object.isFrozen(target), true);
	}
}
