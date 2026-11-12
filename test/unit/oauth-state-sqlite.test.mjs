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
		assert.equal(store.consume(state), false, "rejected on reuse");
		assert.equal(
			store.consume("unknown-state-xyz"),
			false,
			"rejected on unknown",
		);
		store.close();
	});

	it("rejects expired states on validate and consume", () => {
		const { store, advance } = createClockedStore({ ttlMs: 60_000 });
		const expiryChecks = [
			[(s) => store.validate(s), "expired on validate"],
			[(s) => store.consume(s), "expired on consume"],
		];
		for (const [check, desc] of expiryChecks) {
			const state = store.generate();
			advance(70_000);
			assertRejectedAndCleared(store, () => check(state), desc);
		}
		store.close();
	});

	it("purges expired rows on generate", () => {
		const { store, advance } = createClockedStore({ ttlMs: 60_000 });
		seedStore(store, ["old-1", "old-2"]);
		assert.equal(store.size, 2);
		advance(70_000);
		const fresh = store.generate();
		assert.equal(store.size, 1);
		assert.equal(store.consume(fresh), true);
		store.close();
	});

	const capacityCases = [
		{
			title: "evicts oldest row when full and preserves newer entries",
			maxEntries: 3,
			batches: [
				{ keys: ["state-1", "state-2", "state-3"], expectedSize: 3 },
				{ keys: ["state-4"], expectedSize: 3 },
			],
			consumes: [
				["state-1", false, "oldest evicted"],
				["state-2", true, "newer preserved"],
				["state-3", true, "newer preserved"],
				["state-4", true, "newest preserved"],
			],
		},
		{
			title: "does not evict when updating existing state",
			maxEntries: 2,
			batches: [{ keys: ["state-a", "state-b", "state-a"], expectedSize: 2 }],
			consumes: [
				["state-b", true],
				["state-a", true],
			],
		},
	];

	for (const tc of capacityCases) {
		it(tc.title, () => {
			const { store, tick } = createClockedStore({ maxEntries: tc.maxEntries });
			for (const batch of tc.batches) {
				seedStore(store, batch.keys, tick);
				assert.equal(store.size, batch.expectedSize);
			}
			assertConsumeAll(store, tc.consumes);
			store.close();
		});
	}

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
