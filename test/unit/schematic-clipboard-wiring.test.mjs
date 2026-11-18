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

function evalCanvasBlock({ start, end, args, returnStatement }) {
	const code = schSrc
		.slice(schSrc.indexOf(start), schSrc.indexOf(end))
		.replaceAll("export ", "");
	const paramNames = Object.keys(args);
	const paramValues = Object.values(args);
	return new Function(...paramNames, `${code}\nreturn ${returnStatement};`)(
		...paramValues,
	);
}

const { resolvePastePosition, extractPastedIds } = evalCanvasBlock({
	start: "export function resolvePastePosition",
	end: "function handleCopyKey",
	args: { snapPoint, SCH_GRID: 1.27 },
	returnStatement: "{ resolvePastePosition, extractPastedIds }",
});

function loadClipboardHandlers() {
	return evalCanvasBlock({
		start: "let schematicClipboard = null;",
		end: "const ACTION_KEY_HANDLERS = {",
		args: {
			copySchematic,
			pasteSchematicCommands,
			duplicateSchematicCommands,
			cutSchematicCommands,
			selectAllIds,
			snapPoint,
			SCH_GRID: 1.27,
		},
		returnStatement: `{
			handleCopyKey,
			handlePasteKey,
			handleCutKey,
			handleDuplicateKey,
			handleSelectAllKey,
			getClipboard: () => schematicClipboard,
			setClipboard: (c) => { schematicClipboard = c; },
		}`,
	});
}

function makePart(id, ref, value, [x, y]) {
	const symbol = ref.startsWith("R") ? "Device:R" : "Device:C";
	return { id, ref, value, symbol, placement: { x, y, rot: 0, side: "F" } };
}

function makeNet(id, name, ...pinPairs) {
	return {
		id,
		name,
		pins: pinPairs.map(([partId, pin]) => ({ partId, pin })),
	};
}

function makeAnnotation(id, kind, fields) {
	return { id, kind, ...fields };
}

function makeSheet(id, name, file, rect) {
	return {
		id,
		name,
		file,
		x: rect[0],
		y: rect[1],
		w: rect[2],
		h: rect[3],
		pins: [],
	};
}

function makeSampleDoc() {
	const ir = {
		schemaVersion: 1,
		name: "wiring-test",
		parts: [
			makePart("p1", "R1", "10k", [10, 10]),
			makePart("p2", "C1", "100n", [30, 10]),
		],
		annotations: [
			makeAnnotation("a1", "line", { x: 10, y: 20, x2: 30, y2: 20 }),
			makeAnnotation("a2", "label", { x: 10, y: 5, text: "SIG" }),
		],
		sheets: [makeSheet("s1", "SubSheet", "sub.kicad_sch", [40, 40, 20, 20])],
		nets: [makeNet("n1", "SIG", ["p1", "2"], ["p2", "1"])],
	};
	return {
		ir,
		selection: ["p1", "a1"],
		history: { past: [], future: [] },
	};
}

function createHandlerHarness(doc = makeSampleDoc()) {
	const handlers = loadClipboardHandlers();
	const dispatched = [];
	return {
		handlers,
		doc,
		dispatched,
		dispatchCmd: (cmd) => dispatched.push(cmd),
	};
}

function expectSingleCommand(dispatched, expectedType) {
	assert.equal(dispatched.length, 1);
	assert.equal(dispatched[0].type, expectedType);
	return dispatched[0];
}

function applyAndInvert(doc, command) {
	const nextDoc = applyCommand(doc, command);
	const inverted = invertCommand(doc, command);
	const restoredDoc = applyCommand(nextDoc, inverted);
	return { nextDoc, restoredDoc };
}

describe("resolvePastePosition pure helper", () => {
	test("snaps valid cursor coordinates to default schematic grid (1.27)", () => {
		assert.deepEqual(resolvePastePosition({ x: 10.1, y: 20.3 }), {
			x: 10.16,
			y: 20.32,
		});
	});

	test("preserves exact on-grid coordinates", () => {
		assert.deepEqual(resolvePastePosition({ x: 2.54, y: 5.08 }), {
			x: 2.54,
			y: 5.08,
		});
	});

	test("supports custom grid size", () => {
		assert.deepEqual(resolvePastePosition({ x: 2.1, y: 5.4 }, 2.54), {
			x: 2.54,
			y: 5.08,
		});
	});

	test("correctly snaps negative coordinates", () => {
		assert.deepEqual(resolvePastePosition({ x: -10.1, y: -20.3 }), {
			x: -10.16,
			y: -20.32,
		});
	});

	test("falls back to snapped (0, 0) when cursorWorld is null or invalid", () => {
		const invalidInputs = [null, undefined, {}, { x: "invalid", y: 10 }];
		for (const input of invalidInputs) {
			assert.deepEqual(resolvePastePosition(input), { x: 0, y: 0 });
		}
	});

	test("uses custom fallback when cursorWorld is invalid", () => {
		const fallback = { x: 10.1, y: 20.3 };
		assert.deepEqual(resolvePastePosition(null, 1.27, fallback), {
			x: 10.16,
			y: 20.32,
		});
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
		assert.deepEqual(extractPastedIds(batch), [
			"p_new_1",
			"s_new_1",
			"ann_new_1",
		]);
	});

	test("returns empty array for empty, missing, or malformed commands", () => {
		const cases = [
			null,
			{ type: "batch" },
			{ type: "batch", commands: [] },
			{
				type: "batch",
				commands: [{ type: "connect", partIdA: "p1", pinA: "1" }],
			},
		];
		for (const candidate of cases) {
			assert.deepEqual(extractPastedIds(candidate), []);
		}
	});
});

describe("SchematicCanvas clipboard key handlers execution", () => {
	test("handleCopyKey copies selection to clipboard ref", () => {
		const { handlers, doc } = createHandlerHarness();
		doc.selection = ["p1", "a1"];
		handlers.handleCopyKey({ doc });
		const clip = handlers.getClipboard();
		assert.ok(clip);
		assert.equal(clip.parts.length, 1);
		assert.equal(clip.parts[0].ref, "R1");
		assert.equal(clip.annotations.length, 1);
	});

	test("handleCopyKey ignores empty selection", () => {
		const { handlers, doc } = createHandlerHarness();
		doc.selection = [];
		handlers.setClipboard(null);
		handlers.handleCopyKey({ doc });
		assert.equal(handlers.getClipboard(), null);
	});

	test("handlePasteKey dispatches batch command and selects pasted items", () => {
		const { handlers, doc, dispatched, dispatchCmd } = createHandlerHarness();
		doc.selection = ["p1"];
		handlers.handleCopyKey({ doc });
		handlers.handlePasteKey({
			doc,
			cursorWorld: { x: 50, y: 60 },
			dispatchCmd,
		});

		assert.equal(dispatched.length, 2);
		assert.equal(dispatched[0].type, "batch");
		assert.equal(dispatched[1].type, "select");
		assert.equal(dispatched[1].ids.length, 1);
		assert.notEqual(dispatched[1].ids[0], "p1");
	});

	test("handlePasteKey does nothing when clipboard is empty", () => {
		const { handlers, doc, dispatched, dispatchCmd } = createHandlerHarness();
		handlers.setClipboard(null);
		handlers.handlePasteKey({
			doc,
			cursorWorld: { x: 10, y: 10 },
			dispatchCmd,
		});
		assert.equal(dispatched.length, 0);
	});

	test("handleCutKey updates clipboard and dispatches single batch delete command", () => {
		const { handlers, doc, dispatched, dispatchCmd } = createHandlerHarness();
		doc.selection = ["p1", "a1"];
		handlers.handleCutKey({ doc, dispatchCmd });

		const clip = handlers.getClipboard();
		assert.ok(clip);
		assert.equal(clip.parts.length, 1);
		const cmd = expectSingleCommand(dispatched, "batch");
		assert.deepEqual(
			cmd.commands.map((c) => c.type),
			["deletePart", "deleteAnnotation"],
		);
	});

	test("handleDuplicateKey dispatches single batch command", () => {
		const { handlers, doc, dispatched, dispatchCmd } = createHandlerHarness();
		doc.selection = ["p1"];
		handlers.handleDuplicateKey({ doc, dispatchCmd });

		const cmd = expectSingleCommand(dispatched, "batch");
		assert.ok(cmd.commands.some((c) => c.type === "addPart"));
	});

	test("handleSelectAllKey dispatches select command with all item IDs", () => {
		const { handlers, doc, dispatched, dispatchCmd } = createHandlerHarness();
		handlers.handleSelectAllKey({ doc, dispatchCmd });

		const cmd = expectSingleCommand(dispatched, "select");
		assert.deepEqual(cmd.ids.sort(), ["a1", "a2", "p1", "p2", "s1"]);
	});
});

describe("Undoability of clipboard batch actions", () => {
	test("paste batch command is cleanly reversible with invertCommand", () => {
		const doc = makeSampleDoc();
		const clip = copySchematic(doc, ["p1"]);
		const batch = pasteSchematicCommands(doc, clip, { x: 50, y: 50 });
		const { nextDoc, restoredDoc } = applyAndInvert(doc, batch);
		assert.equal(nextDoc.ir.parts.length, doc.ir.parts.length + 1);
		assert.equal(restoredDoc.ir.parts.length, doc.ir.parts.length);
		assert.deepEqual(
			restoredDoc.ir.parts.map((p) => p.id),
			doc.ir.parts.map((p) => p.id),
		);
	});

	test("cut batch command is cleanly reversible with invertCommand", () => {
		const doc = makeSampleDoc();
		const { command } = cutSchematicCommands(doc, ["p1"]);
		const { nextDoc, restoredDoc } = applyAndInvert(doc, command);
		assert.equal(nextDoc.ir.parts.length, 1);
		assert.equal(restoredDoc.ir.parts.length, 2);
	});
});

describe("SchematicCanvas source wiring verification", () => {
	test("imports clipboard helpers from ./clipboard.js", () => {
		const helpers = [
			"copySchematic",
			"pasteSchematicCommands",
			"duplicateSchematicCommands",
			"cutSchematicCommands",
			"selectAllIds",
		];
		for (const helper of helpers) {
			assert.match(
				schSrc,
				new RegExp(
					`import\\s*\\{[^}]*\\b${helper}\\b[^}]*\\}\\s*from\\s*"\\./clipboard\\.js";`,
				),
			);
		}
	});

	test("ACTION_KEY_HANDLERS table registers copy, paste, cut, duplicate, selectAll", () => {
		const registrations = [
			/copy:\s*handleCopyKey/,
			/paste:\s*handlePasteKey/,
			/cut:\s*handleCutKey/,
			/duplicate:\s*handleDuplicateKey/,
			/selectAll:\s*handleSelectAllKey/,
		];
		for (const pattern of registrations) {
			assert.match(schSrc, pattern);
		}
	});

	test("preserves existing test expectation: setTextModal call", () => {
		assert.match(schSrc, /s\.annotationSession\.setTextModal\(ann\);/);
	});

	test("hotkeys resolveSchematicAction blocks execution while typing in inputs", () => {
		const cases = [
			{ key: "c", ctrlKey: true, target: { tagName: "INPUT" } },
			{ key: "v", ctrlKey: true, target: { tagName: "TEXTAREA" } },
			{ key: "x", ctrlKey: true, target: { isContentEditable: true } },
			{ key: "d", ctrlKey: true, target: { tagName: "INPUT" } },
			{ key: "a", ctrlKey: true, target: { tagName: "INPUT" } },
		];
		for (const evt of cases) {
			assert.equal(resolveSchematicAction(evt), null);
		}
	});
});
