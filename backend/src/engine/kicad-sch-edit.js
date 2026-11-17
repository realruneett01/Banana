import { randomUUID } from "node:crypto";
import { parse, serialize, sym } from "./sexpr.js";

function nodeName(node) {
	if (!Array.isArray(node) || !node[0]) {
		return null;
	}
	return typeof node[0].sym === "string" ? node[0].sym : null;
}

function round4(n) {
	const rounded = Math.round(n * 10000) / 10000;
	return Object.is(rounded, -0) ? 0 : rounded;
}

function checkFiniteCoord(val, label) {
	if (typeof val !== "number" || !Number.isFinite(val)) {
		throw new Error(`Invalid coordinate for ${label}: ${val}`);
	}
	return round4(val);
}

function findRootUuid(root) {
	for (const child of root) {
		if (nodeName(child) === "uuid" && child[1]) {
			return typeof child[1] === "string" ? child[1] : child[1].sym;
		}
	}
	return null;
}

function extractTitleNode(titleBlock) {
	for (const prop of titleBlock) {
		if (nodeName(prop) === "title" && prop[1]) {
			return typeof prop[1] === "string" ? prop[1] : prop[1].sym;
		}
	}
	return null;
}

function findProjectTitle(root) {
	for (const child of root) {
		if (nodeName(child) === "title_block") {
			return extractTitleNode(child);
		}
	}
	return null;
}

function resolveLibSymbolsNode(root) {
	let node = root.find((child) => nodeName(child) === "lib_symbols");
	if (!node) {
		node = [sym("lib_symbols")];
		const titleIdx = root.findIndex((c) => nodeName(c) === "title_block");
		const insIdx = titleIdx !== -1 ? titleIdx + 1 : 1;
		root.splice(insIdx, 0, node);
	}
	return node;
}

function hasLibSymbolEntry(libSymbolsNode, libId) {
	for (let i = 1; i < libSymbolsNode.length; i++) {
		const entry = libSymbolsNode[i];
		const isSym = nodeName(entry) === "symbol";
		const id = typeof entry?.[1] === "string" ? entry[1] : entry?.[1]?.sym;
		if (isSym && id === libId) {
			return true;
		}
	}
	return false;
}

function ensureLibSymbol(libSymbolsNode, libId, libSymbolText) {
	if (hasLibSymbolEntry(libSymbolsNode, libId)) {
		return;
	}
	if (!libSymbolText || typeof libSymbolText !== "string") {
		throw new Error(`Missing libSymbol for ${libId}`);
	}
	const parsed = parse(libSymbolText);
	if (!Array.isArray(parsed) || nodeName(parsed) !== "symbol") {
		throw new Error(`Invalid libSymbol s-expression for ${libId}`);
	}
	parsed[1] = libId;
	libSymbolsNode.push(parsed);
}

function buildPropertyNode(name, value, at, isHidden) {
	const fontNode = [sym("effects"), [sym("font"), [sym("size"), 1.27, 1.27]]];
	const prop = [sym("property"), name, String(value ?? ""), at, fontNode];
	if (isHidden) {
		prop.push([sym("hide"), sym("yes")]);
	}
	return prop;
}

function buildPlacedProperties(edit, at) {
	return [
		buildPropertyNode("Reference", edit.ref, at, false),
		buildPropertyNode("Value", edit.value ?? "", at, false),
		buildPropertyNode("Footprint", edit.footprint ?? "", at, true),
	];
}

function buildPins(pins, newUuid) {
	if (!Array.isArray(pins)) {
		return [];
	}
	return pins.map((pin) => [sym("pin"), String(pin), [sym("uuid"), newUuid()]]);
}

function newUuidFallback(ctx) {
	return ctx.newUuid ? ctx.newUuid() : "00000000-0000-0000-0000-000000000000";
}

function buildInstancesNode(ref, unit, ctx) {
	const rootUuid = ctx.rootUuid || newUuidFallback(ctx);
	const sheetPath = rootUuid.startsWith("/") ? rootUuid : `/${rootUuid}`;
	return [
		sym("instances"),
		[
			sym("project"),
			ctx.projectName,
			[sym("path"), sheetPath, [sym("reference"), ref], [sym("unit"), unit]],
		],
	];
}

function buildPlacedSymbolNode(edit, ctx) {
	const x = checkFiniteCoord(edit.x, "x");
	const y = checkFiniteCoord(edit.y, "y");
	const rot = edit.rot !== undefined ? checkFiniteCoord(edit.rot, "rot") : 0;
	const unit = edit.unit !== undefined ? edit.unit : 1;
	const at = [sym("at"), x, y, rot];
	const props = buildPlacedProperties(edit, at);
	const pins = buildPins(edit.pins, ctx.newUuid);
	const instances = buildInstancesNode(edit.ref, unit, ctx);
	return [
		sym("symbol"),
		[sym("lib_id"), edit.libId],
		at,
		[sym("unit"), unit],
		[sym("exclude_from_sim"), sym("no")],
		[sym("in_bom"), sym("yes")],
		[sym("on_board"), sym("yes")],
		[sym("dnp"), sym("no")],
		[sym("uuid"), ctx.newUuid()],
		...props,
		...pins,
		instances,
	];
}

function findSymbolInsertIndex(root) {
	let lastSymbolIdx = -1;
	let libSymbolsIdx = -1;
	for (let i = 0; i < root.length; i++) {
		const name = nodeName(root[i]);
		if (name === "symbol") {
			lastSymbolIdx = i;
		} else if (name === "lib_symbols") {
			libSymbolsIdx = i;
		}
	}
	if (lastSymbolIdx !== -1) return lastSymbolIdx + 1;
	if (libSymbolsIdx !== -1) return libSymbolsIdx + 1;
	return root.length;
}

function handleAddSymbol(root, edit, ctx) {
	if (!edit.ref || !edit.libId) {
		throw new Error("addSymbol requires ref and libId");
	}
	const libSymbolsNode = resolveLibSymbolsNode(root);
	ensureLibSymbol(libSymbolsNode, edit.libId, edit.libSymbol);
	const symbolNode = buildPlacedSymbolNode(edit, ctx);
	const insertIdx = findSymbolInsertIndex(root);
	root.splice(insertIdx, 0, symbolNode);
}

function getSymbolPropValue(symbolNode, name) {
	for (const child of symbolNode) {
		const isProp = nodeName(child) === "property";
		const pName = typeof child?.[1] === "string" ? child[1] : child?.[1]?.sym;
		if (isProp && pName === name) {
			return typeof child[2] === "string" ? child[2] : (child[2]?.sym ?? "");
		}
	}
	return null;
}

function isPlacedSymbolWithRef(child, ref) {
	if (nodeName(child) !== "symbol") {
		return false;
	}
	return getSymbolPropValue(child, "Reference") === ref;
}

function handleDeleteSymbol(root, edit) {
	if (!edit.ref) {
		throw new Error("deleteSymbol requires ref");
	}
	let removed = 0;
	for (let i = root.length - 1; i >= 0; i--) {
		if (isPlacedSymbolWithRef(root[i], edit.ref)) {
			root.splice(i, 1);
			removed++;
		}
	}
	if (removed === 0) {
		throw new Error(`Symbol not found: ${edit.ref}`);
	}
}

function updateSymbolProperty(symbolNode, name, value) {
	for (const child of symbolNode) {
		const isProp = nodeName(child) === "property";
		const pName = typeof child?.[1] === "string" ? child[1] : child?.[1]?.sym;
		if (isProp && pName === name) {
			child[2] = String(value ?? "");
			return true;
		}
	}
	return false;
}

function findSymbolAtNode(symbolNode) {
	const atNode = symbolNode.find((c) => nodeName(c) === "at");
	if (atNode) {
		return [sym("at"), atNode[1], atNode[2], 0];
	}
	return [sym("at"), 0, 0, 0];
}

function insertMissingProperty(symbolNode, name, value) {
	const at = findSymbolAtNode(symbolNode);
	const newProp = buildPropertyNode(name, value, at, true);
	const insIdx = symbolNode.findIndex((c) => {
		const n = nodeName(c);
		return n === "pin" || n === "instances";
	});
	if (insIdx !== -1) {
		symbolNode.splice(insIdx, 0, newProp);
	} else {
		symbolNode.push(newProp);
	}
}

function updateInstancesReference(node, newRef) {
	if (!Array.isArray(node)) return;
	if (nodeName(node) === "reference") {
		node[1] = String(newRef);
		return;
	}
	for (const child of node) {
		updateInstancesReference(child, newRef);
	}
}

function applySetFieldToSymbol(symbolNode, name, value) {
	const updated = updateSymbolProperty(symbolNode, name, value);
	if (!updated) {
		insertMissingProperty(symbolNode, name, value);
	}
	if (name === "Reference") {
		updateInstancesReference(symbolNode, value);
	}
}

function handleSetField(root, edit) {
	if (!edit.ref || !edit.name) {
		throw new Error("setField requires ref and name");
	}
	let matched = 0;
	for (const child of root) {
		if (isPlacedSymbolWithRef(child, edit.ref)) {
			applySetFieldToSymbol(child, edit.name, edit.value);
			matched++;
		}
	}
	if (matched === 0) {
		throw new Error(`Symbol not found: ${edit.ref}`);
	}
}

function findItemsInsertIndex(root) {
	const sheetInstIdx = root.findIndex(
		(child) => nodeName(child) === "sheet_instances",
	);
	return sheetInstIdx !== -1 ? sheetInstIdx : root.length;
}

const LABEL_KINDS = {
	local: "label",
	global: "global_label",
	hierarchical: "hierarchical_label",
};

const DELETABLE_ITEM_HEADS = new Set([
	"label",
	"global_label",
	"hierarchical_label",
	"no_connect",
	"junction",
	"text",
	"polyline",
	"bus",
]);

function buildLabelNode(edit, ctx) {
	const kind = edit.kind ?? "local";
	const head = LABEL_KINDS[kind];
	if (!head) {
		throw new Error(`Invalid label kind: ${kind}`);
	}
	const x = checkFiniteCoord(edit.x, "x");
	const y = checkFiniteCoord(edit.y, "y");
	const rot = edit.rot !== undefined ? checkFiniteCoord(edit.rot, "rot") : 0;
	const atNode = [sym("at"), x, y, rot];
	const effectsNode = [
		sym("effects"),
		[sym("font"), [sym("size"), 1.27, 1.27]],
	];
	const uuidNode = [sym("uuid"), ctx.newUuid()];
	if (kind !== "local") {
		return [
			sym(head),
			edit.net,
			[sym("shape"), sym("input")],
			atNode,
			effectsNode,
			uuidNode,
		];
	}
	return [sym(head), edit.net, atNode, effectsNode, uuidNode];
}

function handleAddLabel(root, edit, ctx) {
	if (typeof edit.net !== "string" || edit.net.length === 0) {
		throw new Error("addLabel requires non-empty net string");
	}
	const labelNode = buildLabelNode(edit, ctx);
	root.splice(findItemsInsertIndex(root), 0, labelNode);
}

function handleAddNoConnect(root, edit, ctx) {
	const x = checkFiniteCoord(edit.x, "x");
	const y = checkFiniteCoord(edit.y, "y");
	const noConnNode = [
		sym("no_connect"),
		[sym("at"), x, y],
		[sym("uuid"), ctx.newUuid()],
	];
	root.splice(findItemsInsertIndex(root), 0, noConnNode);
}

function handleAddJunction(root, edit, ctx) {
	const x = checkFiniteCoord(edit.x, "x");
	const y = checkFiniteCoord(edit.y, "y");
	const junctionNode = [
		sym("junction"),
		[sym("at"), x, y],
		[sym("diameter"), 0],
		[sym("color"), 0, 0, 0, 0],
		[sym("uuid"), ctx.newUuid()],
	];
	root.splice(findItemsInsertIndex(root), 0, junctionNode);
}

function handleAddText(root, edit, ctx) {
	if (typeof edit.text !== "string" || edit.text.length === 0) {
		throw new Error("addText requires non-empty text string");
	}
	const x = checkFiniteCoord(edit.x, "x");
	const y = checkFiniteCoord(edit.y, "y");
	const rot = edit.rot !== undefined ? checkFiniteCoord(edit.rot, "rot") : 0;
	const textNode = [
		sym("text"),
		edit.text,
		[sym("at"), x, y, rot],
		[sym("effects"), [sym("font"), [sym("size"), 1.27, 1.27]]],
		[sym("uuid"), ctx.newUuid()],
	];
	root.splice(findItemsInsertIndex(root), 0, textNode);
}

function buildPtsNode(edit) {
	const x1 = checkFiniteCoord(edit.x1, "x1");
	const y1 = checkFiniteCoord(edit.y1, "y1");
	const x2 = checkFiniteCoord(edit.x2, "x2");
	const y2 = checkFiniteCoord(edit.y2, "y2");
	return [sym("pts"), [sym("xy"), x1, y1], [sym("xy"), x2, y2]];
}

function handleAddSegment(root, head, edit, ctx) {
	const segNode = [
		sym(head),
		buildPtsNode(edit),
		[sym("stroke"), [sym("width"), 0], [sym("type"), sym("default")]],
		[sym("uuid"), ctx.newUuid()],
	];
	root.splice(findItemsInsertIndex(root), 0, segNode);
}

function handleAddLine(root, edit, ctx) {
	return handleAddSegment(root, "polyline", edit, ctx);
}

function handleAddBus(root, edit, ctx) {
	return handleAddSegment(root, "bus", edit, ctx);
}

function itemMatchesUuid(node, uuid) {
	if (!Array.isArray(node) || !DELETABLE_ITEM_HEADS.has(nodeName(node))) {
		return false;
	}
	for (const child of node) {
		if (nodeName(child) === "uuid" && child[1]) {
			const id = typeof child[1] === "string" ? child[1] : child[1].sym;
			return id === uuid;
		}
	}
	return false;
}

function handleDeleteItem(root, edit) {
	if (typeof edit?.uuid !== "string" || edit.uuid.length === 0) {
		throw new Error("deleteItem requires non-empty uuid string");
	}
	let removed = 0;
	for (let i = root.length - 1; i >= 0; i--) {
		if (itemMatchesUuid(root[i], edit.uuid)) {
			root.splice(i, 1);
			removed++;
		}
	}
	if (removed === 0) {
		throw new Error(`Item not found: ${edit.uuid}`);
	}
}

const EDIT_HANDLERS = {
	addSymbol: handleAddSymbol,
	deleteSymbol: handleDeleteSymbol,
	setField: handleSetField,
	addLabel: handleAddLabel,
	addNoConnect: handleAddNoConnect,
	addJunction: handleAddJunction,
	addText: handleAddText,
	addLine: handleAddLine,
	addBus: handleAddBus,
	deleteItem: handleDeleteItem,
};

function dispatchEdit(root, edit, ctx) {
	const handler = EDIT_HANDLERS[edit?.op];
	if (!handler) {
		throw new Error(`Unknown or missing op: ${edit?.op}`);
	}
	return handler(root, edit, ctx);
}

function createEditContext(root, options) {
	const newUuid = options.newUuid || randomUUID;
	const rootUuid = findRootUuid(root);
	const title = findProjectTitle(root);
	const projectName = options.projectName || title || "banana";
	return { newUuid, rootUuid, projectName };
}

export function applySchEdits(text, edits, options = {}) {
	if (typeof text !== "string" || !Array.isArray(edits)) {
		return { ok: false, error: "Invalid text or edits parameter" };
	}
	let root;
	try {
		root = parse(text);
	} catch (err) {
		return { ok: false, error: `Parse error: ${err.message}` };
	}
	if (!Array.isArray(root) || nodeName(root) !== "kicad_sch") {
		return { ok: false, error: "Invalid schematic: root is not kicad_sch" };
	}
	const ctx = createEditContext(root, options);
	try {
		for (const edit of edits) {
			dispatchEdit(root, edit, ctx);
		}
		return { ok: true, text: serialize(root) };
	} catch (err) {
		return { ok: false, error: err.message };
	}
}
