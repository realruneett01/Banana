import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { validateCircuitIR } from "./circuit-ir.js";
import { flipLayerString, orientFootprint } from "./kicad-pcb-edit.js";
import { edgeCutsOutline, isEdgeCutsNode } from "./kicad-pcb-to-ir.js";
import { serialize, sym } from "./sexpr.js";

function deterministicUuid(id) {
	const hex = createHash("sha1").update(String(id)).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// KiCad layer ids (KiCad 9 file numbering) and display names, by canonical name.
const LAYER_IDS = {
	"F.Cu": [0],
	"B.Cu": [2],
	"F.Mask": [1],
	"B.Mask": [3],
	"F.SilkS": [5, "F.Silkscreen"],
	"B.SilkS": [7, "B.Silkscreen"],
	"F.Adhes": [9, "F.Adhesive"],
	"B.Adhes": [11, "B.Adhesive"],
	"F.Paste": [13],
	"B.Paste": [15],
	"Dwgs.User": [17, "User.Drawings"],
	"Cmts.User": [19, "User.Comments"],
	"Eco1.User": [21, "User.Eco1"],
	"Eco2.User": [23, "User.Eco2"],
	"Edge.Cuts": [25],
	Margin: [27],
	"B.CrtYd": [29, "B.Courtyard"],
	"F.CrtYd": [31, "F.Courtyard"],
	"B.Fab": [33],
	"F.Fab": [35],
};

const DEFAULT_LAYERS = [
	"F.Cu",
	"B.Cu",
	"F.SilkS",
	"B.SilkS",
	"F.Mask",
	"B.Mask",
	"F.Paste",
	"B.Paste",
	"Edge.Cuts",
	"F.CrtYd",
	"B.CrtYd",
	"F.Fab",
	"B.Fab",
];

// Inner copper In<n>.Cu is 2n+2 and User.<n> is 37+2n; others are listed.
function layerId(name) {
	const inner = /^In(\d+)\.Cu$/.exec(name);
	if (inner) return 2 * Number(inner[1]) + 2;
	const user = /^User\.(\d+)$/.exec(name);
	if (user) return 37 + 2 * Number(user[1]);
	return LAYER_IDS[name]?.[0];
}

// An imported board names its layers itself; else KiCad's default names.
function layerEntry(name, layerNames) {
	const id = layerId(name);
	if (id === undefined) return null;
	const type = name.endsWith(".Cu") ? "signal" : "user";
	const userName = layerNames ? layerNames[name] : LAYER_IDS[name]?.[1];
	return [id, name, sym(type), ...(userName ? [userName] : [])];
}

// An imported board's own layer list, else the default two-layer set.
function createLayersNode(layers, layerNames) {
	const names = layers?.length ? layers : DEFAULT_LAYERS;
	const entries = names.map((name) => layerEntry(name, layerNames));
	return [sym("layers"), ...entries.filter(Boolean)];
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
	// Imported pad settings, front-side; copied as the footprint is turned.
	node.push(...structuredClone(pad.extra ?? []));
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
	poly: (g) =>
		g.rect
			? [
					sym("fp_rect"),
					pointNode("start", g.pts[0]),
					pointNode("end", g.pts[2]),
				]
			: [sym("fp_poly"), [sym("pts"), ...g.pts.map((p) => pointNode("xy", p))]],
};

const fillNodes = (g) => (g.fill ? [[sym("fill"), sym("yes")]] : []);

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
	return [...write(g), stroke, ...fillNodes(g), [sym("layer"), g.layer]];
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
		...(def.extras ?? []).map(copyRawGraphic),
		...(Array.isArray(def) ? [] : defGraphics(def, part.placement.side)),
		...buildPadNodes(part, def, pinNetMap),
	];
}

// The imported Value text (front-side) showing the part's current value.
function valueProperty(part, def) {
	if (!def?.valueText) {
		const at = [sym("at"), 0, 3, 0];
		return [sym("property"), "Value", part.value, at, [sym("layer"), "F.Fab"]];
	}
	const node = structuredClone(def.valueText);
	node[2] = part.value;
	return node;
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
	const node = [...head, [sym("at"), ...front.at]];
	if (label.unlocked) node.push([sym("unlocked"), sym("yes")]);
	node.push([sym("layer"), front.layer]);
	if (label.hide) node.push([sym("hide"), sym("yes")]);
	node.push(labelEffects(label, front.mirror));
	return node;
}

function labelEffects(label, mirror) {
	const effects = [sym("effects"), labelFont(label)];
	const justify = [...(label.justify ?? []), ...(mirror ? ["mirror"] : [])];
	if (justify.length > 0) effects.push([sym("justify"), ...justify.map(sym)]);
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
		valueProperty(part, def),
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

const EDGE_STROKE = [
	sym("stroke"),
	[sym("width"), 0.1],
	[sym("type"), sym("solid")],
];

// An imported outline (a closed point list) is drawn back as Edge.Cuts lines.
function buildOutlineNodes(outline, boardW, boardH) {
	if (!Array.isArray(outline) || outline.length < 3) {
		return [buildOutlineNode(boardW, boardH)];
	}
	return outline.map((p, i) => [
		sym("gr_line"),
		pointNode("start", p),
		pointNode("end", outline[(i + 1) % outline.length]),
		EDGE_STROKE,
		[sym("layer"), "Edge.Cuts"],
	]);
}

// Imported board drawings are written as they were. Its Edge.Cuts ones only
// while the outline is still the one they draw; an edited outline replaces
// them.
function buildDrawingNodes({ drawings = [], outline = null }, boardW, boardH) {
	const edges = drawings.filter(isEdgeCutsNode);
	const keepEdges =
		edges.length > 0 && isDeepStrictEqual(edgeCutsOutline(edges), outline);
	if (keepEdges) return drawings;
	return [
		...buildOutlineNodes(outline, boardW, boardH),
		...drawings.filter((d) => !isEdgeCutsNode(d)),
	];
}

const uuidNodes = (item) => (item.uuid ? [[sym("uuid"), item.uuid]] : []);

// Tracks, vias and zones carry the IR net id; the board names it by number.
const netNode = (item, netIndex) => [sym("net"), netIndex.get(item.netId) ?? 0];

function buildTrackNode(track, netIndex) {
	const mid = track.mid ? [pointNode("mid", track.mid)] : [];
	return [
		sym(track.mid ? "arc" : "segment"),
		pointNode("start", track.start),
		...mid,
		pointNode("end", track.end),
		[sym("width"), track.widthMm],
		[sym("layer"), track.layer],
		netNode(track, netIndex),
		...uuidNodes(track),
	];
}

function buildViaNode(via, netIndex) {
	return [
		sym("via"),
		pointNode("at", via.at),
		[sym("size"), via.sizeMm],
		[sym("drill"), via.drillMm],
		[sym("layers"), ...(via.layers ?? ["F.Cu", "B.Cu"])],
		netNode(via, netIndex),
		...uuidNodes(via),
	];
}

const ptsNode = (pts) => [sym("pts"), ...pts.map((p) => pointNode("xy", p))];

const zoneLayerNode = (zone) =>
	zone.layers ? [sym("layers"), ...zone.layers] : [sym("layer"), zone.layer];

// An imported zone keeps its settings and outline; KiCad refills it (as
// kicad-cli does with --refill-zones / --check-zones). A zone drawn in the
// editor has no settings: its polygon is written as outline and fill, so
// plots need no refill, and clearance 0 leaves it to the design rules.
function zoneBody(zone) {
	const outline = [sym("polygon"), ptsNode(zone.polygon)];
	if (zone.settings) return [...zone.settings, outline];
	return [
		[sym("hatch"), sym("edge"), 0.5],
		[sym("connect_pads"), [sym("clearance"), 0]],
		[sym("filled_areas_thickness"), sym("no")],
		[sym("fill"), sym("yes")],
		outline,
		[sym("filled_polygon"), [sym("layer"), zone.layer], ptsNode(zone.polygon)],
	];
}

function buildZoneNode(zone, netIndex, netNames) {
	return [
		sym("zone"),
		netNode(zone, netIndex),
		[sym("net_name"), netNames.get(zone.netId) ?? ""],
		zoneLayerNode(zone),
		...uuidNodes(zone),
		...zoneBody(zone),
	];
}

function writableZones(zones, warnings) {
	return zones.filter((zone) => {
		const ok = Boolean(zone.layer) && zone.polygon?.length >= 3;
		if (!ok) warnings.push("skipped a zone without a single layer or polygon");
		return ok;
	});
}

// Imported items go back in their file order (KiCad's zone refill depends
// on it); items made in the editor have no order and follow, tracks first.
const orderOf = ([item]) => item.order ?? Number.MAX_SAFE_INTEGER;

function buildTrackAndViaNodes(tracks, vias, netIndex) {
	const items = [
		...tracks.map((t) => [t, buildTrackNode]),
		...vias.map((v) => [v, buildViaNode]),
	];
	items.sort((a, b) => orderOf(a) - orderOf(b));
	return items.map(([item, build]) => build(item, netIndex));
}

function buildRoutingNodes(
	ir,
	{ tracks = [], vias = [], zones = [] },
	warnings,
) {
	const netIndex = new Map(ir.nets.map((net, i) => [net.id, i + 1]));
	const netNames = new Map(ir.nets.map((net) => [net.id, net.name]));
	return [
		...buildTrackAndViaNodes(tracks, vias, netIndex),
		...writableZones(zones, warnings).map((z) =>
			buildZoneNode(z, netIndex, netNames),
		),
	];
}

const DEFAULT_SETUP = [sym("setup"), [sym("pad_to_mask_clearance"), 0]];

function buildPcbTree(head, nets, items) {
	const { thicknessMm, layers, layerNames, setup = DEFAULT_SETUP } = head;
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
		createLayersNode(layers, layerNames),
		setup,
		...nets,
		...items,
	];
}

// `options` may be an imported board ({ footprints, outline, drawings,
// tracks, vias, zones, layers, layerNames, setup, thicknessMm }): it is
// written back.
export function irToKicadPcb(ir, options = {}) {
	const validation = validateCircuitIR(ir);
	if (!validation.ok) {
		throw new Error(`Invalid Circuit IR: ${validation.errors.join("; ")}`);
	}
	const { boardW = 100, boardH = 100, footprints = {} } = options;
	const { thicknessMm = 1.6, layers, layerNames, setup } = options;
	const warnings = [];
	const pinNetMap = buildPinNetMap(ir.nets);
	const items = [
		...buildAllFootprints(ir.parts, footprints, pinNetMap, warnings),
		...buildDrawingNodes(options, boardW, boardH),
		...buildRoutingNodes(ir, options, warnings),
	];
	const nets = buildNetDeclarations(ir.nets);
	const head = { thicknessMm, layers, layerNames, setup };
	const tree = buildPcbTree(head, nets, items);
	return { text: serialize(tree), warnings };
}
