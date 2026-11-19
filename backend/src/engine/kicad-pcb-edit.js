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

// Anything beyond 10 m is not a board; it would also overflow to Infinity when rounded.
const MAX_BOARD_MM = 10000;

export function isBoardCoord(val) {
	return Number.isFinite(val) && Math.abs(val) <= MAX_BOARD_MM;
}

function isPositiveNumber(val) {
	return isBoardCoord(val) && val > 0;
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

export function flipLayerString(str) {
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

// KiCad flips a footprint to the back top-bottom: local Y is negated.
function mirrorNodeCoordinates(node) {
	if (!Array.isArray(node)) return;
	const head = node[0]?.sym;
	if (isCoordHead(head) && Number.isFinite(node[2])) {
		node[2] = roundCoord(-node[2]);
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
	const headSet = new Set(heads);
	for (let i = ast.length - 1; i >= 1; i--) {
		const head = ast[i]?.[0]?.sym;
		if (headSet.has(head)) return i;
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
		if (Array.isArray(fpNode[i])) flipFootprintItem(fpNode[i]);
	}
}

function flipFootprintItem(child) {
	const head = child[0]?.sym;
	if (["at", "uuid", "layer"].includes(head)) return;
	flipNodeLayers(child);
	mirrorNodeCoordinates(child);
	// The flip negates a pad's angle; text is turned to read from below
	// and drawn mirrored.
	if (head === "pad") turnItem(child, (a) => -a);
	if (TEXT_HEADS.has(head)) {
		turnItem(child, (a) => 180 - a);
		toggleTextMirror(child);
	}
}

const TEXT_HEADS = new Set(["property", "fp_text"]);

function childOrNew(node, tag) {
	const found = findChildByTag(node, tag);
	if (found) return found;
	const child = [sym(tag)];
	node.push(child);
	return child;
}

// KiCad marks text on the back with (effects (justify ... mirror)).
function toggleTextMirror(textNode) {
	const effects = childOrNew(textNode, "effects");
	const justify = childOrNew(effects, "justify");
	const i = justify.findIndex((t, k) => k > 0 && nodeSym(t) === "mirror");
	if (i > 0) justify.splice(i, 1);
	else justify.push(sym("mirror"));
	if (justify.length === 1) effects.splice(effects.indexOf(justify), 1);
}

function turnItem(item, fn) {
	const at = findChildByTag(item, "at");
	if (!at) return;
	const angle = ((fn(Number(at[3]) || 0) % 360) + 360) % 360 || 0;
	if (angle || at.length > 3) at[3] = roundCoord(angle);
}

// Board files store pad and text angles absolute: add the footprint's own.
function rotateFootprintItems(fpNode, rot) {
	if (!rot) return;
	for (const child of fpNode) {
		const head = Array.isArray(child) ? child[0]?.sym : null;
		if (head === "pad" || TEXT_HEADS.has(head)) {
			turnItem(child, (a) => a + rot);
		}
	}
}

function isOnBack(fpNode) {
	return String(findChildByTag(fpNode, "layer")?.[1] ?? "").startsWith("B.");
}

/**
 * Turn a footprint to `rot` on `side` ("F"/"B") as pcbnew's Flip() and
 * SetOrientation() do: pad and text angles are taken back to the footprint's
 * own frame, flipped top-bottom if the side changes (no side keeps it), then
 * turned to `rot`.
 */
export function orientFootprint(fpNode, rot, side) {
	const at = findChildByTag(fpNode, "at");
	rotateFootprintItems(fpNode, -(Number(at?.[3]) || 0));
	if (side && (side === "B") !== isOnBack(fpNode)) applyFootprintSideB(fpNode);
	rotateFootprintItems(fpNode, rot);
	if (at) at[3] = roundCoord(rot);
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
	if (!isBoardCoord(edit.x) || !isBoardCoord(edit.y)) {
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
	updateFootprintAt(fpNode, edit.x, edit.y, 0);
	// Library footprints are drawn on the front; orientFootprint flips them.
	updateOrAddProperty(fpNode, "Reference", edit.ref, "F.SilkS");
	updateOrAddProperty(fpNode, "Value", String(edit.value), "F.Fab");
	updateFootprintUuids(fpNode, newUuid);
	orientFootprint(fpNode, edit.rot ?? 0, edit.side ?? "F");
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
	return Boolean(p && isBoardCoord(p.x) && isBoardCoord(p.y));
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
	if (!isBoardCoord(edit.x) || !isBoardCoord(edit.y)) {
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

const DIMENSION_FORMAT = [
	sym("format"),
	[sym("units"), 2],
	[sym("units_format"), 1],
	[sym("precision"), 4],
];

const DIMENSION_STYLE = [
	sym("style"),
	[sym("thickness"), 0.15],
	[sym("arrow_length"), 1.27],
	[sym("text_position_mode"), 0],
	[sym("extension_height"), 0.58642],
	[sym("extension_offset"), 0.5],
];

const TEXT_EFFECTS = [
	sym("effects"),
	[sym("font"), [sym("size"), 1, 1], [sym("thickness"), 0.15]],
];

function graphicTail(g, w, uuid, fill) {
	const stroke = [
		sym("stroke"),
		[sym("width"), w],
		[sym("type"), sym("default")],
	];
	const fillNodes = fill ? [[sym("fill"), sym("none")]] : [];
	return [stroke, ...fillNodes, [sym("layer"), g.layer], [sym("uuid"), uuid]];
}

function buildGraphicLine(g, w, uuid) {
	return [
		sym("gr_line"),
		[sym("start"), roundCoord(g.x), roundCoord(g.y)],
		[sym("end"), roundCoord(g.x2), roundCoord(g.y2)],
		...graphicTail(g, w, uuid, false),
	];
}

function buildGraphicRect(g, w, uuid) {
	return [
		sym("gr_rect"),
		[sym("start"), roundCoord(g.x), roundCoord(g.y)],
		[sym("end"), roundCoord(g.x2), roundCoord(g.y2)],
		...graphicTail(g, w, uuid, true),
	];
}

function buildGraphicCircle(g, w, uuid) {
	return [
		sym("gr_circle"),
		[sym("center"), roundCoord(g.x), roundCoord(g.y)],
		[sym("end"), roundCoord(g.x2), roundCoord(g.y2)],
		...graphicTail(g, w, uuid, true),
	];
}

function buildGraphicArc(g, w, uuid) {
	return [
		sym("gr_arc"),
		[sym("start"), roundCoord(g.x), roundCoord(g.y)],
		[sym("mid"), roundCoord(g.xm), roundCoord(g.ym)],
		[sym("end"), roundCoord(g.x2), roundCoord(g.y2)],
		...graphicTail(g, w, uuid, false),
	];
}

function buildGraphicText(g, _w, uuid) {
	return [
		sym("gr_text"),
		g.text,
		[sym("at"), roundCoord(g.x), roundCoord(g.y), 0],
		[sym("layer"), g.layer],
		[sym("uuid"), uuid],
		structuredClone(TEXT_EFFECTS),
	];
}

function buildGraphicDimension(g, _w, uuid) {
	return [
		sym("dimension"),
		[sym("type"), sym("aligned")],
		[sym("layer"), g.layer],
		[sym("uuid"), uuid],
		[
			sym("pts"),
			[sym("xy"), roundCoord(g.x), roundCoord(g.y)],
			[sym("xy"), roundCoord(g.x2), roundCoord(g.y2)],
		],
		[sym("height"), 2],
		structuredClone(DIMENSION_FORMAT),
		structuredClone(DIMENSION_STYLE),
	];
}

const GRAPHIC_BUILDERS = {
	line: buildGraphicLine,
	rect: buildGraphicRect,
	circle: buildGraphicCircle,
	arc: buildGraphicArc,
	text: buildGraphicText,
	dimension: buildGraphicDimension,
};

function graphicCoordsList(g) {
	if (g.kind === "text") return [g.x, g.y];
	if (g.kind === "arc") return [g.x, g.y, g.xm, g.ym, g.x2, g.y2];
	return [g.x, g.y, g.x2, g.y2];
}

function validateGraphicCoords(g) {
	const coords = graphicCoordsList(g);
	return coords.every(isBoardCoord) ? null : "Non-finite coords";
}

function validateGraphicBase(g) {
	if (!g || typeof g !== "object") return "Invalid graphic";
	if (!GRAPHIC_BUILDERS[g.kind]) return "Unknown graphic kind";
	if (!isString(g.layer)) return "Invalid layer";
	return null;
}

function validateGraphicWidth(width) {
	if (width === undefined) return null;
	return isPositiveNumber(width) ? null : "Invalid width";
}

function validateGraphicText(g) {
	if (g.kind !== "text") return null;
	return isString(g.text) ? null : "Invalid text";
}

function validateGraphicParams(g) {
	const baseErr = validateGraphicBase(g);
	if (baseErr) return baseErr;
	const widthErr = validateGraphicWidth(g.width);
	if (widthErr) return widthErr;
	const textErr = validateGraphicText(g);
	if (textErr) return textErr;
	return validateGraphicCoords(g);
}

function resolveGraphicWidth(g) {
	if (g.width !== undefined) return roundCoord(g.width);
	return g.layer === "Edge.Cuts" ? 0.1 : 0.15;
}

function handleAddGraphic(ast, edit, newUuid) {
	const g = edit.graphic ?? edit;
	const err = validateGraphicParams(g);
	if (err) return { ok: false, error: err };
	const builder = GRAPHIC_BUILDERS[g.kind];
	const w = resolveGraphicWidth(g);
	const uuid = isString(g.uuid) ? g.uuid : newUuid();
	ast.push(builder(g, w, uuid));
	return { ok: true };
}

function isGraphicNode(node, uuid) {
	if (!Array.isArray(node)) return false;
	const head = nodeSym(node[0]);
	if (!head.startsWith("gr_") && head !== "dimension") return false;
	return findChildByTag(node, "uuid")?.[1] === uuid;
}

function handleDeleteGraphic(ast, edit) {
	if (!isString(edit.uuid)) {
		return { ok: false, error: "Invalid graphic uuid" };
	}
	const idx = ast.findIndex(
		(node, i) => i > 0 && isGraphicNode(node, edit.uuid),
	);
	if (idx === -1) {
		return { ok: false, error: `Graphic ${edit.uuid} not found` };
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
	addGraphic: handleAddGraphic,
	deleteGraphic: handleDeleteGraphic,
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
	return serializePcbAst(parsed.ast);
}

function serializePcbAst(ast) {
	try {
		return { ok: true, text: serialize(ast) };
	} catch (e) {
		return { ok: false, error: `Serialize error: ${e.message}` };
	}
}
