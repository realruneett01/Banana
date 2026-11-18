import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	breadcrumb,
	createNavState,
	enterSheet,
	jumpTo,
	leaveSheet,
	sheetTree,
} from "../../frontend/src/editor/sheetNav.js";

const src = (rel) =>
	readFileSync(new URL(`../../frontend/src/${rel}`, import.meta.url), "utf8");

describe("sheetNav navigation state", () => {
	test("createNavState initializes stack with root sheet", () => {
		const nav1 = createNavState();
		assert.equal(nav1.stack.length, 1);
		assert.equal(nav1.stack[0].name, "Root");
		assert.equal(nav1.stack[0].file, "");
		assert.equal(nav1.stack[0].path, "/Root");

		const nav2 = createNavState("MainBoard");
		assert.equal(nav2.stack.length, 1);
		assert.equal(nav2.stack[0].name, "MainBoard");
		assert.equal(nav2.stack[0].path, "/MainBoard");
	});

	test("enterSheet pushes subsheets and formats path", () => {
		const initial = createNavState("Top");
		const sheet1 = { id: "sheet-1", name: "Power", file: "power.kicad_sch" };
		const s1 = enterSheet(initial, sheet1);

		assert.equal(s1.stack.length, 2);
		assert.equal(s1.stack[1].name, "Power");
		assert.equal(s1.stack[1].file, "power.kicad_sch");
		assert.equal(s1.stack[1].path, "/Top/Power");
		assert.equal(s1.stack[1].id, "sheet-1");
		// purity check
		assert.equal(initial.stack.length, 1);

		const sheet2 = { id: "sheet-2", name: "Regulator", file: "reg.kicad_sch" };
		const s2 = enterSheet(s1, sheet2);
		assert.equal(s2.stack.length, 3);
		assert.equal(s2.stack[2].name, "Regulator");
		assert.equal(s2.stack[2].path, "/Top/Power/Regulator");
	});

	test("leaveSheet pops top sheet and never drops below root", () => {
		const initial = createNavState("Root");
		const s1 = enterSheet(initial, { name: "Sheet1", file: "s1.kicad_sch" });
		const s2 = enterSheet(s1, { name: "Sheet2", file: "s2.kicad_sch" });

		const popped1 = leaveSheet(s2);
		assert.equal(popped1.stack.length, 2);
		assert.equal(popped1.stack[1].name, "Sheet1");
		assert.equal(s2.stack.length, 3); // purity

		const popped2 = leaveSheet(popped1);
		assert.equal(popped2.stack.length, 1);
		assert.equal(popped2.stack[0].name, "Root");

		// Popping at root keeps root
		const popped3 = leaveSheet(popped2);
		assert.equal(popped3.stack.length, 1);
		assert.equal(popped3.stack[0].name, "Root");
	});

	test("jumpTo slices stack to requested index and clamps safely", () => {
		const s0 = createNavState("Root");
		const s1 = enterSheet(s0, { name: "A" });
		const s2 = enterSheet(s1, { name: "B" });
		const s3 = enterSheet(s2, { name: "C" });
		assert.equal(s3.stack.length, 4);

		// Jump to index 1 ("A")
		const j1 = jumpTo(s3, 1);
		assert.equal(j1.stack.length, 2);
		assert.equal(j1.stack[1].name, "A");

		// Jump to index 0 ("Root")
		const j0 = jumpTo(s3, 0);
		assert.equal(j0.stack.length, 1);
		assert.equal(j0.stack[0].name, "Root");

		// Negative index clamps to root
		const jNeg = jumpTo(s3, -5);
		assert.equal(jNeg.stack.length, 1);
		assert.equal(jNeg.stack[0].name, "Root");

		// Out-of-bounds high index keeps full stack
		const jHigh = jumpTo(s3, 99);
		assert.equal(jHigh.stack.length, 4);
	});

	test("breadcrumb returns label and index list", () => {
		const s0 = createNavState("Main");
		assert.deepEqual(breadcrumb(s0), [{ label: "Main", index: 0 }]);

		const s1 = enterSheet(s0, { name: "Audio" });
		const s2 = enterSheet(s1, { name: "Amp" });
		assert.deepEqual(breadcrumb(s2), [
			{ label: "Main", index: 0 },
			{ label: "Audio", index: 1 },
			{ label: "Amp", index: 2 },
		]);
		assert.deepEqual(breadcrumb(null), []);
	});
});

describe("sheetTree hierarchy and cycle guards", () => {
	test("builds tree without loader", () => {
		const ir = {
			name: "Top",
			sheets: [
				{ id: "s1", name: "Power", file: "power.kicad_sch" },
				{ id: "s2", name: "MCU", file: "mcu.kicad_sch" },
			],
		};
		const tree = sheetTree(ir);
		assert.equal(tree.name, "Top");
		assert.equal(tree.path, "/Top");
		assert.equal(tree.children.length, 2);
		assert.equal(tree.children[0].name, "Power");
		assert.equal(tree.children[0].path, "/Top/Power");
		assert.equal(tree.children[0].children.length, 0);
		assert.equal(tree.children[1].name, "MCU");
	});

	test("recursively resolves nested sheets with loadIr function", () => {
		const powerIr = {
			name: "Power",
			file: "power.kicad_sch",
			sheets: [
				{ id: "s1-1", name: "Buck3V3", file: "buck.kicad_sch" },
				{ id: "s1-2", name: "LDO1V8", file: "ldo.kicad_sch" },
			],
		};
		const rootIr = {
			name: "Root",
			file: "root.kicad_sch",
			sheets: [{ id: "s1", name: "Power", file: "power.kicad_sch" }],
		};
		const loader = (file) => (file === "power.kicad_sch" ? powerIr : null);
		const tree = sheetTree(rootIr, loader);

		assert.equal(tree.children.length, 1);
		const powerNode = tree.children[0];
		assert.equal(powerNode.name, "Power");
		assert.equal(powerNode.children.length, 2);
		assert.equal(powerNode.children[0].name, "Buck3V3");
		assert.equal(powerNode.children[0].path, "/Root/Power/Buck3V3");
		assert.equal(powerNode.children[1].name, "LDO1V8");
		assert.equal(powerNode.children[1].path, "/Root/Power/LDO1V8");
	});

	test("guards against direct and indirect recursion cycles", () => {
		const sheetA = {
			name: "SheetA",
			file: "a.kicad_sch",
			sheets: [{ id: "to-b", name: "SheetB", file: "b.kicad_sch" }],
		};
		const sheetB = {
			name: "SheetB",
			file: "b.kicad_sch",
			sheets: [{ id: "to-a", name: "SheetA", file: "a.kicad_sch" }],
		};
		const files = {
			"a.kicad_sch": sheetA,
			"b.kicad_sch": sheetB,
		};
		const tree = sheetTree(sheetA, (f) => files[f]);
		assert.equal(tree.children.length, 1);
		const bNode = tree.children[0];
		assert.equal(bNode.name, "SheetB");
		// B tries to recurse to A which is in ancestor files, recursion must stop
		assert.equal(bNode.children.length, 1);
		const aCycleNode = bNode.children[0];
		assert.equal(aCycleNode.name, "SheetA");
		assert.equal(aCycleNode.children.length, 0);
	});

	test("guards against self-referencing cycles", () => {
		const selfIr = {
			name: "Loop",
			file: "loop.kicad_sch",
			sheets: [{ id: "s-self", name: "LoopSelf", file: "loop.kicad_sch" }],
		};
		const tree = sheetTree(selfIr, (f) =>
			f === "loop.kicad_sch" ? selfIr : null,
		);
		assert.equal(tree.children.length, 1);
		assert.equal(tree.children[0].children.length, 0);
	});

	test("guards against depth > 16", () => {
		// Chain 20 deep with distinct files
		const irMap = {};
		for (let i = 1; i <= 20; i++) {
			irMap[`sheet${i}.kicad_sch`] = {
				name: `Level${i}`,
				file: `sheet${i}.kicad_sch`,
				sheets:
					i < 20
						? [
								{
									id: `s-${i + 1}`,
									name: `Level${i + 1}`,
									file: `sheet${i + 1}.kicad_sch`,
								},
							]
						: [],
			};
		}
		const root = irMap["sheet1.kicad_sch"];
		const tree = sheetTree(root, (f) => irMap[f]);

		let curr = tree;
		let depth = 0;
		while (curr.children.length > 0) {
			curr = curr.children[0];
			depth++;
		}
		assert(depth <= 16, `Depth exceeded 16: got ${depth}`);
	});
});

describe("EditorScreen sheet navigation wiring", () => {
	test("wires onEnterSheet prop to SchematicCanvas", () => {
		const editor = src("editor/EditorScreen.jsx");
		assert.match(editor, /onEnterSheet=\{sheetNav\.enterSheet\}/);
	});

	test("defines useSheetNav hook and imports from sheetNav.js", () => {
		const editor = src("editor/EditorScreen.jsx");
		assert.match(
			editor,
			/import\s*\{[^}]*breadcrumb[^}]*\}\s*from\s*"\.\/sheetNav\.js"/,
		);
		assert.match(editor, /function useSheetNav\(/);
	});

	test("renders breadcrumb bar with click to jump and Leave sheet button", () => {
		const editor = src("editor/EditorScreen.jsx");
		assert.match(editor, /function SheetBreadcrumb\(/);
		assert.match(editor, /Leave sheet \(Alt\+Backspace\)/);
		assert.match(editor, /isLeaveSheetShortcut/);
	});
});
