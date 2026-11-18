import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const editorScreenSrc = readFileSync(
	new URL("../../frontend/src/editor/EditorScreen.jsx", import.meta.url),
	"utf8",
);

const pureSlice = editorScreenSrc
	.split("// --- PURE TOOLBAR OVERFLOW HELPERS (NO JSX) ---")[1]
	?.split("// --- END PURE TOOLBAR OVERFLOW HELPERS ---")[0];

const {
	DEFAULT_TOOLBAR_PRIORITIES,
	DEFAULT_ITEM_WIDTHS,
	computeToolbarOverflow,
	partitionToolbarItems,
	resolveToolbarOverflow,
} = await import(`data:text/javascript,${encodeURIComponent(pureSlice || "")}`);

function verifyPartition(res, expectedVisible, expectedOverflow) {
	assert.deepEqual(res.visible, expectedVisible);
	assert.deepEqual(res.overflow, expectedOverflow);
}

function verifyInclusions(res, expectedVisible = [], expectedOverflow = []) {
	for (const id of expectedVisible) {
		assert.ok(res.visible.includes(id), `expected ${id} in visible`);
	}
	for (const id of expectedOverflow) {
		assert.ok(res.overflow.includes(id), `expected ${id} in overflow`);
	}
}

describe("DEFAULT_TOOLBAR_PRIORITIES", () => {
	test("keeps Undo, Redo, Add part, Save visible longest", () => {
		const highPri = ["undo", "redo", "addPart", "save"];
		const lowPri = [
			"export",
			"checks",
			"symbolFields",
			"assignFootprints",
			"boardTools",
		];
		for (const h of highPri) {
			for (const l of lowPri) {
				const hVal = DEFAULT_TOOLBAR_PRIORITIES[h];
				const lVal = DEFAULT_TOOLBAR_PRIORITIES[l];
				assert.ok(hVal > lVal, `Expected ${h} (${hVal}) > ${l} (${lVal})`);
			}
		}
	});

	test("export has the lowest priority", () => {
		const exportPri = DEFAULT_TOOLBAR_PRIORITIES.export;
		for (const [key, pri] of Object.entries(DEFAULT_TOOLBAR_PRIORITIES)) {
			if (key !== "export") {
				assert.ok(
					pri >= exportPri,
					`Expected ${key} (${pri}) >= export (${exportPri})`,
				);
			}
		}
	});
});

describe("computeToolbarOverflow - pure partition logic", () => {
	const sampleItems = [
		["undo", 32, 100],
		["redo", 32, 95],
		["addPart", 92, 90],
		["save", 32, 85],
		["symbolFields", 32, 10],
		["checks", 32, 5],
		["export", 92, 1],
	].map(([id, width, priority]) => ({ id, width, priority }));
	const sampleIds = sampleItems.map((it) => it.id);

	test("returns all visible when containerWidth is unconstrained", () => {
		const unconstrainedCases = [null, undefined, Infinity, 800];
		for (const width of unconstrainedCases) {
			const res = computeToolbarOverflow({
				items: sampleItems,
				containerWidth: width,
			});
			verifyPartition(res, sampleIds, []);
		}
	});

	test("moves lowest priority item to overflow when width is constrained", () => {
		const res = computeToolbarOverflow({
			items: sampleItems,
			containerWidth: 350,
			moreWidth: 32,
			gap: 4,
		});
		verifyInclusions(res, ["undo", "save"], ["export"]);
		assert.ok(!res.visible.includes("export"));
	});

	test("collapses items in fixed priority order as width decreases", () => {
		const cases = [
			{ width: 350, expectedOverflow: ["export"] },
			{ width: 300, expectedOverflow: ["checks", "export"] },
			{
				width: 260,
				expectedOverflow: ["symbolFields", "checks", "export"],
			},
		];
		for (const c of cases) {
			const res = computeToolbarOverflow({
				items: sampleItems,
				containerWidth: c.width,
				moreWidth: 32,
				gap: 4,
			});
			assert.deepEqual(res.overflow, c.expectedOverflow);
		}
	});

	test("preserves Undo, Redo, Add part, Save longest at narrow widths", () => {
		const res = computeToolbarOverflow({
			items: sampleItems,
			containerWidth: 260,
			moreWidth: 32,
			gap: 4,
		});
		verifyPartition(
			res,
			["undo", "redo", "addPart", "save"],
			["symbolFields", "checks", "export"],
		);
	});

	test("accounts for moreWidth when overflow occurs", () => {
		const items = [
			["a", 32, 10],
			["b", 32, 20],
			["c", 32, 1],
		].map(([id, width, priority]) => ({ id, width, priority }));
		const res = computeToolbarOverflow({
			items,
			containerWidth: 100,
			moreWidth: 32,
			gap: 4,
		});
		assert.ok(res.overflow.length >= 1);
		assert.ok(res.overflow.includes("c"));
	});

	test("handles extreme constraints gracefully", () => {
		const res = computeToolbarOverflow({
			items: sampleItems,
			containerWidth: 20,
			moreWidth: 32,
			gap: 4,
		});
		verifyPartition(res, [], sampleIds);
	});
});

describe("computeToolbarOverflow - argument shapes and aliases", () => {
	const widthsMap = { undo: 32, redo: 32, export: 92 };
	const prioritiesMap = { undo: 100, redo: 90, export: 1 };

	test("accepts positional arguments and object forms", () => {
		const invocations = [
			computeToolbarOverflow(widthsMap, 120, prioritiesMap, {
				moreWidth: 32,
				gap: 4,
			}),
			computeToolbarOverflow({
				itemWidths: widthsMap,
				containerWidth: 120,
				priorities: prioritiesMap,
			}),
		];
		for (const res of invocations) {
			verifyInclusions(res, ["undo", "redo"], ["export"]);
		}
	});

	test("aliases partitionToolbarItems and resolveToolbarOverflow work identically", () => {
		const opts = {
			itemWidths: widthsMap,
			containerWidth: 120,
			priorities: prioritiesMap,
		};
		const r1 = computeToolbarOverflow(opts);
		assert.deepEqual(r1, partitionToolbarItems(opts));
		assert.deepEqual(r1, resolveToolbarOverflow(opts));
	});

	test("returned object includes aliases for visible and overflow", () => {
		const res = computeToolbarOverflow({
			itemWidths: widthsMap,
			containerWidth: 120,
			priorities: prioritiesMap,
		});
		assert.equal(res.more, res.overflow);
		assert.equal(res.visibleIds, res.visible);
		assert.equal(res.overflowIds, res.overflow);
	});
});

describe("responsive widths (1440, 1280, 1024, narrow)", () => {
	const schematicKeys = Object.keys(DEFAULT_ITEM_WIDTHS).filter(
		(k) => !k.startsWith("board"),
	);
	const schematicItems = schematicKeys.map((id) => ({
		id,
		width: DEFAULT_ITEM_WIDTHS[id],
	}));

	test("all tools fit on standard desktop screens (1440, 1280, 1024)", () => {
		for (const width of [1440, 1280, 1024]) {
			const res = computeToolbarOverflow({
				items: schematicItems,
				containerWidth: width,
			});
			assert.equal(res.overflow.length, 0);
			assert.equal(res.visible.length, schematicItems.length);
		}
	});

	test("at 400 available width, core tools remain visible while low priority collapse", () => {
		const res = computeToolbarOverflow({
			items: schematicItems,
			containerWidth: 400,
		});
		verifyInclusions(res, ["undo", "redo", "save"], ["export", "checks"]);
	});
});
