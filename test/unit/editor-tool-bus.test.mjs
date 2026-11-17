import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	emitActiveTool,
	emitEditorTool,
	onActiveTool,
	onEditorTool,
} from "../../frontend/src/editor/editorToolBus.js";

const BUS_PAIRS = [
	{ name: "editorTool", emit: emitEditorTool, on: onEditorTool },
	{ name: "activeTool", emit: emitActiveTool, on: onActiveTool },
];

const INVALID_CASES = [
	{ name: "undefined payload", payload: undefined },
	{ name: "empty object payload", payload: {} },
	{ name: "missing tab", payload: { tool: "select" } },
	{ name: "invalid tab string", payload: { tab: "other", tool: "select" } },
	{ name: "empty tab", payload: { tab: "", tool: "select" } },
	{ name: "whitespace tab", payload: { tab: "   ", tool: "select" } },
	{ name: "non-string tab", payload: { tab: 123, tool: "select" } },
	{ name: "missing tool", payload: { tab: "schematic" } },
	{ name: "empty tool", payload: { tab: "schematic", tool: "" } },
	{ name: "whitespace tool", payload: { tab: "schematic", tool: "   " } },
	{ name: "non-string tool", payload: { tab: "pcb", tool: 123 } },
	{ name: "null tool", payload: { tab: "pcb", tool: null } },
];

function testInvalidInput(emit, on, payload) {
	let called = false;
	const unsub = on(() => {
		called = true;
	});
	emit(payload);
	unsub();
	assert.equal(called, false);
}

describe("editorToolBus", () => {
	for (const { name, emit, on } of BUS_PAIRS) {
		it(`${name}: delivers valid payload with default null item`, () => {
			const received = [];
			const unsub = on((detail) => received.push(detail));
			emit({ tab: "schematic", tool: "wire" });
			unsub();

			assert.equal(received.length, 1);
			assert.deepEqual(received[0], {
				tab: "schematic",
				tool: "wire",
				item: null,
			});
		});

		it(`${name}: preserves provided item`, () => {
			const received = [];
			const unsub = on((detail) => received.push(detail));
			const item = { partId: "R1", value: "10k" };
			emit({ tab: "pcb", tool: "place", item });
			unsub();

			assert.equal(received.length, 1);
			assert.deepEqual(received[0], {
				tab: "pcb",
				tool: "place",
				item,
			});
		});

		it(`${name}: filters by tab when specified`, () => {
			const received = [];
			const unsub = on((detail) => received.push(detail), "schematic");
			emit({ tab: "pcb", tool: "route" });
			emit({ tab: "schematic", tool: "select" });
			unsub();

			assert.equal(received.length, 1);
			assert.equal(received[0].tab, "schematic");
			assert.equal(received[0].tool, "select");
		});

		it(`${name}: receives all tabs when tab filter is omitted`, () => {
			const received = [];
			const unsub = on((detail) => received.push(detail));
			emit({ tab: "schematic", tool: "wire" });
			emit({ tab: "pcb", tool: "route" });
			unsub();

			assert.equal(received.length, 2);
		});

		it(`${name}: stops delivery after unsubscribe`, () => {
			let count = 0;
			const unsub = on(() => {
				count++;
			});
			emit({ tab: "schematic", tool: "select" });
			assert.equal(count, 1);

			unsub();
			emit({ tab: "schematic", tool: "select" });
			assert.equal(count, 1);
		});

		for (const { name: caseName, payload } of INVALID_CASES) {
			it(`${name}: ignores invalid input (${caseName})`, () => {
				testInvalidInput(emit, on, payload);
			});
		}
	}
});
