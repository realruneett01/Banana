import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { get, setCursor } from "../../frontend/src/editor/editorStatus.js";
import { summarizeWarnings } from "../../frontend/src/editor/exportWarnings.js";

const src = (rel) =>
	readFileSync(new URL(`../../frontend/src/${rel}`, import.meta.url), "utf8");

describe("setCursor", () => {
	test("stores the reported zoom with the cursor", () => {
		setCursor({ x: 3, y: 4, zoom: 7.5 });
		assert.equal(get().x, 3);
		assert.equal(get().y, 4);
		assert.equal(get().zoom, 7.5);
	});

	test("keeps the last zoom when a report has none", () => {
		setCursor({ x: 1, y: 2, zoom: 2 });
		setCursor({ x: 5, y: 6 });
		assert.equal(get().zoom, 2);
		assert.equal(get().x, 5);
	});
});

describe("summarizeWarnings", () => {
	test("returns nothing for no warnings", () => {
		assert.equal(summarizeWarnings([]), null);
		assert.equal(summarizeWarnings(undefined), null);
	});

	test("dedupes and counts repeated warnings", () => {
		const s = summarizeWarnings(["a", "b", "a", "a"]);
		assert.equal(s.total, 4);
		assert.deepEqual(s.lines, ["a (x3)", "b"]);
	});

	test("caps the listed lines and says how many are left", () => {
		const list = ["w1", "w2", "w3", "w4", "w5", "w6", "w7"];
		const s = summarizeWarnings(list, 5);
		assert.equal(s.total, 7);
		assert.deepEqual(s.lines, ["w1", "w2", "w3", "w4", "w5", "...and 2 more"]);
	});
});

describe("editor UX wiring", () => {
	test("both canvases report the cursor through onCursorMove", () => {
		assert.match(src("editor/SchematicCanvas.jsx"), /onCursorMove\?\.\(/);
		assert.match(src("editor/PcbCanvas.jsx"), /onCursorMove\?\.\(/);
	});

	test("schematic wire hits use a zoom-scaled tolerance", () => {
		assert.match(src("editor/SchematicCanvas.jsx"), /wireHitTolerance\(/);
	});

	test("no Drawer uses the deprecated width prop", () => {
		for (const file of ["App.jsx", "ChatbotDrawer.jsx"]) {
			assert.doesNotMatch(src(file), /^\s*width=/m, file);
		}
	});

	test("the file-open toast uses the App context message", () => {
		const app = src("App.jsx");
		assert.match(app, /AntApp\.useApp\(\)/);
		assert.match(app, /<AntApp>/);
	});

	test("export shows every warning summary", () => {
		assert.match(src("editor/EditorScreen.jsx"), /summarizeWarnings\(/);
	});

	test("export actions are grouped into an Export dropdown", () => {
		const editor = src("editor/EditorScreen.jsx");
		assert.match(editor, /<Dropdown/);
		assert.match(editor, /function ExportDropdown/);
	});

	test("right board summary panel is collapsible with a toggle button", () => {
		const editor = src("editor/EditorScreen.jsx");
		assert.match(editor, /Toggle board summary/);
		assert.match(editor, /useCollapsiblePanel/);
	});

	test("tabs retain full labels without shrinking", () => {
		const editor = src("editor/EditorScreen.jsx");
		assert.match(editor, /flexShrink:\s*0/);
	});

	test("Update PCB and Add copper pour buttons are icon-only with full aria-labels", () => {
		const bt = src("editor/BoardTools.jsx");
		assert.match(bt, /ariaLabel="Update PCB from schematic"/);
		assert.match(bt, /ariaLabel="Add copper pour"/);
		assert.doesNotMatch(bt, /text="Update PCB from schematic"/);
		assert.doesNotMatch(bt, /text="Add copper pour"/);
	});

	test("Board outline control is a compact dropdown labelled Board outline", () => {
		const bt = src("editor/BoardTools.jsx");
		assert.match(bt, /<Dropdown/);
		assert.match(bt, /function OutlineDropdown/);
		assert.match(bt, /Board outline/);
	});

	test("Board outline radius input is conditionally visible only when rounded is chosen", () => {
		const bt = src("editor/BoardTools.jsx");
		assert.match(
			bt,
			/activeTool === "rounded_rect"\s*&&\s*\(\s*<OutlineRadiusInput/,
		);
	});

	test("Rotate and Flip sit in one horizontal row", () => {
		const editor = src("editor/EditorScreen.jsx");
		assert.match(editor, /function TransformButtons/);
		assert.match(editor, /Rotate 90°/);
		assert.match(editor, /Flip Side/);
	});

	test("Run DRC and Run ERC buttons provide plain meaning tooltips", () => {
		const editor = src("editor/EditorScreen.jsx");
		assert.match(editor, /Check the board for manufacturing problems/);
		assert.match(editor, /Check the schematic for wiring mistakes/);
		assert.match(editor, /ariaLabel="Run DRC"/);
		assert.match(editor, /ariaLabel="Run ERC"/);
	});

	test("ChecksPanel is mounted docked with runDrc and runErc", () => {
		const editor = src("editor/EditorScreen.jsx");
		assert.match(editor, /import ChecksPanel from "\.\/ChecksPanel\.jsx"/);
		assert.match(editor, /runDrc/);
		assert.match(editor, /runErc/);
		assert.match(editor, /<ChecksPanel/);
	});

	test("root-only sheet breadcrumbs are hidden or collapsed when no sub-sheets exist", () => {
		const editor = src("editor/EditorScreen.jsx");
		assert.match(editor, /function SheetBreadcrumb/);
		assert.match(
			editor,
			/if\s*\((?:!items\s*\|\|\s*)?items(?:\?\.|\.)length\s*<=\s*1\)\s*(?:return null;|{\s*return null;\s*})/,
		);
	});

	test("toolbar buttons have standardized 24px bounds matching --bn-btn-h-sm", () => {
		const editor = src("editor/EditorScreen.jsx");
		assert.match(editor, /--bn-btn-h-sm/);
		assert.match(editor, /24px/);
	});

	test("SaveCommitDialog embeds staged changes summary and styles commit button with brand gold", () => {
		const dialog = src("editor/SaveCommitDialog.jsx");
		assert.match(dialog, /function StagedChangesSummary/);
		assert.match(dialog, /<StagedChangesSummary/);
		assert.match(dialog, /--bn-color-brand/);
	});
});
