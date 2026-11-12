import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
	createSqliteStateStore,
	SqliteStateStore,
} from "../../backend/src/oauth-state-sqlite.js";

function assertValidStateToken(token) {
	assert.equal(typeof token, "string");
	assert.equal(token.length, 32);
	assert.match(token, /^[0-9a-f]{32}$/);
}

function createClockedStore(options = {}) {
	let currentTime = 1_000_000;
	const store = createSqliteStateStore({
		filename: ":memory:",
		now: () => currentTime,
		...options,
	});
	return {
		store,
		advance: (ms) => {
			currentTime += ms;
			return currentTime;
		},
		tick: () => currentTime++,
	};
}

function seedStore(store, keys, tick) {
	for (const key of keys) {
		store.set(key, tick ? tick() : undefined);
	}
}

function assertConsumeAll(store, cases) {
	for (const [key, expected, desc] of cases) {
		assert.equal(store.consume(key), expected, desc);
	}
}

function assertValidAndConsumed(store, state, options = {}) {
	assert.equal(store.validate(state), true, options.validMsg);
	assert.equal(store.consume(state), true, options.consumeMsg);
	assert.equal(store.size, 0);
}

function assertRejectedAndCleared(store, checkFn, desc) {
	assert.equal(checkFn(), false, desc);
	assert.equal(store.size, 0);
}

function assertInvalidInputRejected(store, val) {
	assert.equal(store.validate(val), false);
	assert.equal(store.consume(val), false);
	store.set(val);
	assert.equal(store.size, 0);
}

describe("SqliteStateStore", () => {
	it("issues 32-character hex state", () => {
		const store = new SqliteStateStore({ filename: ":memory:" });
		const state = store.generate();
		assertValidStateToken(state);
		assert.equal(store.size, 1);
		store.close();
	});

	it("accepts state once, rejects on reuse or unknown", () => {
		const store = createSqliteStateStore({ filename: ":memory:" });
		const state = store.generate();
		assert.equal(store.size, 1);
		assertValidAndConsumed(store, state, {
			validMsg: "valid before consume",
			consumeMsg: "first consume accepted",
		});
		assertConsumeAll(store, [
			[state, false, "rejected on reuse"],
			["unknown-state-xyz", false, "rejected on unknown"],
		]);
		store.close();
	});

	it("rejects expired states on validate and consume", () => {
		const { store, advance } = createClockedStore({ ttlMs: 60_000 });
		const state1 = store.generate();
		advance(70_000);
		assertRejectedAndCleared(
			store,
			() => store.validate(state1),
			"expired on validate",
		);

		const state2 = store.generate();
		advance(70_000);
		assertRejectedAndCleared(
			store,
			() => store.consume(state2),
			"expired on consume",
		);
		store.close();
	});

	it("purges expired rows on generate", () => {
		const { store, advance } = createClockedStore({ ttlMs: 60_000 });
		seedStore(store, ["old-1", "old-2"]);
		assert.equal(store.size, 2);
		advance(70_000);
		const fresh = store.generate();
		assert.equal(store.size, 1);
		assertConsumeAll(store, [[fresh, true]]);
		store.close();
	});

	it("evicts oldest row when full and preserves newer entries", () => {
		const { store, tick } = createClockedStore({ maxEntries: 3 });
		seedStore(store, ["state-1", "state-2", "state-3"], tick);
		assert.equal(store.size, 3);
		seedStore(store, ["state-4"], tick);
		assert.equal(store.size, 3);

		assertConsumeAll(store, [
			["state-1", false, "oldest evicted"],
			["state-2", true, "newer preserved"],
			["state-3", true, "newer preserved"],
			["state-4", true, "newest preserved"],
		]);
		store.close();
	});

	it("does not evict when updating existing state", () => {
		const { store, tick } = createClockedStore({ maxEntries: 2 });
		seedStore(store, ["state-a", "state-b", "state-a"], tick);
		assert.equal(store.size, 2);
		assertConsumeAll(store, [
			["state-b", true],
			["state-a", true],
		]);
		store.close();
	});

	const invalidInputs = [
		{ label: "null", value: null },
		{ label: "number", value: 12345 },
		{ label: "empty string", value: "" },
	];
	for (const tc of invalidInputs) {
		it(`rejects invalid input: ${tc.label}`, () => {
			const store = createSqliteStateStore({ filename: ":memory:" });
			assertInvalidInputRejected(store, tc.value);
			store.close();
		});
	}

	it("clears all states", () => {
		const store = createSqliteStateStore({ filename: ":memory:" });
		seedStore(store, ["state-1", "state-2"]);
		assert.equal(store.size, 2);
		store.clear();
		assert.equal(store.size, 0);
		store.close();
	});

	describe("persistence across instances", () => {
		const dbPath = path.join(
			os.tmpdir(),
			`banana-oauth-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
		);

		after(() => {
			fs.rmSync(dbPath, { force: true });
		});

		it("persists states across two store instances on the same file", () => {
			const openStore = () =>
				createSqliteStateStore({ filename: dbPath, ttlMs: 60_000 });

			const store1 = openStore();
			const state = store1.generate();
			assert.equal(store1.size, 1);
			store1.close();

			const store2 = openStore();
			assert.equal(store2.size, 1);
			assertValidAndConsumed(store2, state);
			store2.close();
		});
	});
});
