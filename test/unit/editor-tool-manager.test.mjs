import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createToolManager } from "../../frontend/src/editor/toolManager.js";

test("default active: selects default tool on creation", () => {
	const manager = createToolManager({
		tools: [{ id: "select" }, { id: "wire" }],
	});
	assert.equal(manager.activeId(), "select");

	const customManager = createToolManager({
		tools: [{ id: "route" }],
		defaultTool: "route",
	});
	assert.equal(customManager.activeId(), "route");
});

test("activate unknown false: returns false and keeps active tool", () => {
	const manager = createToolManager({
		tools: [{ id: "select" }],
	});
	assert.equal(manager.activate("unknown"), false);
	assert.equal(manager.activeId(), "select");
});

test("lifecycle order deactivate then activate: handles transitions and no-op", () => {
	const order = [];
	const selectTool = {
		id: "select",
		onDeactivate: (ctx) => order.push(["select:deactivate", ctx]),
	};
	const wireTool = {
		id: "wire",
		onActivate: (ctx) => order.push(["wire:activate", ctx]),
	};
	const ctx = { editor: true };
	const manager = createToolManager({
		tools: [selectTool, wireTool],
		ctx,
	});

	assert.equal(manager.activate("wire"), true);
	assert.equal(manager.activeId(), "wire");
	assert.deepEqual(order, [
		["select:deactivate", ctx],
		["wire:activate", ctx],
	]);

	assert.equal(manager.activate("wire"), true);
	assert.equal(order.length, 2);
});

describe("cancel semantics", () => {
	test("cancel from non-default calls onCancel and switches to default tool", () => {
		const order = [];
		const selectTool = {
			id: "select",
			onActivate: () => order.push("select:activate"),
		};
		const wireTool = {
			id: "wire",
			onDeactivate: () => order.push("wire:deactivate"),
			onCancel: (ctx) => order.push(["wire:cancel", ctx]),
		};
		const ctx = { doc: "schematic" };
		const manager = createToolManager({
			tools: [selectTool, wireTool],
			ctx,
		});
		manager.activate("wire");
		order.length = 0;

		assert.equal(manager.cancel(), true);
		assert.equal(manager.activeId(), "select");
		assert.deepEqual(order, [
			["wire:cancel", ctx],
			"wire:deactivate",
			"select:activate",
		]);
	});

	test("cancel from default calls onCancel and returns false", () => {
		let cancelledWith = null;
		const selectTool = {
			id: "select",
			onCancel: (ctx) => {
				cancelledWith = ctx;
			},
		};
		const ctx = { doc: "pcb" };
		const manager = createToolManager({
			tools: [selectTool],
			ctx,
		});

		assert.equal(manager.cancel(), false);
		assert.equal(manager.activeId(), "select");
		assert.equal(cancelledWith, ctx);
	});
});

describe("subscribe and unsubscribe", () => {
	test("listener receives tool changes until unsubscribed", () => {
		const seen = [];
		const manager = createToolManager({
			tools: [{ id: "select" }, { id: "wire" }, { id: "route" }],
		});
		const unsubscribe = manager.subscribe((id) => seen.push(id));

		manager.activate("wire");
		manager.activate("route");
		unsubscribe();
		manager.activate("select");

		assert.deepEqual(seen, ["wire", "route"]);
	});
});

describe("cursor fallback", () => {
	test("returns tool cursor or default string", () => {
		const manager = createToolManager({
			tools: [{ id: "select" }, { id: "cross", cursor: "crosshair" }],
		});
		assert.equal(manager.cursor(), "default");

		manager.activate("cross");
		assert.equal(manager.cursor(), "crosshair");
	});
});

const FORWARDING_METHODS = [
	{
		method: "pointerDown",
		handlerName: "onPointerDown",
		args: [{ x: 10, y: 20 }, { button: 0 }],
	},
	{
		method: "pointerMove",
		handlerName: "onPointerMove",
		args: [{ x: 30, y: 40 }, { buttons: 1 }],
	},
	{
		method: "pointerUp",
		handlerName: "onPointerUp",
		args: [{ x: 50, y: 60 }, { button: 0 }],
	},
	{
		method: "key",
		handlerName: "onKey",
		args: ["ctrl+s", { key: "s", ctrlKey: true }],
	},
];

describe("forwarding methods", () => {
	for (const { method, handlerName, args } of FORWARDING_METHODS) {
		test(`${method}: forwards args and returns true on consumed`, () => {
			const recorded = [];
			const customTool = {
				id: "custom",
				[handlerName]: (ctx, ...handlerArgs) => {
					recorded.push({ ctx, handlerArgs });
					return "consumed";
				},
			};
			const ctx = { editor: 42 };
			const manager = createToolManager({
				tools: [{ id: "select" }, customTool],
				ctx,
			});
			manager.activate("custom");

			assert.equal(manager[method](...args), true);
			assert.equal(manager.activeId(), "custom");
			assert.deepEqual(recorded, [{ ctx, handlerArgs: args }]);
		});

		test(`${method}: activates default tool and returns true on done`, () => {
			const customTool = {
				id: "custom",
				[handlerName]: () => "done",
			};
			const manager = createToolManager({
				tools: [{ id: "select" }, customTool],
			});
			manager.activate("custom");

			assert.equal(manager[method](...args), true);
			assert.equal(manager.activeId(), "select");
		});

		test(`${method}: returns false on undefined return or missing handler`, () => {
			const emptyTool = { id: "empty" };
			const noopTool = { id: "noop", [handlerName]: () => undefined };
			const manager = createToolManager({
				tools: [{ id: "select" }, emptyTool, noopTool],
			});

			manager.activate("empty");
			assert.equal(manager[method](...args), false);

			manager.activate("noop");
			assert.equal(manager[method](...args), false);
		});
	}
});
