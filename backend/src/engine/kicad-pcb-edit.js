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

function extractPropRef(child) {
	if (!Array.isArray(child) || child.length < 3) return null;
	const head = child[0]?.sym;
	if (head === "property" && nodeSym(child[1]) === "Reference") {
		return nodeSym(child[2]);
	}
	if (head === "fp_text" && nodeSym(child[1]).toLowerCase() === "reference") {
		return nodeSym(child[2]);
	}
	return null;
}

function getFootprintRef(fpNode) {
	if (!Array.isArray(fpNode)) return null;
	for (let i = 1; i < fpNode.length; i++) {
		const ref = extractPropRef(fpNode[i]);
		if (ref !== null) return ref;
	}
	return null;
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

function findFootprintInsertIndex(ast) {
	let lastIdx = -1;
	for (let i = 1; i < ast.length; i++) {
		const head = ast[i]?.[0]?.sym;
		if (head === "footprint" || head === "module") {
			lastIdx = i;
		}
	}
	if (lastIdx !== -1) return lastIdx + 1;
	for (let i = ast.length - 1; i >= 1; i--) {
		const head = ast[i]?.[0]?.sym;
		if (head === "net" || head === "setup") return i + 1;
	}
	return ast.length;
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
	for (let i = ast.length - 1; i >= 1; i--) {
		const head = ast[i]?.[0]?.sym;
		if (head === "setup" || head === "layers") return i + 1;
	}
	return 1;
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

function resolveNetNumber(ast, net) {
	if (typeof net === "number" && Number.isFinite(net)) {
		return net;
	}
	if (typeof net === "string" && net.length > 0) {
		const decl = findNetDecl(ast, net);
		if (decl.targetNetNum !== null) return decl.targetNetNum;
		const num = Number(net);
		if (Number.isFinite(num)) return num;
		return ensureNetDeclaration(ast, net);
	}
	return null;
}

function applyFootprintSideB(fpNode) {
	const layerNode = fpNode.find(
		(c) => Array.isArray(c) && c[0]?.sym === "layer",
	);
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
	const atNode = fpNode.find((c) => Array.isArray(c) && c[0]?.sym === "at");
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
	const fpUuid = fpNode.find((c) => Array.isArray(c) && c[0]?.sym === "uuid");
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

function validateAddFootprint(edit) {
	if (!edit.libId || typeof edit.libId !== "string") return "Invalid libId";
	if (!edit.source || typeof edit.source !== "string") return "Invalid source";
	if (!edit.ref || typeof edit.ref !== "string") return "Invalid ref";
	if (edit.value === undefined || edit.value === null) return "Invalid value";
	if (!Number.isFinite(edit.x) || !Number.isFinite(edit.y)) {
		return "Non-finite coordinates";
	}
	if (edit.rot !== undefined && !Number.isFinite(edit.rot)) {
		return "Non-finite rotation";
	}
	return null;
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

function handleAddFootprint(ast, edit, newUuid) {
	const err = validateAddFootprint(edit);
	if (err) return { ok: false, error: err };
	const parsed = parseFootprintSource(edit.source);
	if (!parsed.ok) return parsed;
	const fpNode = parsed.node;
	fpNode[1] = edit.libId;
	updateFootprintAt(fpNode, edit.x, edit.y, edit.rot ?? 0);
	const side = edit.side ?? "F";
	const refLayer = side === "B" ? "B.SilkS" : "F.SilkS";
	const valLayer = side === "B" ? "B.Fab" : "F.Fab";
	updateOrAddProperty(fpNode, "Reference", edit.ref, refLayer);
	updateOrAddProperty(fpNode, "Value", String(edit.value), valLayer);
	updateFootprintUuids(fpNode, newUuid);
	if (side === "B") applyFootprintSideB(fpNode);
	const insertIdx = findFootprintInsertIndex(ast);
	ast.splice(insertIdx, 0, fpNode);
	return { ok: true };
}

function handleDeleteFootprint(ast, edit) {
	if (!edit.ref || typeof edit.ref !== "string") {
		return { ok: false, error: "Invalid ref" };
	}
	const idx = ast.findIndex(
		(node, i) =>
			i > 0 && Array.isArray(node) && getFootprintRef(node) === edit.ref,
	);
	if (idx === -1) {
		return { ok: false, error: `Footprint ${edit.ref} not found` };
	}
	ast.splice(idx, 1);
	return { ok: true };
}

function handleSetFootprintField(ast, edit) {
	if (!edit.ref || typeof edit.ref !== "string") {
		return { ok: false, error: "Invalid ref" };
	}
	if (!edit.name || typeof edit.name !== "string") {
		return { ok: false, error: "Invalid name" };
	}
	if (edit.value === undefined || edit.value === null) {
		return { ok: false, error: "Invalid value" };
	}
	const fpNode = ast.find(
		(node, i) =>
			i > 0 && Array.isArray(node) && getFootprintRef(node) === edit.ref,
	);
	if (!fpNode) {
		return { ok: false, error: `Footprint ${edit.ref} not found` };
	}
	updateOrAddProperty(fpNode, edit.name, String(edit.value), "F.SilkS");
	return { ok: true };
}

function updateMatchingPads(matchingPads, netNum, netName) {
	for (const padNode of matchingPads) {
		const netChild = padNode.find(
			(c) => Array.isArray(c) && c[0]?.sym === "net",
		);
		if (netChild) {
			netChild[1] = netNum;
			netChild[2] = netName;
		} else {
			padNode.push([sym("net"), netNum, netName]);
		}
	}
}

function handleSetPadNet(ast, edit) {
	if (!edit.ref || typeof edit.ref !== "string") {
		return { ok: false, error: "Invalid ref" };
	}
	if (edit.pad === undefined || edit.pad === null) {
		return { ok: false, error: "Invalid pad" };
	}
	if (!edit.net || typeof edit.net !== "string") {
		return { ok: false, error: "Invalid net" };
	}
	const fpNode = ast.find(
		(n, i) => i > 0 && Array.isArray(n) && getFootprintRef(n) === edit.ref,
	);
	if (!fpNode) return { ok: false, error: `Footprint ${edit.ref} not found` };
	const padStr = String(edit.pad);
	const matching = fpNode.filter(
		(c) => Array.isArray(c) && c[0]?.sym === "pad" && String(c[1]) === padStr,
	);
	if (matching.length === 0) {
		return { ok: false, error: `Pad ${edit.pad} not found on ${edit.ref}` };
	}
	const netNum = ensureNetDeclaration(ast, edit.net);
	updateMatchingPads(matching, netNum, edit.net);
	return { ok: true };
}

function validateTrackPoints(points) {
	if (!Array.isArray(points) || points.length < 2) return false;
	return points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

function handleAddTrack(ast, edit, newUuid) {
	if (!edit.layer || typeof edit.layer !== "string") {
		return { ok: false, error: "Invalid layer" };
	}
	if (!Number.isFinite(edit.width) || edit.width <= 0) {
		return { ok: false, error: "Invalid width" };
	}
	if (!validateTrackPoints(edit.points)) {
		return { ok: false, error: "Invalid points" };
	}
	const netNum = resolveNetNumber(ast, edit.net);
	if (netNum === null) return { ok: false, error: "Invalid net" };
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
			[sym("net"), netNum],
			[sym("uuid"), newUuid()],
		]);
	}
	return { ok: true };
}

function handleAddVia(ast, edit, newUuid) {
	if (!Number.isFinite(edit.x) || !Number.isFinite(edit.y)) {
		return { ok: false, error: "Non-finite coords" };
	}
	const size = edit.size ?? 0.6;
	const drill = edit.drill ?? 0.3;
	if (!Number.isFinite(size) || size <= 0) {
		return { ok: false, error: "Invalid via size" };
	}
	if (!Number.isFinite(drill) || drill <= 0) {
		return { ok: false, error: "Invalid via drill" };
	}
	const netNum = resolveNetNumber(ast, edit.net);
	if (netNum === null) return { ok: false, error: "Invalid net" };
	ast.push([
		sym("via"),
		[sym("at"), roundCoord(edit.x), roundCoord(edit.y)],
		[sym("size"), roundCoord(size)],
		[sym("drill"), roundCoord(drill)],
		[sym("layers"), "F.Cu", "B.Cu"],
		[sym("net"), netNum],
		[sym("uuid"), newUuid()],
	]);
	return { ok: true };
}

function isTrackNode(node, uuid) {
	if (!Array.isArray(node)) return false;
	const head = node[0]?.sym;
	if (!["segment", "via", "arc"].includes(head)) return false;
	const uuidChild = node.find((c) => Array.isArray(c) && c[0]?.sym === "uuid");
	return uuidChild?.[1] === uuid;
}

function handleDeleteTrack(ast, edit) {
	if (!edit.uuid || typeof edit.uuid !== "string") {
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

export function applyPcbEdits(text, edits, { newUuid = randomUUID } = {}) {
	if (typeof text !== "string") {
		return { ok: false, error: "text must be a string" };
	}
	if (!Array.isArray(edits)) {
		return { ok: false, error: "edits must be an array" };
	}
	let ast;
	try {
		ast = parse(text);
	} catch (e) {
		return { ok: false, error: `Parse error: ${e.message}` };
	}
	if (!Array.isArray(ast) || ast[0]?.sym !== "kicad_pcb") {
		return { ok: false, error: "Input is not a kicad_pcb sexpr" };
	}
	for (const edit of edits) {
		const res = dispatchEdit(ast, edit, newUuid);
		if (!res.ok) return res;
	}
	return { ok: true, text: serialize(ast) };
}
