import { createHash } from "node:crypto";
import { validateCircuitIR } from "./circuit-ir.js";
import { flipLayerString, orientFootprint } from "./kicad-pcb-edit.js";
import { serialize, sym } from "./sexpr.js";

function deterministicUuid(id) {
	const hex = createHash("sha1").update(String(id)).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function createLayersNode() {
	return [
		sym("layers"),
		[0, "F.Cu", sym("signal")],
		[2, "B.Cu", sym("signal")],
		[9, "F.SilkS", sym("user"), "F.Silkscreen"],
		[11, "B.SilkS", sym("user"), "B.Silkscreen"],
		[1, "F.Mask", sym("user")],
		[3, "B.Mask", sym("user")],
		[13, "F.Paste", sym("user")],
		[15, "B.Paste", sym("user")],
		[25, "Edge.Cuts", sym("user")],
		[31, "F.CrtYd", sym("user"), "F.Courtyard"],
		[29, "B.CrtYd", sym("user"), "B.Courtyard"],
		[35, "F.Fab", sym("user")],
		[33, "B.Fab", sym("user")],
	];
}

function buildPinNetMap(nets) {
	const map = new Map();
	for (let i = 0; i < nets.length; i++) {
		const net = nets[i];
		const netNumber = i + 1;
		const pins = net.pins ?? [];
		for (let j = 0; j < pins.length; j++) {
			const pin = pins[j];
			map.set(`${pin.partId}:${String(pin.pin)}`, {
				number: netNumber,
				name: net.name,
			});
		}
	}
	return map;
}

function buildNetDeclarations(nets) {
	const list = [[sym("net"), 0, ""]];
	for (let i = 0; i < nets.length; i++) {
		list.push([sym("net"), i + 1, nets[i].name]);
	}
	return list;
}

const isSet = (v) => v !== undefined && v !== null;

// (drill 0.8), (drill oval 0.8 1.2), each with an optional (offset x y).
function buildDrillNode(pad) {
	const oval = isSet(pad.drillHeight) ? [sym("oval")] : [];
	const sizes = [pad.drill, pad.drillHeight].filter(isSet);
	const offset = pad.drillOffset ? [[sym("offset"), ...pad.drillOffset]] : [];
	const items = [...oval, ...sizes, ...offset];
	return items.length > 0 ? [sym("drill"), ...items] : null;
}

function buildPadNode(pad, netInfo) {
	const node = [
		sym("pad"),
		String(pad.number),
		sym(pad.type),
		sym(pad.shape),
		// Footprint-relative; orientFootprint makes it absolute as boards store it.
		[sym("at"), pad.at[0], pad.at[1], pad.at[2] ?? 0],
		[sym("size"), pad.size[0], pad.size[1]],
	];
	const drill = buildDrillNode(pad);
	if (drill) node.push(drill);
	node.push([sym("layers"), ...pad.layers]);
	if (netInfo) {
		node.push([sym("net"), netInfo.number, netInfo.name]);
	}
	return node;
}

// An embedded (imported) pad is already flipped for a back part; take it
// back to the front, where the footprint is built before it is flipped. The
// drill offset is left as is: the flip does not touch it either.
function frontPad(pad) {
	const [x, y, a = 0] = pad.at;
	const at = [x, -y || 0, -a || 0];
	return { ...pad, at, layers: pad.layers.map(flipLayerString) };
}

function defPads(def, side) {
	const pads = Array.isArray(def) ? def : (def.pads ?? []);
	return def.embedded && side === "B" ? pads.map(frontPad) : pads;
}

const mirrorY = ([x, y]) => [x, -y || 0];
const POINT_KEYS = ["start", "mid", "end", "center"];

// Compact graphics of a back part are stored flipped, like its pads.
function frontGraphic(g) {
	const out = { ...g, layer: flipLayerString(g.layer) };
	for (const key of POINT_KEYS.filter((k) => g[k])) out[key] = mirrorY(g[key]);
	if (g.pts) out.pts = g.pts.map(mirrorY);
	return out;
}

const pointNode = (head, [x, y]) => [sym(head), x, y];

const COMPACT_WRITERS = {
	line: (g) => [
		sym("fp_line"),
		pointNode("start", g.start),
		pointNode("end", g.end),
	],
	arc: (g) => [
		sym("fp_arc"),
		...["start", "mid", "end"].map((k) => pointNode(k, g[k])),
	],
	circle: (g) => [
		sym("fp_circle"),
		pointNode("center", g.center),
		pointNode("end", [g.center[0] + g.radius, g.center[1]]),
	],
	poly: (g) => [
		sym("fp_poly"),
		[sym("pts"), ...g.pts.map((p) => pointNode("xy", p))],
	],
};

const RAW_GRAPHIC_HEADS = new Set([
	"fp_line",
	"fp_arc",
	"fp_circle",
	"fp_rect",
	"fp_poly",
]);

// A library shape is shared by every part using the footprint: copy it (as
// orientFootprint changes the nodes it is given) without its uuid.
function copyRawGraphic(node) {
	return structuredClone(node).filter((c) => c?.[0]?.sym !== "uuid");
}

// Compact (board import) graphics are rebuilt; raw library nodes are copied.
function buildGraphicNode(g) {
	if (Array.isArray(g)) {
		return RAW_GRAPHIC_HEADS.has(g[0]?.sym) ? copyRawGraphic(g) : null;
	}
	const write = COMPACT_WRITERS[g?.type];
	if (!write) return null;
	const stroke = [
		sym("stroke"),
		[sym("width"), g.width],
		[sym("type"), sym("solid")],
	];
	return [...write(g), stroke, [sym("layer"), g.layer]];
}

function defGraphics(def, side) {
	const graphics = Array.isArray(def.graphics) ? def.graphics : [];
	const front =
		def.embedded && side === "B" ? graphics.map(frontGraphic) : graphics;
	return front.map(buildGraphicNode).filter(Boolean);
}

function buildPadNodes(part, def, pinNetMap) {
	return defPads(def, part.placement.side).map((pad) =>
		buildPadNode(pad, pinNetMap.get(`${part.id}:${String(pad.number)}`)),
	);
}

// A board import keys its embedded footprints by part id, a library by id.
function resolvePartDef(part, footprints, warnings) {
	const def = footprints?.[part.id] ?? footprints?.[part.footprint];
	if (!def) {
		warnings.push(
			`no footprint definition for ${part.ref} (${part.footprint})`,
		);
	}
	return def ?? null;
}

// Attributes, outlines and pads of the part's footprint, in KiCad's order.
function footprintItems(part, def, pinNetMap) {
	if (!def) return [];
	const attr = Array.isArray(def.attr)
		? [[sym("attr"), ...def.attr.map(sym)]]
		: [];
	return [
		...attr,
		...(Array.isArray(def) ? [] : defGraphics(def, part.placement.side)),
		...buildPadNodes(part, def, pinNetMap),
	];
}

// The imported reference text, taken to the front like a back part's pads
// (the flip turns text to 180 - angle and toggles its mirror flag).
function frontLabel({ at: [x, y], rot, layer, mirror = false }, flipped) {
	const onLayer = layer || "F.SilkS";
	if (!flipped) return { at: [x, y, rot], layer: onLayer, mirror };
	const at = [x, -y || 0, (180 - rot) % 360];
	return { at, layer: flipLayerString(onLayer), mirror: !mirror };
}

function referenceProperty(part, def) {
	const label = def?.refLabel;
	const head = [sym("property"), "Reference", part.ref];
	if (!label)
		return [...head, [sym("at"), 0, -3, 0], [sym("layer"), "F.SilkS"]];
	const front = frontLabel(label, def.embedded && part.placement.side === "B");
	const node = [...head, [sym("at"), ...front.at], [sym("layer"), front.layer]];
	if (label.hide) node.push([sym("hide"), sym("yes")]);
	node.push(labelEffects(label, front.mirror));
	return node;
}

function labelEffects(label, mirror) {
	const effects = [sym("effects"), labelFont(label)];
	if (mirror) effects.push([sym("justify"), sym("mirror")]);
	return effects;
}

function labelFont({ size, thickness }) {
	const font = [sym("font"), [sym("size"), size, size]];
	if (thickness !== undefined) font.push([sym("thickness"), thickness]);
	return font;
}

// Built on the front at 0 degrees, then flipped and turned as pcbnew does.
function buildFootprintNode(part, def, items) {
	const { x, y, rot, side } = part.placement;
	const node = [
		sym("footprint"),
		part.footprint,
		[sym("layer"), "F.Cu"],
		[sym("uuid"), deterministicUuid(part.id)],
		[sym("at"), x, y, 0],
		referenceProperty(part, def),
		[
			sym("property"),
			"Value",
			part.value,
			[sym("at"), 0, 3, 0],
			[sym("layer"), "F.Fab"],
		],
		...items,
	];
	orientFootprint(node, rot, side);
	return node;
}

function buildAllFootprints(parts, footprints, pinNetMap, warnings) {
	const nodes = [];
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (!part.placement) {
			warnings.push(`unplaced part ${part.ref}`);
			continue;
		}
		const def = resolvePartDef(part, footprints, warnings);
		const items = footprintItems(part, def, pinNetMap);
		nodes.push(buildFootprintNode(part, def, items));
	}
	return nodes;
}

function buildOutlineNode(boardW, boardH) {
	return [
		sym("gr_rect"),
		[sym("start"), 0, 0],
		[sym("end"), boardW, boardH],
		[sym("stroke"), [sym("width"), 0.1], [sym("type"), sym("default")]],
		[sym("fill"), sym("no")],
		[sym("layer"), "Edge.Cuts"],
		[sym("uuid"), deterministicUuid("outline")],
	];
}

function buildPcbTree(thicknessMm, nets, footprints, outline) {
	return [
		sym("kicad_pcb"),
		[sym("version"), 20241229],
		[sym("generator"), "banana"],
		[sym("generator_version"), "0.1"],
		[
			sym("general"),
			[sym("thickness"), thicknessMm],
			[sym("legacy_teardrops"), sym("no")],
		],
		[sym("paper"), "A4"],
		createLayersNode(),
		[sym("setup"), [sym("pad_to_mask_clearance"), 0]],
		...nets,
		...footprints,
		outline,
	];
}

export function irToKicadPcb(
	ir,
	{ boardW = 100, boardH = 100, footprints = {}, thicknessMm = 1.6 } = {},
) {
	const validation = validateCircuitIR(ir);
	if (!validation.ok) {
		throw new Error(`Invalid Circuit IR: ${validation.errors.join("; ")}`);
	}
	const warnings = [];
	const pinNetMap = buildPinNetMap(ir.nets);
	const netNodes = buildNetDeclarations(ir.nets);
	const footprintNodes = buildAllFootprints(
		ir.parts,
		footprints,
		pinNetMap,
		warnings,
	);
	const outlineNode = buildOutlineNode(boardW, boardH);
	const tree = buildPcbTree(thicknessMm, netNodes, footprintNodes, outlineNode);
	return {
		text: serialize(tree),
		warnings,
	};
}
