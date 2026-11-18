import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import {
	copySchematic,
	cutSchematicCommands,
	duplicateSchematicCommands,
	pasteSchematicCommands,
	selectAllIds,
} from "../../frontend/src/editor/clipboard.js";
import {
	applyCommand,
	invertCommand,
} from "../../frontend/src/editor/editorModel.js";
import { resolveSchematicAction } from "../../frontend/src/editor/hotkeys.js";
import { snapPoint } from "../../frontend/src/editor/viewport.js";

const schCanvasUrl = new URL(
	"../../frontend/src/editor/SchematicCanvas.jsx",
	import.meta.url,
);
const schSrc = fs.readFileSync(schCanvasUrl, "utf8");

function loadClipboardWiringPureFunctions() {
	const start = schSrc.indexOf("export function resolvePastePosition");
	const end = schSrc.indexOf("function handleCopyKey");
	const code = schSrc.slice(start, end).replaceAll("export ", "");
	const fn = new Function(
		"snapPoint",
		"SCH_GRID",
		`
		${code}
		return { resolvePastePosition, extractPastedIds };
	`,
	);
	return fn(snapPoint, 1.27);
}

const { resolvePastePosition, extractPastedIds } =
	loadClipboardWiringPureFunctions();

function loadClipboardHandlers() {
	const start = schSrc.indexOf("let schematicClipboard = null;");
	const end = schSrc.indexOf("const ACTION_KEY_HANDLERS = {");
	const code = schSrc.slice(start, end).replaceAll("export ", "");
	const fn = new Function(
		"copySchematic",
		"pasteSchematicCommands",
		"duplicateSchematicCommands",
		"cutSchematicCommands",
		"selectAllIds",
		"snapPoint",
		"SCH_GRID",
		`
		${code}
		return {
			handleCopyKey,
			handlePasteKey,
			handleCutKey,
			handleDuplicateKey,
			handleSelectAllKey,
			getClipboard: () => schematicClipboard,
			setClipboard: (c) => { schematicClipboard = c; },
		};
	`,
	);
	return fn(
		copySchematic,
		pasteSchematicCommands,
		duplicateSchematicCommands,
		cutSchematicCommands,
		selectAllIds,
		snapPoint,
		1.27,
	);
}

function makeSampleDoc() {
	return {
		ir: {
			schemaVersion: 1,
			name: "wiring-test",
			parts: [
				{
					id: "p1",
					ref: "R1",
					value: "10k",
					symbol: "Device:R",
					placement: { x: 10, y: 10, rot: 0, side: "F" },
				},
				{
					id: "p2",
					ref: "C1",
					value: "100n",
					symbol: "Device:C",
					placement: { x: 30, y: 10, rot: 0, side: "F" },
				},
			],
			annotations: [
				{ id: "a1", kind: "line", x: 10, y: 20, x2: 30, y2: 20 },
				{ id: "a2", kind: "label", x: 10, y: 5, text: "SIG" },
			],
			sheets: [
				{
					id: "s1",
					name: "SubSheet",
					file: "sub.kicad_sch",
					x: 40,
					y: 40,
					w: 20,
					h: 20,
					pins: [],
				},
			],
			nets: [
				{
					id: "n1",
					name: "SIG",
					pins: [
						{ partId: "p1", pin: "2" },
						{ partId: "p2", pin: "1" },
					],
				},
			],
		},
		selection: ["p1", "a1"],
		history: { past: [], future: [] },
	};
}

describe("resolvePastePosition pure helper", () => {
	test("snaps valid cursor coordinates to default schematic grid (1.27)", () => {
		const pos = resolvePastePosition({ x: 10.1, y: 20.3 });
		assert.equal(pos.x, 10.16);
		assert.equal(pos.y, 20.32);
	});

	test("preserves exact on-grid coordinates", () => {
		const pos = resolvePastePosition({ x: 2.54, y: 5.08 });
		assert.equal(pos.x, 2.54);
		assert.equal(pos.y, 5.08);
	});

	test("supports custom grid size", () => {
		const pos = resolvePastePosition({ x: 2.1, y: 5.4 }, 2.54);
		assert.equal(pos.x, 2.54);
		assert.equal(pos.y, 5.08);
	});

	test("correctly snaps negative coordinates", () => {
		const pos = resolvePastePosition({ x: -10.1, y: -20.3 });
		assert.equal(pos.x, -10.16);
		assert.equal(pos.y, -20.32);
	});

	test("falls back to snapped (0, 0) when cursorWorld is null or invalid", () => {
		assert.deepEqual(resolvePastePosition(null), { x: 0, y: 0 });
		assert.deepEqual(resolvePastePosition(undefined), { x: 0, y: 0 });
		assert.deepEqual(resolvePastePosition({}), { x: 0, y: 0 });
		assert.deepEqual(resolvePastePosition({ x: "invalid", y: 10 }), {
			x: 0,
			y: 0,
		});
	});

	test("uses custom fallback when cursorWorld is invalid", () => {
		const fallback = { x: 10.1, y: 20.3 };
		const pos = resolvePastePosition(null, 1.27, fallback);
		assert.equal(pos.x, 10.16);
		assert.equal(pos.y, 20.32);
	});
});

describe("extractPastedIds pure helper", () => {
	test("extracts part, sheet, and annotation IDs from batch command", () => {
		const batch = {
			type: "batch",
			commands: [
				{ type: "addPart", part: { id: "p_new_1" } },
				{ type: "addSheet", sheet: { id: "s_new_1" } },
				{ type: "addAnnotation", annotation: { id: "ann_new_1" } },
				{
					type: "connect",
					partIdA: "p_new_1",
					pinA: "1",
					partIdB: "p_new_2",
					pinB: "2",
				},
			],
		};
		const ids = extractPastedIds(batch);
		assert.deepEqual(ids, ["p_new_1", "s_new_1", "ann_new_1"]);
	});

	test("returns empty array for empty, missing, or malformed commands", () => {
		assert.deepEqual(extractPastedIds(null), []);
		assert.deepEqual(extractPastedIds({ type: "batch" }), []);
		assert.deepEqual(extractPastedIds({ type: "batch", commands: [] }), []);
		assert.deepEqual(
			extractPastedIds({
				type: "batch",
				commands: [{ type: "connect", partIdA: "p1", pinA: "1" }],
			}),
			[],
		);
	});
});

describe("SchematicCanvas clipboard key handlers execution", () => {
	test("handleCopyKey copies selection to clipboard ref", () => {
		const handlers = loadClipboardHandlers();
		const doc = makeSampleDoc();
		doc.selection = ["p1", "a1"];
		handlers.handleCopyKey({ doc });
		const clip = handlers.getClipboard();
		assert.ok(clip);
		assert.equal(clip.parts.length, 1);
		assert.equal(clip.parts[0].ref, "R1");
		assert.equal(clip.annotations.length, 1);
	});

	test("handleCopyKey ignores empty selection", () => {
		const handlers = loadClipboardHandlers();
		const doc = makeSampleDoc();
		doc.selection = [];
		handlers.setClipboard(null);
		handlers.handleCopyKey({ doc });
		assert.equal(handlers.getClipboard(), null);
	});

	test("handlePasteKey dispatches batch command and selects pasted items", () => {
		const handlers = loadClipboardHandlers();
		const doc = makeSampleDoc();
		doc.selection = ["p1"];
		handlers.handleCopyKey({ doc });

		const dispatched = [];
		const ctx = {
			doc,
			cursorWorld: { x: 50, y: 60 },
			dispatchCmd: (cmd) => dispatched.push(cmd),
		};
		handlers.handlePasteKey(ctx);

		assert.equal(dispatched.length, 2);
		assert.equal(dispatched[0].type, "batch");
		assert.equal(dispatched[1].type, "select");
		assert.equal(dispatched[1].ids.length, 1);
		assert.notEqual(dispatched[1].ids[0], "p1");
	});

	test("handlePasteKey does nothing when clipboard is empty", () => {
		const handlers = loadClipboardHandlers();
		const doc = makeSampleDoc();
		handlers.setClipboard(null);
		const dispatched = [];
		handlers.handlePasteKey({
			doc,
			cursorWorld: { x: 10, y: 10 },
			dispatchCmd: (cmd) => dispatched.push(cmd),
		});
		assert.equal(dispatched.length, 0);
	});

	test("handleCutKey updates clipboard and dispatches single batch delete command", () => {
		const handlers = loadClipboardHandlers();
		const doc = makeSampleDoc();
		doc.selection = ["p1", "a1"];
		const dispatched = [];
		handlers.handleCutKey({
			doc,
			dispatchCmd: (cmd) => dispatched.push(cmd),
		});

		const clip = handlers.getClipboard();
		assert.ok(clip);
		assert.equal(clip.parts.length, 1);
		assert.equal(dispatched.length, 1);
		assert.equal(dispatched[0].type, "batch");
		assert.equal(dispatched[0].commands.length, 2);
		assert.equal(dispatched[0].commands[0].type, "deletePart");
		assert.equal(dispatched[0].commands[1].type, "deleteAnnotation");
	});

	test("handleDuplicateKey dispatches single batch command", () => {
		const handlers = loadClipboardHandlers();
		const doc = makeSampleDoc();
		doc.selection = ["p1"];
		const dispatched = [];
		handlers.handleDuplicateKey({
			doc,
			dispatchCmd: (cmd) => dispatched.push(cmd),
		});

		assert.equal(dispatched.length, 1);
		assert.equal(dispatched[0].type, "batch");
		assert.ok(dispatched[0].commands.some((c) => c.type === "addPart"));
	});

	test("handleSelectAllKey dispatches select command with all item IDs", () => {
		const handlers = loadClipboardHandlers();
		const doc = makeSampleDoc();
		const dispatched = [];
		handlers.handleSelectAllKey({
			doc,
			dispatchCmd: (cmd) => dispatched.push(cmd),
		});

		assert.equal(dispatched.length, 1);
		assert.equal(dispatched[0].type, "select");
		assert.deepEqual(dispatched[0].ids.sort(), ["a1", "a2", "p1", "p2", "s1"]);
	});
});

describe("Undoability of clipboard batch actions", () => {
	test("paste batch command is cleanly reversible with invertCommand", () => {
		const doc = makeSampleDoc();
		const clip = copySchematic(doc, ["p1"]);
		const batch = pasteSchematicCommands(doc, clip, { x: 50, y: 50 });
		const nextDoc = applyCommand(doc, batch);
		assert.equal(nextDoc.ir.parts.length, doc.ir.parts.length + 1);

		const inverted = invertCommand(doc, batch);
		const restoredDoc = applyCommand(nextDoc, inverted);
		assert.equal(restoredDoc.ir.parts.length, doc.ir.parts.length);
		assert.deepEqual(
			restoredDoc.ir.parts.map((p) => p.id),
			doc.ir.parts.map((p) => p.id),
		);
	});

	test("cut batch command is cleanly reversible with invertCommand", () => {
		const doc = makeSampleDoc();
		const { command } = cutSchematicCommands(doc, ["p1"]);
		const nextDoc = applyCommand(doc, command);
		assert.equal(nextDoc.ir.parts.length, 1);

		const inverted = invertCommand(doc, command);
		const restoredDoc = applyCommand(nextDoc, inverted);
		assert.equal(restoredDoc.ir.parts.length, 2);
	});
});

describe("SchematicCanvas source wiring verification", () => {
	test("imports clipboard helpers from ./clipboard.js", () => {
		assert.match(
			schSrc,
			/import\s*\{[^}]*copySchematic[^}]*\}\s*from\s*"\.\/clipboard\.js";/,
		);
		assert.match(
			schSrc,
			/import\s*\{[^}]*pasteSchematicCommands[^}]*\}\s*from\s*"\.\/clipboard\.js";/,
		);
		assert.match(
			schSrc,
			/import\s*\{[^}]*duplicateSchematicCommands[^}]*\}\s*from\s*"\.\/clipboard\.js";/,
		);
		assert.match(
			schSrc,
			/import\s*\{[^}]*cutSchematicCommands[^}]*\}\s*from\s*"\.\/clipboard\.js";/,
		);
		assert.match(
			schSrc,
			/import\s*\{[^}]*selectAllIds[^}]*\}\s*from\s*"\.\/clipboard\.js";/,
		);
	});

	test("ACTION_KEY_HANDLERS table registers copy, paste, cut, duplicate, selectAll", () => {
		assert.match(schSrc, /copy:\s*handleCopyKey/);
		assert.match(schSrc, /paste:\s*handlePasteKey/);
		assert.match(schSrc, /cut:\s*handleCutKey/);
		assert.match(schSrc, /duplicate:\s*handleDuplicateKey/);
		assert.match(schSrc, /selectAll:\s*handleSelectAllKey/);
	});

	test("preserves existing test expectation: setTextModal call", () => {
		assert.match(schSrc, /s\.annotationSession\.setTextModal\(ann\);/);
	});

	test("hotkeys resolveSchematicAction blocks execution while typing in inputs", () => {
		const inputTarget = { tagName: "INPUT" };
		const textareaTarget = { tagName: "TEXTAREA" };
		const editableTarget = { isContentEditable: true };

		assert.equal(
			resolveSchematicAction({ key: "c", ctrlKey: true, target: inputTarget }),
			null,
		);
		assert.equal(
			resolveSchematicAction({
				key: "v",
				ctrlKey: true,
				target: textareaTarget,
			}),
			null,
		);
		assert.equal(
			resolveSchematicAction({
				key: "x",
				ctrlKey: true,
				target: editableTarget,
			}),
			null,
		);
		assert.equal(
			resolveSchematicAction({ key: "d", ctrlKey: true, target: inputTarget }),
			null,
		);
		assert.equal(
			resolveSchematicAction({ key: "a", ctrlKey: true, target: inputTarget }),
			null,
		);
	});
});
