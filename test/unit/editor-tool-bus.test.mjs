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

const DELIVERY_CASES = [
	{
		title: "delivers valid payload with default null item",
		payload: { tab: "schematic", tool: "wire" },
		expected: { tab: "schematic", tool: "wire", item: null },
	},
	{
		title: "preserves provided item",
		payload: {
			tab: "pcb",
			tool: "place",
			item: { partId: "R1", value: "10k" },
		},
		expected: {
			tab: "pcb",
			tool: "place",
			item: { partId: "R1", value: "10k" },
		},
	},
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

function recordEvents(on, emitFn, filter) {
	const received = [];
	const unsub = on((detail) => received.push(detail), filter);
	emitFn();
	unsub();
	return received;
}

function assertDelivered(received, expected) {
	assert.equal(received.length, 1);
	assert.deepEqual(received[0], expected);
}

function assertFiltered(received, tab, tool) {
	assert.equal(received.length, 1);
	assert.equal(received[0].tab, tab);
	assert.equal(received[0].tool, tool);
}

function verifyUnsubscribe(on, emit) {
	let deliveryCount = 0;
	const unsub = on(() => {
		deliveryCount += 1;
	});
	emit({ tab: "schematic", tool: "select" });
	assert.equal(deliveryCount, 1);

	unsub();
	emit({ tab: "schematic", tool: "select" });
	assert.equal(deliveryCount, 1);
}

function testInvalidInput(emit, on, payload) {
	const received = recordEvents(on, () => emit(payload));
	assert.equal(received.length, 0);
}

describe("editorToolBus", () => {
	for (const { name, emit, on } of BUS_PAIRS) {
		for (const { title, payload, expected } of DELIVERY_CASES) {
			it(`${name}: ${title}`, () => {
				const received = recordEvents(on, () => emit(payload));
				assertDelivered(received, expected);
			});
		}

		it(`${name}: filters by tab when specified`, () => {
			const received = recordEvents(
				on,
				() => {
					emit({ tab: "pcb", tool: "route" });
					emit({ tab: "schematic", tool: "select" });
				},
				"schematic",
			);
			assertFiltered(received, "schematic", "select");
		});

		it(`${name}: receives all tabs when tab filter is omitted`, () => {
			const received = recordEvents(on, () => {
				emit({ tab: "schematic", tool: "wire" });
				emit({ tab: "pcb", tool: "route" });
			});
			assert.equal(received.length, 2);
		});

		it(`${name}: stops delivery after unsubscribe`, () => {
			verifyUnsubscribe(on, emit);
		});

		for (const { name: caseName, payload } of INVALID_CASES) {
			it(`${name}: ignores invalid input (${caseName})`, () => {
				testInvalidInput(emit, on, payload);
			});
		}
	}
});
