import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
	createSqliteStateStore,
	SqliteStateStore,
} from "../../backend/src/oauth-state-sqlite.js";

describe("SqliteStateStore", () => {
	it("issues 32-character hex state", () => {
		const store = new SqliteStateStore({ filename: ":memory:" });
		const state = store.generate();
		assert.equal(typeof state, "string");
		assert.equal(state.length, 32);
		assert.match(state, /^[0-9a-f]{32}$/);
		assert.equal(store.size, 1);
		store.close();
	});

	it("accepts state once, rejects on reuse or unknown", () => {
		const store = createSqliteStateStore({ filename: ":memory:" });
		const state = store.generate();
		assert.equal(store.validate(state), true, "valid before consume");
		assert.equal(store.size, 1);
		assert.equal(store.consume(state), true, "first consume accepted");
		assert.equal(store.size, 0);
		assert.equal(store.consume(state), false, "rejected on reuse");
		assert.equal(
			store.consume("unknown-state-xyz"),
			false,
			"rejected on unknown",
		);
		store.close();
	});

	it("rejects expired states on validate and consume", () => {
		let nowTime = 1_000_000;
		const store = createSqliteStateStore({
			filename: ":memory:",
			ttlMs: 60_000,
			now: () => nowTime,
		});
		const state1 = store.generate();
		nowTime += 70_000;
		assert.equal(store.validate(state1), false, "expired on validate");
		assert.equal(store.size, 0, "validate deleted expired state");

		const state2 = store.generate();
		nowTime += 70_000;
		assert.equal(store.consume(state2), false, "expired on consume");
		assert.equal(store.size, 0);
		store.close();
	});

	it("purges expired rows on generate", () => {
		let nowTime = 1_000_000;
		const store = createSqliteStateStore({
			filename: ":memory:",
			ttlMs: 60_000,
			now: () => nowTime,
		});
		store.set("old-1");
		store.set("old-2");
		assert.equal(store.size, 2);
		nowTime += 70_000;
		const fresh = store.generate();
		assert.equal(store.size, 1);
		assert.equal(store.consume(fresh), true);
		store.close();
	});

	it("evicts oldest row when full and preserves newer entries", () => {
		let nowTime = 1_000_000;
		const store = createSqliteStateStore({
			filename: ":memory:",
			maxEntries: 3,
			now: () => nowTime,
		});
		store.set("state-1", nowTime++);
		store.set("state-2", nowTime++);
		store.set("state-3", nowTime++);
		assert.equal(store.size, 3);
		store.set("state-4", nowTime++);
		assert.equal(store.size, 3);

		const evictionCases = [
			["state-1", false, "oldest evicted"],
			["state-2", true, "newer preserved"],
			["state-3", true, "newer preserved"],
			["state-4", true, "newest preserved"],
		];
		for (const [key, expected, desc] of evictionCases) {
			assert.equal(store.consume(key), expected, desc);
		}
		store.close();
	});

	it("does not evict when updating existing state", () => {
		let nowTime = 1_000_000;
		const store = createSqliteStateStore({
			filename: ":memory:",
			maxEntries: 2,
			now: () => nowTime,
		});
		store.set("state-a", nowTime++);
		store.set("state-b", nowTime++);
		store.set("state-a", nowTime++);
		assert.equal(store.size, 2);
		assert.equal(store.consume("state-b"), true);
		assert.equal(store.consume("state-a"), true);
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
			assert.equal(store.validate(tc.value), false);
			assert.equal(store.consume(tc.value), false);
			store.set(tc.value);
			assert.equal(store.size, 0);
			store.close();
		});
	}

	it("clears all states", () => {
		const store = createSqliteStateStore({ filename: ":memory:" });
		store.set("state-1");
		store.set("state-2");
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
			try {
				if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
			} catch (_err) {
				// Cleanup failure ignored in temp directory
			}
		});

		it("persists states across two store instances on the same file", () => {
			const store1 = createSqliteStateStore({
				filename: dbPath,
				ttlMs: 60_000,
			});
			const state = store1.generate();
			assert.equal(store1.size, 1);
			store1.close();

			const store2 = createSqliteStateStore({
				filename: dbPath,
				ttlMs: 60_000,
			});
			assert.equal(store2.size, 1);
			assert.equal(store2.validate(state), true);
			assert.equal(store2.consume(state), true);
			assert.equal(store2.size, 0);
			store2.close();
		});
	});
});
