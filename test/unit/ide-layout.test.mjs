import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	ACTIVITIES,
	INITIAL_LAYOUT,
	layoutReducer,
	loadStoredLayout,
	STORAGE_KEY,
	saveStoredLayout,
	TAB_KINDS,
	useIdeLayout,
} from "../../frontend/src/shell/ideLayout.js";

function makeFrozenState(overrides = {}) {
	const base = {
		...INITIAL_LAYOUT,
		tabs: Object.freeze(overrides.tabs ? [...overrides.tabs] : []),
		...overrides,
	};
	return Object.freeze(base);
}

function createTab(id, kind = "schematic", title = `Tab ${id}`) {
	return Object.freeze({ id, kind, title, params: {} });
}

describe("ideLayout constants", () => {
	it("exports INITIAL_LAYOUT with correct defaults", () => {
		assert.deepEqual(INITIAL_LAYOUT, {
			activity: "explorer",
			sidebarOpen: true,
			auxOpen: true,
			auxTab: "ai",
			bottomOpen: false,
			bottomTab: "problems",
			tabs: [],
			activeTabId: null,
		});
	});

	it("exports ACTIVITIES in expected order with label and shortcut", () => {
		const expected = [
			["explorer", "Ctrl+Shift+E"],
			["search", "Ctrl+Shift+F"],
			["scm", "Ctrl+Shift+G"],
			["library", "Ctrl+Shift+L"],
			["simulation", "Ctrl+Shift+S"],
			["ai", "Ctrl+Shift+A"],
		];
		assert.equal(ACTIVITIES.length, expected.length);
		expected.forEach(([id, shortcut], idx) => {
			assert.equal(ACTIVITIES[idx].id, id);
			assert.equal(ACTIVITIES[idx].shortcut, shortcut);
			assert.ok(typeof ACTIVITIES[idx].label === "string");
			assert.ok(ACTIVITIES[idx].label.length > 0);
		});
	});

	it("exports all 9 required tab kinds", () => {
		const kinds = [
			"welcome",
			"schematic",
			"pcb",
			"3d",
			"holo",
			"diff",
			"fields",
			"footprints",
			"settings",
		];
		assert.deepEqual([...TAB_KINDS], kinds);
	});
});

describe("layoutReducer - activity and sidebars", () => {
	const TOGGLE_CASES = [
		["toggleSidebar", "sidebarOpen", true, false],
		["toggleAux", "auxOpen", true, false],
		["toggleBottom", "bottomOpen", false, true],
	];

	TOGGLE_CASES.forEach(([actionType, field, before, after]) => {
		it(`handles ${actionType}`, () => {
			const s1 = makeFrozenState({ [field]: before });
			const s2 = layoutReducer(s1, { type: actionType });
			assert.equal(s2[field], after);
			const s3 = layoutReducer(s2, { type: actionType });
			assert.equal(s3[field], before);
		});
	});

	const ACTIVITY_CASES = [
		{
			title: "switches activity and opens sidebar",
			start: { activity: "explorer", sidebarOpen: false },
			id: "search",
			exp: { act: "search", open: true },
		},
		{
			title: "toggles sidebarOpen when clicking active activity",
			start: { activity: "explorer", sidebarOpen: true },
			id: "explorer",
			exp: { act: "explorer", open: false },
		},
		{
			title: "re-opens sidebarOpen when clicking active activity while closed",
			start: { activity: "explorer", sidebarOpen: false },
			id: "explorer",
			exp: { act: "explorer", open: true },
		},
	];

	ACTIVITY_CASES.forEach(({ title, start, id, exp }) => {
		it(title, () => {
			const res = layoutReducer(makeFrozenState(start), {
				type: "setActivity",
				id,
			});
			assert.deepEqual({ act: res.activity, open: res.sidebarOpen }, exp);
		});
	});

	it("updates auxTab via setAuxTab", () => {
		const s1 = makeFrozenState({ auxTab: "ai" });
		const s2 = layoutReducer(s1, { type: "setAuxTab", id: "docs" });
		assert.equal(s2.auxTab, "docs");
	});

	it("sets bottomTab and opens bottom panel via setBottomTab", () => {
		const s1 = makeFrozenState({ bottomTab: "problems", bottomOpen: false });
		const s2 = layoutReducer(s1, { type: "setBottomTab", id: "terminal" });
		assert.deepEqual(
			{ tab: s2.bottomTab, open: s2.bottomOpen },
			{ tab: "terminal", open: true },
		);
	});
});

describe("layoutReducer - tabs", () => {
	const OPEN_CASES = [
		{
			desc: "opens first tab",
			initial: [],
			tab: createTab("t1"),
			expected: { count: 1, active: "t1" },
		},
		{
			desc: "opens second tab",
			initial: [createTab("t1")],
			tab: createTab("t2"),
			expected: { count: 2, active: "t2" },
		},
		{
			desc: "re-opens existing tab only activates it",
			initial: [createTab("t1"), createTab("t2")],
			tab: createTab("t1"),
			expected: { count: 2, active: "t1" },
		},
	];

	OPEN_CASES.forEach(({ desc, initial, tab, expected }) => {
		it(desc, () => {
			const state = makeFrozenState({ tabs: initial, activeTabId: "t2" });
			const next = layoutReducer(state, { type: "openTab", tab });
			assert.deepEqual(
				{ count: next.tabs.length, active: next.activeTabId },
				expected,
			);
		});
	});

	const CLOSE_CASES = [
		{
			desc: "activates right neighbour when middle tab closed",
			tabs: ["a", "b", "c"],
			active: "b",
			close: "b",
			expected: { active: "c", remaining: ["a", "c"] },
		},
		{
			desc: "activates right neighbour when first tab closed",
			tabs: ["a", "b", "c"],
			active: "a",
			close: "a",
			expected: { active: "b", remaining: ["b", "c"] },
		},
		{
			desc: "activates left neighbour when last tab closed",
			tabs: ["a", "b", "c"],
			active: "c",
			close: "c",
			expected: { active: "b", remaining: ["a", "b"] },
		},
		{
			desc: "activates null when sole tab closed",
			tabs: ["a"],
			active: "a",
			close: "a",
			expected: { active: null, remaining: [] },
		},
		{
			desc: "preserves active tab when closing an inactive tab",
			tabs: ["a", "b", "c"],
			active: "a",
			close: "b",
			expected: { active: "a", remaining: ["a", "c"] },
		},
	];

	CLOSE_CASES.forEach(({ desc, tabs, active, close, expected }) => {
		it(`closeTab: ${desc}`, () => {
			const s0 = makeFrozenState({
				tabs: tabs.map((id) => createTab(id)),
				activeTabId: active,
			});
			const s1 = layoutReducer(s0, { type: "closeTab", id: close });
			assert.deepEqual(
				{ active: s1.activeTabId, remaining: s1.tabs.map((t) => t.id) },
				expected,
			);
		});
	});

	it("activateTab switches active tab if tab exists", () => {
		const s0 = makeFrozenState({
			tabs: [createTab("a"), createTab("b")],
			activeTabId: "a",
		});
		const s1 = layoutReducer(s0, { type: "activateTab", id: "b" });
		assert.equal(s1.activeTabId, "b");

		const s2 = layoutReducer(s1, { type: "activateTab", id: "missing" });
		assert.equal(s2.activeTabId, "b");
	});

	const MOVE_CASES = [
		{ from: "a", toIndex: 2, expected: ["b", "c", "a"] },
		{ from: "c", toIndex: 0, expected: ["c", "a", "b"] },
		{ from: "b", toIndex: 1, expected: ["a", "b", "c"] },
		{ from: "a", toIndex: 99, expected: ["b", "c", "a"] },
		{ from: "c", toIndex: -10, expected: ["c", "a", "b"] },
	];

	MOVE_CASES.forEach(({ from, toIndex, expected }) => {
		it(`moveTab moves ${from} to index ${toIndex}`, () => {
			const s0 = makeFrozenState({
				tabs: [createTab("a"), createTab("b"), createTab("c")],
				activeTabId: "a",
			});
			const s1 = layoutReducer(s0, { type: "moveTab", id: from, toIndex });
			assert.deepEqual(
				{ tabs: s1.tabs.map((t) => t.id), active: s1.activeTabId },
				{ tabs: expected, active: "a" },
			);
		});
	});

	it("never mutates incoming state", () => {
		const initial = makeFrozenState({
			tabs: [createTab("a")],
			activeTabId: "a",
		});
		assert.doesNotThrow(() => {
			layoutReducer(initial, { type: "toggleSidebar" });
			layoutReducer(initial, { type: "openTab", tab: createTab("b") });
			layoutReducer(initial, { type: "closeTab", id: "a" });
		});
	});
});

describe("localStorage persistence and useIdeLayout", () => {
	const mockStorage = new Map();
	const fakeStorage = {
		getItem: (k) => mockStorage.get(k) ?? null,
		setItem: (k, v) => mockStorage.set(k, String(v)),
		removeItem: (k) => mockStorage.delete(k),
		clear: () => mockStorage.clear(),
	};

	beforeEach(() => {
		mockStorage.clear();
		globalThis.localStorage = fakeStorage;
	});

	it("saveStoredLayout writes layout fields to localStorage", () => {
		saveStoredLayout({
			sidebarOpen: false,
			auxOpen: false,
			bottomOpen: true,
			activity: "scm",
		});
		const raw = fakeStorage.getItem(STORAGE_KEY);
		assert.deepEqual(JSON.parse(raw), {
			sidebarOpen: false,
			auxOpen: false,
			bottomOpen: true,
			activity: "scm",
		});
	});

	it("loadStoredLayout restores stored layout fields safely", () => {
		fakeStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				sidebarOpen: false,
				auxOpen: false,
				bottomOpen: true,
				activity: "library",
			}),
		);
		const { sidebarOpen, auxOpen, bottomOpen, activity } =
			loadStoredLayout(INITIAL_LAYOUT);
		assert.deepEqual(
			{ sidebarOpen, auxOpen, bottomOpen, activity },
			{
				sidebarOpen: false,
				auxOpen: false,
				bottomOpen: true,
				activity: "library",
			},
		);
	});

	it("loadStoredLayout handles corrupted storage gracefully", () => {
		fakeStorage.setItem(STORAGE_KEY, "invalid-json{{{");
		const loaded = loadStoredLayout(INITIAL_LAYOUT);
		assert.deepEqual(loaded, INITIAL_LAYOUT);
	});

	it("useIdeLayout hook initializes and renders with useReducer", () => {
		let hookState = null;
		function TestComponent() {
			const [state] = useIdeLayout();
			hookState = state;
			return createElement("div", { "data-activity": state.activity });
		}
		const html = renderToString(createElement(TestComponent));
		assert.ok(html.includes("data-activity"));
		assert.equal(hookState?.activity, "explorer");
	});
});
