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

function makeIr(name, sheets = [], file = "") {
	return {
		name,
		...(file ? { file } : {}),
		sheets,
	};
}

function stackNames(nav) {
	return nav.stack.map((item) => item.name);
}

function assertCodeMatches(sourcePath, patterns) {
	const code = src(sourcePath);
	for (const pattern of patterns) {
		assert.match(code, pattern);
	}
}

describe("sheetNav navigation state", () => {
	test("createNavState initializes stack with root sheet", () => {
		for (const [arg, expected] of [
			[undefined, [{ file: "", name: "Root", path: "/Root" }]],
			["MainBoard", [{ file: "", name: "MainBoard", path: "/MainBoard" }]],
		]) {
			assert.deepEqual(createNavState(arg).stack, expected);
		}
	});

	test("enterSheet pushes subsheets and formats path", () => {
		const initial = createNavState("Top");
		const s1 = enterSheet(initial, {
			file: "power.kicad_sch",
			id: "sheet-1",
			name: "Power",
		});
		assert.equal(initial.stack.length, 1);
		assert.deepEqual(s1.stack, [
			{ file: "", name: "Top", path: "/Top" },
			{
				file: "power.kicad_sch",
				id: "sheet-1",
				name: "Power",
				path: "/Top/Power",
			},
		]);

		const s2 = enterSheet(s1, {
			file: "reg.kicad_sch",
			id: "sheet-2",
			name: "Regulator",
		});
		assert.deepEqual(
			[s2.stack.length, s2.stack[2].name, s2.stack[2].path],
			[3, "Regulator", "/Top/Power/Regulator"],
		);
	});

	test("leaveSheet pops top sheet and never drops below root", () => {
		const initial = createNavState("Root");
		const s1 = enterSheet(initial, { name: "Sheet1", file: "s1.kicad_sch" });
		const s2 = enterSheet(s1, { name: "Sheet2", file: "s2.kicad_sch" });

		let curr = s2;
		for (const expected of [["Root", "Sheet1"], ["Root"], ["Root"]]) {
			curr = leaveSheet(curr);
			assert.deepEqual(stackNames(curr), expected);
		}
		assert.equal(s2.stack.length, 3);
	});

	test("jumpTo slices stack to requested index and clamps safely", () => {
		const base = ["A", "B", "C"].reduce(
			(state, name) => enterSheet(state, { name }),
			createNavState("Root"),
		);
		assert.equal(base.stack.length, 4);

		const cases = [
			[1, ["Root", "A"]],
			[0, ["Root"]],
			[-5, ["Root"]],
			[99, ["Root", "A", "B", "C"]],
		];
		for (const [targetIndex, expectedNames] of cases) {
			assert.deepEqual(stackNames(jumpTo(base, targetIndex)), expectedNames);
		}
	});

	test("breadcrumb returns label and index list", () => {
		const nav = enterSheet(
			enterSheet(createNavState("Main"), { name: "Audio" }),
			{ name: "Amp" },
		);
		const expectations = [
			[createNavState("Main"), ["Main"]],
			[nav, ["Main", "Audio", "Amp"]],
			[null, []],
		];
		for (const [state, labels] of expectations) {
			const expected = labels.map((label, index) => ({ label, index }));
			assert.deepEqual(breadcrumb(state), expected);
		}
	});
});

describe("sheetTree hierarchy and cycle guards", () => {
	test("builds tree without loader", () => {
		const ir = makeIr("Top", [
			{ id: "s1", name: "Power", file: "power.kicad_sch" },
			{ id: "s2", name: "MCU", file: "mcu.kicad_sch" },
		]);
		const tree = sheetTree(ir);
		assert.deepEqual(
			[tree.name, tree.path, tree.children.map((c) => c.name)],
			["Top", "/Top", ["Power", "MCU"]],
		);
		assert.deepEqual(
			tree.children.map((c) => [c.path, c.children.length]),
			[
				["/Top/Power", 0],
				["/Top/MCU", 0],
			],
		);
	});

	test("recursively resolves nested sheets with loadIr function", () => {
		const powerIr = makeIr(
			"Power",
			[
				{ id: "s1-1", name: "Buck3V3", file: "buck.kicad_sch" },
				{ id: "s1-2", name: "LDO1V8", file: "ldo.kicad_sch" },
			],
			"power.kicad_sch",
		);
		const rootIr = makeIr(
			"Root",
			[{ id: "s1", name: "Power", file: "power.kicad_sch" }],
			"root.kicad_sch",
		);
		const tree = sheetTree(rootIr, (file) =>
			file === "power.kicad_sch" ? powerIr : null,
		);
		const [powerNode] = tree.children;
		assert.deepEqual([tree.children.length, powerNode.name], [1, "Power"]);
		assert.deepEqual(
			powerNode.children.map((c) => `${c.name}:${c.path}`),
			["Buck3V3:/Root/Power/Buck3V3", "LDO1V8:/Root/Power/LDO1V8"],
		);
	});

	test("guards against direct and indirect recursion cycles", () => {
		const makeCycle = (name, sub, file, subFile) =>
			makeIr(name, [{ id: `to-${sub}`, name: sub, file: subFile }], file);
		const sheetA = makeCycle("SheetA", "SheetB", "a.kicad_sch", "b.kicad_sch");
		const sheetB = makeCycle("SheetB", "SheetA", "b.kicad_sch", "a.kicad_sch");
		const files = {
			"a.kicad_sch": sheetA,
			"b.kicad_sch": sheetB,
		};
		const tree = sheetTree(sheetA, (f) => files[f]);
		const [bNode] = tree.children;
		const [aCycleNode] = bNode.children;
		assert.deepEqual(
			[
				tree.children.length,
				bNode.name,
				bNode.children.length,
				aCycleNode.name,
				aCycleNode.children.length,
			],
			[1, "SheetB", 1, "SheetA", 0],
		);
	});

	test("guards against self-referencing cycles", () => {
		const selfIr = makeIr(
			"Loop",
			[{ id: "s-self", name: "LoopSelf", file: "loop.kicad_sch" }],
			"loop.kicad_sch",
		);
		const tree = sheetTree(selfIr, (f) =>
			f === "loop.kicad_sch" ? selfIr : null,
		);
		assert.deepEqual(
			tree.children.map((child) => child.children.length),
			[0],
		);
	});

	test("guards against depth > 16", () => {
		const irMap = Object.fromEntries(
			Array.from({ length: 20 }, (_, idx) => {
				const i = idx + 1;
				const sub =
					i < 20
						? [
								{
									id: `s-${i + 1}`,
									name: `Level${i + 1}`,
									file: `sheet${i + 1}.kicad_sch`,
								},
							]
						: [];
				return [
					`sheet${i}.kicad_sch`,
					makeIr(`Level${i}`, sub, `sheet${i}.kicad_sch`),
				];
			}),
		);
		const tree = sheetTree(irMap["sheet1.kicad_sch"], (f) => irMap[f]);

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
		assertCodeMatches("editor/EditorScreen.jsx", [
			/onEnterSheet=\{sheetNav\.enterSheet\}/,
		]);
	});

	test("defines useSheetNav hook and imports from sheetNav.js", () => {
		assertCodeMatches("editor/EditorScreen.jsx", [
			/import\s*\{[^}]*breadcrumb[^}]*\}\s*from\s*"\.\/sheetNav\.js"/,
			/function useSheetNav\(/,
		]);
	});

	test("renders breadcrumb bar with click to jump and Leave sheet button", () => {
		assertCodeMatches("editor/EditorScreen.jsx", [
			/function SheetBreadcrumb\(/,
			/Leave sheet \(Alt\+Backspace\)/,
			/isLeaveSheetShortcut/,
		]);
	});
});
