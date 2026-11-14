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
});
