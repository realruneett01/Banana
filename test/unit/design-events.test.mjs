import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	emitCommitCreated,
	onCommitCreated,
} from "../../frontend/src/designEvents.js";

describe("designEvents", () => {
	it("delivers commit-created detail to subscribed handler", () => {
		const received = [];
		const unsub = onCommitCreated((detail) => received.push(detail));
		const payload = {
			repoPath: "/repo/path",
			filePath: "board.kicad_pcb",
			commit: "c0ffee1",
		};
		emitCommitCreated(payload);
		unsub();

		assert.equal(received.length, 1);
		assert.deepEqual(received[0], payload);
	});

	it("stops delivery after unsubscribe", () => {
		let callCount = 0;
		const unsub = onCommitCreated(() => {
			callCount++;
		});
		emitCommitCreated({ repoPath: "/repo/path", commit: "c0ffee2" });
		assert.equal(callCount, 1);

		unsub();
		emitCommitCreated({ repoPath: "/repo/path", commit: "c0ffee3" });
		assert.equal(callCount, 1);
	});

	const INVALID_CASES = [
		{ name: "missing commit", payload: { repoPath: "/repo/path" } },
		{
			name: "empty commit",
			payload: { repoPath: "/repo/path", commit: "" },
		},
		{
			name: "whitespace commit",
			payload: { repoPath: "/repo/path", commit: "   " },
		},
		{
			name: "non-string commit",
			payload: { repoPath: "/repo/path", commit: 123 },
		},
		{ name: "missing repoPath", payload: { commit: "c0ffee" } },
		{
			name: "empty repoPath",
			payload: { repoPath: "", commit: "c0ffee" },
		},
		{
			name: "whitespace repoPath",
			payload: { repoPath: "   ", commit: "c0ffee" },
		},
		{
			name: "non-string repoPath",
			payload: { repoPath: null, commit: "c0ffee" },
		},
		{ name: "empty object payload", payload: {} },
		{ name: "undefined payload", payload: undefined },
	];

	for (const { name, payload } of INVALID_CASES) {
		it(`ignores invalid input: ${name}`, () => {
			let called = false;
			const unsub = onCommitCreated(() => {
				called = true;
			});
			emitCommitCreated(payload);
			unsub();
			assert.equal(called, false);
		});
	}
});
