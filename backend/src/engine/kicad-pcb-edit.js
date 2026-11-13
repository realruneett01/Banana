import { randomUUID } from "node:crypto";
import { parse, serialize, sym } from "./sexpr.js";

function roundCoord(val) {
	const r = Math.round(Number(val) * 10000) / 10000;
	return Object.is(r, -0) ? 0 : r;
}

function nodeSym(node) {
	if (node === null || node === undefined) return "";
	return typeof node === "object" ? (node.sym ?? "") : String(node);
}

function isString(val) {
	return typeof val === "string" && val.length > 0;
}

function isPresent(val) {
	return val !== undefined && val !== null;
}

function isPositiveNumber(val) {
	return Number.isFinite(val) && val > 0;
}

function findChildByTag(node, tag) {
	if (!Array.isArray(node)) return null;
	return node.find((c) => Array.isArray(c) && c[0]?.sym === tag) ?? null;
}

function matchProp(child, name) {
	if (!Array.isArray(child) || child.length < 3) return false;
	const head = child[0]?.sym;
	if (head === "property") {
		return nodeSym(child[1]) === name;
	}
	if (head === "fp_text") {
		return nodeSym(child[1]).toLowerCase() === name.toLowerCase();
	}
	return false;
}

function extractPropRef(child) {
	return matchProp(child, "Reference") ? nodeSym(child[2]) : null;
}

function getFootprintRef(fpNode) {
	if (!Array.isArray(fpNode)) return null;
	for (let i = 1; i < fpNode.length; i++) {
		const ref = extractPropRef(fpNode[i]);
		if (ref !== null) return ref;
	}
	return null;
}

function findFootprintIndex(ast, ref) {
	for (let i = 1; i < ast.length; i++) {
		if (getFootprintRef(ast[i]) === ref) return i;
	}
	return -1;
}

function findFootprintNode(ast, ref) {
	const idx = findFootprintIndex(ast, ref);
	return idx !== -1 ? ast[idx] : null;
}

function flipLayerString(str) {
	if (typeof str !== "string") return str;
	if (str.startsWith("F.")) return `B.${str.slice(2)}`;
	if (str.startsWith("B.")) return `F.${str.slice(2)}`;
	return str;
}

function flipNodeLayers(node) {
	if (!Array.isArray(node)) return;
	const head = node[0]?.sym;
	if (head === "layer" && node.length > 1) {
		node[1] = flipLayerString(node[1]);
	} else if (head === "layers") {
		for (let i = 1; i < node.length; i++) {
			node[i] = flipLayerString(node[i]);
		}
	}
	for (let i = 1; i < node.length; i++) {
		flipNodeLayers(node[i]);
	}
}

function isCoordHead(head) {
	const heads = ["at", "start", "end", "center", "mid", "xy"];
	return heads.includes(head);
}

function mirrorNodeCoordinates(node) {
	if (!Array.isArray(node)) return;
	const head = node[0]?.sym;
	if (isCoordHead(head) && Number.isFinite(node[1])) {
		node[1] = roundCoord(-node[1]);
	}
	for (let i = 1; i < node.length; i++) {
		mirrorNodeCoordinates(node[i]);
	}
}

function refreshChildUuids(node, newUuid) {
	if (!Array.isArray(node)) return;
	if (node[0]?.sym === "uuid" && node.length > 1) {
		node[1] = newUuid();
		return;
	}
	for (let i = 1; i < node.length; i++) {
		refreshChildUuids(node[i], newUuid);
	}
}

function findLastIndexByHeads(ast, heads) {
	for (let i = ast.length - 1; i >= 1; i--) {
		const head = ast[i]?.[0]?.sym;
		if (heads.includes(head)) return i;
	}
	return -1;
}

function findFootprintInsertIndex(ast) {
	let lastIdx = -1;
	for (let i = 1; i < ast.length; i++) {
		const head = ast[i]?.[0]?.sym;
		if (head === "footprint" || head === "module") {
			lastIdx = i;
		}
	}
	if (lastIdx !== -1) return lastIdx + 1;
	const fallback = findLastIndexByHeads(ast, ["net", "setup"]);
	return fallback !== -1 ? fallback + 1 : ast.length;
}

function updateOrAddProperty(fpNode, name, value, defaultLayer) {
	for (let i = 1; i < fpNode.length; i++) {
		const child = fpNode[i];
		if (matchProp(child, name)) {
			child[2] = value;
			return;
		}
	}
	fpNode.push([
		sym("property"),
		name,
		value,
		[sym("at"), 0, 0, 0],
		[sym("layer"), defaultLayer],
	]);
}

function findNetDecl(ast, netName) {
	let targetNetNum = null;
	let maxNetNum = 0;
	let lastNetIdx = -1;
	for (let i = 1; i < ast.length; i++) {
		const node = ast[i];
		if (!Array.isArray(node) || node[0]?.sym !== "net") continue;
		lastNetIdx = i;
		const num = Number(node[1]);
		if (Number.isFinite(num) && num > maxNetNum) maxNetNum = num;
		if (node[2] === netName) targetNetNum = num;
	}
	return { targetNetNum, maxNetNum, lastNetIdx };
}

function findNetInsertIndex(ast) {
	const idx = findLastIndexByHeads(ast, ["setup", "layers"]);
	return idx !== -1 ? idx + 1 : 1;
}

function ensureNetDeclaration(ast, netName) {
	const info = findNetDecl(ast, netName);
	if (info.targetNetNum !== null) return info.targetNetNum;
	const nextNum = info.maxNetNum + 1;
	const decl = [sym("net"), nextNum, netName];
	const pos =
		info.lastNetIdx !== -1 ? info.lastNetIdx + 1 : findNetInsertIndex(ast);
	ast.splice(pos, 0, decl);
	return nextNum;
}

// KiCad 10 boards have no top-level (net N "name") table: tracks, vias and
// pads name their net inline as (net "GND"), and unconnected items omit it.
function usesNamedNets(ast) {
	return !ast.some((c, i) => i > 0 && Array.isArray(c) && c[0]?.sym === "net");
}

function namedNetNodes(net) {
	if (isString(net)) return [[sym("net"), net]];
	return net === 0 ? [] : null;
}

// Returns the (net ...) children for a new track or via, or null if invalid.
function netNodesFor(ast, net) {
	if (usesNamedNets(ast)) return namedNetNodes(net);
	const netNum = resolveNetNumber(ast, net);
	return netNum === null ? null : [[sym("net"), netNum]];
}

function padNetNode(ast, netName) {
	if (usesNamedNets(ast)) return [sym("net"), netName];
	return [sym("net"), ensureNetDeclaration(ast, netName), netName];
}

function resolveNetNumber(ast, net) {
	if (typeof net === "number" && Number.isFinite(net)) {
		return net;
	}
	if (isString(net)) {
		const decl = findNetDecl(ast, net);
		if (decl.targetNetNum !== null) return decl.targetNetNum;
		const num = Number(net);
		if (Number.isFinite(num)) return num;
		return ensureNetDeclaration(ast, net);
	}
	return null;
}

function applyFootprintSideB(fpNode) {
	const layerNode = findChildByTag(fpNode, "layer");
	if (layerNode) {
		layerNode[1] = flipLayerString(layerNode[1]);
	} else {
		fpNode.push([sym("layer"), "B.Cu"]);
	}
	for (let i = 1; i < fpNode.length; i++) {
		const child = fpNode[i];
		if (!Array.isArray(child)) continue;
		const head = child[0]?.sym;
		if (["at", "uuid", "layer"].includes(head)) continue;
		flipNodeLayers(child);
		mirrorNodeCoordinates(child);
	}
}

function updateFootprintAt(fpNode, x, y, rot) {
	const atNode = findChildByTag(fpNode, "at");
	const rx = roundCoord(x);
	const ry = roundCoord(y);
	const rrot = roundCoord(rot);
	if (atNode) {
		atNode[1] = rx;
		atNode[2] = ry;
		atNode[3] = rrot;
		return;
	}
	fpNode.push([sym("at"), rx, ry, rrot]);
}

function updateFootprintUuids(fpNode, newUuid) {
	const fpUuid = findChildByTag(fpNode, "uuid");
	if (fpUuid) {
		fpUuid[1] = newUuid();
	} else {
		fpNode.push([sym("uuid"), newUuid()]);
	}
	for (let i = 1; i < fpNode.length; i++) {
		const child = fpNode[i];
		if (Array.isArray(child) && child !== fpUuid) {
			refreshChildUuids(child, newUuid);
		}
	}
}

const ADD_FP_STRING_FIELDS = [
	["libId", "Invalid libId"],
	["source", "Invalid source"],
	["ref", "Invalid ref"],
];

function validateAddFootprintFields(edit) {
	for (const [key, msg] of ADD_FP_STRING_FIELDS) {
		if (!isString(edit[key])) return msg;
	}
	if (!isPresent(edit.value)) return "Invalid value";
	return null;
}

function validateAddFootprintCoords(edit) {
	if (!Number.isFinite(edit.x) || !Number.isFinite(edit.y)) {
		return "Non-finite coordinates";
	}
	if (edit.rot !== undefined && !Number.isFinite(edit.rot)) {
		return "Non-finite rotation";
	}
	return null;
}

function validateAddFootprint(edit) {
	return validateAddFootprintFields(edit) ?? validateAddFootprintCoords(edit);
}

function parseFootprintSource(source) {
	try {
		const parsed = parse(source);
		if (Array.isArray(parsed) && parsed[0]?.sym === "footprint") {
			return { ok: true, node: structuredClone(parsed) };
		}
		return { ok: false, error: "Source is not a footprint" };
	} catch (e) {
		return { ok: false, error: e.message };
	}
}

function configureFootprintNode(fpNode, edit, newUuid) {
	fpNode[1] = edit.libId;
	updateFootprintAt(fpNode, edit.x, edit.y, edit.rot ?? 0);
	const side = edit.side ?? "F";
	const refLayer = side === "B" ? "B.SilkS" : "F.SilkS";
	const valLayer = side === "B" ? "B.Fab" : "F.Fab";
	updateOrAddProperty(fpNode, "Reference", edit.ref, refLayer);
	updateOrAddProperty(fpNode, "Value", String(edit.value), valLayer);
	updateFootprintUuids(fpNode, newUuid);
	if (side === "B") applyFootprintSideB(fpNode);
}

function handleAddFootprint(ast, edit, newUuid) {
	const err = validateAddFootprint(edit);
	if (err) return { ok: false, error: err };
	const parsed = parseFootprintSource(edit.source);
	if (!parsed.ok) return parsed;
	configureFootprintNode(parsed.node, edit, newUuid);
	const insertIdx = findFootprintInsertIndex(ast);
	ast.splice(insertIdx, 0, parsed.node);
	return { ok: true };
}

function handleDeleteFootprint(ast, edit) {
	if (!isString(edit.ref)) {
		return { ok: false, error: "Invalid ref" };
	}
	const idx = findFootprintIndex(ast, edit.ref);
	if (idx === -1) {
		return { ok: false, error: `Footprint ${edit.ref} not found` };
	}
	ast.splice(idx, 1);
	return { ok: true };
}

function validateSetFootprintField(edit) {
	if (!isString(edit.ref)) return "Invalid ref";
	if (!isString(edit.name)) return "Invalid name";
	if (!isPresent(edit.value)) return "Invalid value";
	return null;
}

function handleSetFootprintField(ast, edit) {
	const err = validateSetFootprintField(edit);
	if (err) return { ok: false, error: err };
	const fpNode = findFootprintNode(ast, edit.ref);
	if (!fpNode) {
		return { ok: false, error: `Footprint ${edit.ref} not found` };
	}
	updateOrAddProperty(fpNode, edit.name, String(edit.value), "F.SilkS");
	return { ok: true };
}

function updateMatchingPads(matchingPads, netNode) {
	for (const padNode of matchingPads) {
		const idx = padNode.findIndex(
			(c) => Array.isArray(c) && c[0]?.sym === "net",
		);
		if (idx === -1) padNode.push([...netNode]);
		else padNode[idx] = [...netNode];
	}
}

function isPadMatching(child, padStr) {
	if (!Array.isArray(child) || child[0]?.sym !== "pad") return false;
	return String(child[1]) === padStr;
}

function findMatchingPads(fpNode, pad) {
	const padStr = String(pad);
	return fpNode.filter((c) => isPadMatching(c, padStr));
}

function validateSetPadNet(edit) {
	if (!isString(edit.ref)) return "Invalid ref";
	if (!isPresent(edit.pad)) return "Invalid pad";
	if (!isString(edit.net)) return "Invalid net";
	return null;
}

function handleSetPadNet(ast, edit) {
	const err = validateSetPadNet(edit);
	if (err) return { ok: false, error: err };
	const fpNode = findFootprintNode(ast, edit.ref);
	if (!fpNode) return { ok: false, error: `Footprint ${edit.ref} not found` };
	const matching = findMatchingPads(fpNode, edit.pad);
	if (matching.length === 0) {
		return { ok: false, error: `Pad ${edit.pad} not found on ${edit.ref}` };
	}
	updateMatchingPads(matching, padNetNode(ast, edit.net));
	return { ok: true };
}

function isValidPoint(p) {
	return Boolean(p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

function validateTrackPoints(points) {
	if (!Array.isArray(points) || points.length < 2) return false;
	return points.every(isValidPoint);
}

function validateTrackParams(edit) {
	if (!isString(edit.layer)) return "Invalid layer";
	if (!isPositiveNumber(edit.width)) return "Invalid width";
	if (!validateTrackPoints(edit.points)) return "Invalid points";
	return null;
}

function handleAddTrack(ast, edit, newUuid) {
	const err = validateTrackParams(edit);
	if (err) return { ok: false, error: err };
	const netNodes = netNodesFor(ast, edit.net);
	if (netNodes === null) return { ok: false, error: "Invalid net" };
	const w = roundCoord(edit.width);
	for (let i = 0; i < edit.points.length - 1; i++) {
		const p1 = edit.points[i];
		const p2 = edit.points[i + 1];
		ast.push([
			sym("segment"),
			[sym("start"), roundCoord(p1.x), roundCoord(p1.y)],
			[sym("end"), roundCoord(p2.x), roundCoord(p2.y)],
			[sym("width"), w],
			[sym("layer"), edit.layer],
			...structuredClone(netNodes),
			[sym("uuid"), newUuid()],
		]);
	}
	return { ok: true };
}

function validateViaParams(edit, size, drill) {
	if (!Number.isFinite(edit.x) || !Number.isFinite(edit.y)) {
		return "Non-finite coords";
	}
	if (!isPositiveNumber(size)) return "Invalid via size";
	if (!isPositiveNumber(drill)) return "Invalid via drill";
	return null;
}

function handleAddVia(ast, edit, newUuid) {
	const size = edit.size ?? 0.6;
	const drill = edit.drill ?? 0.3;
	const err = validateViaParams(edit, size, drill);
	if (err) return { ok: false, error: err };
	const netNodes = netNodesFor(ast, edit.net);
	if (netNodes === null) return { ok: false, error: "Invalid net" };
	ast.push([
		sym("via"),
		[sym("at"), roundCoord(edit.x), roundCoord(edit.y)],
		[sym("size"), roundCoord(size)],
		[sym("drill"), roundCoord(drill)],
		[sym("layers"), "F.Cu", "B.Cu"],
		...netNodes,
		[sym("uuid"), newUuid()],
	]);
	return { ok: true };
}

function isTrackNode(node, uuid) {
	if (!Array.isArray(node)) return false;
	const head = node[0]?.sym;
	if (!["segment", "via", "arc"].includes(head)) return false;
	const uuidChild = findChildByTag(node, "uuid");
	return uuidChild?.[1] === uuid;
}

function handleDeleteTrack(ast, edit) {
	if (!isString(edit.uuid)) {
		return { ok: false, error: "Invalid track uuid" };
	}
	const idx = ast.findIndex((node, i) => i > 0 && isTrackNode(node, edit.uuid));
	if (idx === -1) {
		return { ok: false, error: `Track ${edit.uuid} not found` };
	}
	ast.splice(idx, 1);
	return { ok: true };
}

const HANDLERS = {
	addFootprint: handleAddFootprint,
	deleteFootprint: handleDeleteFootprint,
	setFootprintField: handleSetFootprintField,
	setPadNet: handleSetPadNet,
	addTrack: handleAddTrack,
	addVia: handleAddVia,
	deleteTrack: handleDeleteTrack,
};

function dispatchEdit(ast, edit, newUuid) {
	if (!edit || typeof edit !== "object") {
		return { ok: false, error: "Edit must be an object" };
	}
	const handler = HANDLERS[edit.op];
	if (!handler) {
		return { ok: false, error: `Unknown operation: ${String(edit.op)}` };
	}
	return handler(ast, edit, newUuid);
}

function parsePcbAst(text) {
	try {
		const ast = parse(text);
		if (!Array.isArray(ast) || ast[0]?.sym !== "kicad_pcb") {
			return { ok: false, error: "Input is not a kicad_pcb sexpr" };
		}
		return { ok: true, ast };
	} catch (e) {
		return { ok: false, error: `Parse error: ${e.message}` };
	}
}

export function applyPcbEdits(text, edits, { newUuid = randomUUID } = {}) {
	if (typeof text !== "string") {
		return { ok: false, error: "text must be a string" };
	}
	if (!Array.isArray(edits)) {
		return { ok: false, error: "edits must be an array" };
	}
	const parsed = parsePcbAst(text);
	if (!parsed.ok) return parsed;
	for (const edit of edits) {
		const res = dispatchEdit(parsed.ast, edit, newUuid);
		if (!res.ok) return res;
	}
	return { ok: true, text: serialize(parsed.ast) };
}
