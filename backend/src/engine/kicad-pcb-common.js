import { flipLayerString } from "./kicad-pcb-edit.js";
import { sym } from "./sexpr.js";

// KiCad's internal unit is 1 nm: keep every digit a board file can hold.
export function roundCoord(val) {
	const r = Math.round(Number(val) * 1e6) / 1e6;
	return Object.is(r, -0) ? 0 : r;
}

export function roundMilli(val) {
	const r = Math.round(Number(val) * 1000) / 1000;
	return Object.is(r, -0) ? 0 : r;
}

export function nodeSym(node) {
	if (node === null || node === undefined) return "";
	return typeof node === "object" ? (node.sym ?? "") : String(node);
}

export function extractChildNode(node, head) {
	if (!Array.isArray(node)) return null;
	return node.find((c) => Array.isArray(c) && c[0]?.sym === head) ?? null;
}

export function extractAt(node) {
	const atNode = extractChildNode(node, "at");
	if (!atNode) return { x: 0, y: 0, rot: 0 };
	const x = roundCoord(atNode[1]);
	const y = roundCoord(atNode[2]);
	const rot = atNode.length > 3 ? roundCoord(atNode[3]) : 0;
	return { x, y, rot };
}

export function extractLayerName(node) {
	const lNode = extractChildNode(node, "layer");
	if (!lNode || lNode.length < 2) return "";
	return nodeSym(lNode[1]);
}

export function extractSide(node) {
	const layer = extractLayerName(node);
	return layer.startsWith("B") ? "B" : "F";
}

// Layer user names, as in (0 "F.Cu" signal "Top").
export function extractLayerNames(ast) {
	const layersNode = extractChildNode(ast, "layers") ?? [];
	const named = layersNode.filter((c) => Array.isArray(c) && c.length > 3);
	return Object.fromEntries(named.map((c) => [nodeSym(c[1]), nodeSym(c[3])]));
}

export function extractLayers(ast) {
	const layersNode = extractChildNode(ast, "layers");
	if (!Array.isArray(layersNode)) return [];
	const layers = [];
	for (const child of layersNode.slice(1)) {
		if (Array.isArray(child) && child.length >= 2) {
			const name = nodeSym(child[1]);
			if (name) layers.push(name);
		}
	}
	return layers;
}

// KiCad layer ids (KiCad 9 file numbering) and display names, by canonical name.
export const LAYER_IDS = {
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

export const DEFAULT_LAYERS = [
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
export function layerId(name) {
	const inner = /^In(\d+)\.Cu$/.exec(name);
	if (inner) return 2 * Number(inner[1]) + 2;
	const user = /^User\.(\d+)$/.exec(name);
	if (user) return 37 + 2 * Number(user[1]);
	return LAYER_IDS[name]?.[0];
}

// An imported board names its layers itself; else KiCad's default names.
export function layerEntry(name, layerNames) {
	const id = layerId(name);
	if (id === undefined) return null;
	const type = name.endsWith(".Cu") ? "signal" : "user";
	const userName = layerNames ? layerNames[name] : LAYER_IDS[name]?.[1];
	return [id, name, sym(type), ...(userName ? [userName] : [])];
}

// An imported board's own layer list, else the default two-layer set.
export function createLayersNode(layers, layerNames) {
	const names = layers?.length ? layers : DEFAULT_LAYERS;
	const entries = names.map((name) => layerEntry(name, layerNames));
	return [sym("layers"), ...entries.filter(Boolean)];
}

export function normAngle(a) {
	let res = a % (2 * Math.PI);
	if (res < 0) res += 2 * Math.PI;
	return res;
}

export function relAngle(rot, fpRot) {
	return (((rot - fpRot) % 360) + 360) % 360;
}

export function ptsToSegments(pts) {
	const segs = [];
	for (let i = 0; i < pts.length - 1; i++) {
		segs.push({ start: pts[i], end: pts[i + 1] });
	}
	return segs;
}

export function sampleSweepSegments({ c, r, a1, sweep, p1, p2 }) {
	const pts = [p1];
	for (let i = 1; i < 8; i++) {
		const ang = a1 + (i / 8) * sweep;
		pts.push([
			roundCoord(c[0] + r * Math.cos(ang)),
			roundCoord(c[1] + r * Math.sin(ang)),
		]);
	}
	pts.push(p2);
	return ptsToSegments(pts);
}

export function sampleArcCircle(c, p1, pm, p2) {
	const r = Math.hypot(p1[0] - c[0], p1[1] - c[1]);
	const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
	const am = Math.atan2(pm[1] - c[1], pm[0] - c[0]);
	const a2 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
	const dm = normAngle(am - a1);
	const d2 = normAngle(a2 - a1);
	const sweep = dm < d2 ? d2 : -(2 * Math.PI - d2);
	return sampleSweepSegments({ c, r, a1, sweep, p1, p2 });
}

export function approximateMidArc(p1, pm, p2) {
	const d1mX = pm[0] - p1[0];
	const d1mY = pm[1] - p1[1];
	const dm2X = p2[0] - pm[0];
	const dm2Y = p2[1] - pm[1];
	const ma = [(p1[0] + pm[0]) / 2, (p1[1] + pm[1]) / 2];
	const mb = [(pm[0] + p2[0]) / 2, (pm[1] + p2[1]) / 2];
	const na = [-d1mY, d1mX];
	const nb = [-dm2Y, dm2X];
	const det = na[1] * nb[0] - na[0] * nb[1];
	if (Math.abs(det) < 1e-10) return ptsToSegments([p1, p2]);
	const s = ((mb[0] - ma[0]) * -nb[1] - (mb[1] - ma[1]) * -nb[0]) / det;
	const c = [ma[0] + s * na[0], ma[1] + s * na[1]];
	return sampleArcCircle(c, p1, pm, p2);
}

export function approximateAngleArc(c, p1, angleDeg) {
	const r = Math.hypot(p1[0] - c[0], p1[1] - c[1]);
	const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
	const sweep = (angleDeg * Math.PI) / 180;
	const aEnd = a1 + sweep;
	const p2 = [
		roundCoord(c[0] + r * Math.cos(aEnd)),
		roundCoord(c[1] + r * Math.sin(aEnd)),
	];
	return sampleSweepSegments({ c, r, a1, sweep, p1, p2 });
}

export function parseGrArcSegments(node) {
	const startNode = extractChildNode(node, "start");
	const midNode = extractChildNode(node, "mid");
	const endNode = extractChildNode(node, "end");
	const angleNode = extractChildNode(node, "angle");
	if (midNode && endNode && startNode) {
		const p1 = [roundCoord(startNode[1]), roundCoord(startNode[2])];
		const pm = [roundCoord(midNode[1]), roundCoord(midNode[2])];
		const p2 = [roundCoord(endNode[1]), roundCoord(endNode[2])];
		return approximateMidArc(p1, pm, p2);
	}
	if (startNode && endNode && angleNode) {
		const c = [roundCoord(startNode[1]), roundCoord(startNode[2])];
		const p1 = [roundCoord(endNode[1]), roundCoord(endNode[2])];
		return approximateAngleArc(c, p1, Number(angleNode[1]) || 0);
	}
	return [];
}

export function isPointClose(p1, p2) {
	return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) <= 0.05;
}

export function findNextSegment(curr, segs, used) {
	for (let i = 0; i < segs.length; i++) {
		if (used.has(i)) continue;
		if (isPointClose(segs[i].start, curr)) {
			return { seg: segs[i], index: i, reverse: false };
		}
		if (isPointClose(segs[i].end, curr)) {
			return { seg: segs[i], index: i, reverse: true };
		}
	}
	return null;
}

export function chainSegmentsToPolygon(segs) {
	if (segs.length === 0) return null;
	const used = new Set([0]);
	const poly = [segs[0].start];
	let curr = segs[0].end;
	poly.push(curr);
	while (used.size < segs.length) {
		const match = findNextSegment(curr, segs, used);
		if (!match) break;
		used.add(match.index);
		curr = match.reverse ? match.seg.start : match.seg.end;
		if (!isPointClose(curr, poly[0])) poly.push(curr);
	}
	return poly.length >= 3 ? poly : null;
}

export function isEdgeCutsNode(child) {
	return Array.isArray(child) && extractLayerName(child) === "Edge.Cuts";
}

export function parseGrRectOutline(rectNode) {
	const startNode = extractChildNode(rectNode, "start");
	const endNode = extractChildNode(rectNode, "end");
	if (!startNode || !endNode) return null;
	const x1 = roundCoord(startNode[1]);
	const y1 = roundCoord(startNode[2]);
	const x2 = roundCoord(endNode[1]);
	const y2 = roundCoord(endNode[2]);
	return [
		[x1, y1],
		[x2, y1],
		[x2, y2],
		[x1, y2],
	];
}

export function processEdgeCutsNode(child, rects, segs) {
	const head = child[0]?.sym;
	if (head === "gr_rect") {
		rects.push(child);
	} else if (head === "gr_line") {
		const s = extractChildNode(child, "start");
		const e = extractChildNode(child, "end");
		if (s && e) {
			segs.push({
				start: [roundCoord(s[1]), roundCoord(s[2])],
				end: [roundCoord(e[1]), roundCoord(e[2])],
			});
		}
	} else if (head === "gr_arc") {
		segs.push(...parseGrArcSegments(child));
	}
}

// The board outline as one closed point list, from the board drawings.
export function edgeCutsOutline(drawings) {
	const rects = [];
	const segs = [];
	for (const child of drawings) {
		if (isEdgeCutsNode(child)) {
			processEdgeCutsNode(child, rects, segs);
		}
	}
	if (rects.length > 0) return parseGrRectOutline(rects[0]);
	return chainSegmentsToPolygon(segs);
}

export function isFootprintText(node, propName) {
	const head = node[0]?.sym;
	const kind = nodeSym(node[1]);
	if (head === "property") return kind === propName;
	return head === "fp_text" && kind.toLowerCase() === propName.toLowerCase();
}

export const isReferenceText = (node) => isFootprintText(node, "Reference");
export const isValueText = (node) => isFootprintText(node, "Value");

export function withoutUuid(node) {
	return node.filter((c) => !(Array.isArray(c) && c[0]?.sym === "uuid"));
}

export function uuidOf(node) {
	const uuid = nodeSym(extractChildNode(node, "uuid")?.[1]);
	return uuid ? { uuid } : {};
}

export const uuidNodes = (item) =>
	item.uuid ? [[sym("uuid"), item.uuid]] : [];

// KiCad 9 writes (net 3 "GND") against a net table; KiCad 10 writes
// (net "GND") with no number, so the name itself keys the net.
export function netKeyOf(netNode) {
	if (!Array.isArray(netNode) || netNode.length < 2) return 0;
	return typeof netNode[1] === "number" ? netNode[1] : nodeSym(netNode[1]);
}

export function isNetKey(key) {
	return typeof key === "string" ? key !== "" : key > 0;
}

export function netNameOf(netNode) {
	const key = netKeyOf(netNode);
	if (typeof key === "string") return key;
	return netNode.length > 2 ? nodeSym(netNode[2]) : "";
}

export const netNode = (item, netIndex) => [
	sym("net"),
	netIndex.get(item.netId) ?? 0,
];

export const pointNode = (head, [x, y]) => [sym(head), x, y];
export const ptsNode = (pts) => [
	sym("pts"),
	...pts.map((p) => pointNode("xy", p)),
];

export function milliPt(node) {
	return [roundMilli(node?.[1] ?? 0), roundMilli(node?.[2] ?? 0)];
}

export function childPt(node, head) {
	return milliPt(extractChildNode(node, head));
}

export function extractPolygonPts(polyNode) {
	if (!Array.isArray(polyNode)) return [];
	const ptsNode =
		extractChildNode(polyNode, "pts") ||
		(polyNode[0]?.sym === "pts" ? polyNode : null);
	if (!Array.isArray(ptsNode)) return [];
	const pts = [];
	for (const child of ptsNode.slice(1)) {
		if (Array.isArray(child) && child[0]?.sym === "xy") {
			pts.push([roundCoord(child[1]), roundCoord(child[2])]);
		}
	}
	return pts;
}

export const mirrorY = ([x, y]) => [x, -y || 0];
export const POINT_KEYS = ["start", "mid", "end", "center"];

export function frontPad(pad) {
	const [x, y, a = 0] = pad.at;
	const at = [x, -y || 0, -a || 0];
	return { ...pad, at, layers: pad.layers.map(flipLayerString) };
}

// Compact graphics of a back part are stored flipped, like its pads.
export function frontGraphic(g) {
	const out = { ...g, layer: flipLayerString(g.layer) };
	for (const key of POINT_KEYS.filter((k) => g[k])) out[key] = mirrorY(g[key]);
	if (g.pts) out.pts = g.pts.map(mirrorY);
	return out;
}

// The imported reference text, taken to the front like a back part's pads
// (the flip turns text to 180 - angle and toggles its mirror flag).
export function frontLabel(
	{ at: [x, y], rot, layer, mirror = false },
	flipped,
) {
	const onLayer = layer || "F.SilkS";
	if (!flipped) return { at: [x, y, rot], layer: onLayer, mirror };
	const at = [x, -y || 0, (180 - rot) % 360];
	return { at, layer: flipLayerString(onLayer), mirror: !mirror };
}

export function labelFont({ size, thickness }) {
	const font = [sym("font"), [sym("size"), size, size]];
	if (thickness !== undefined) font.push([sym("thickness"), thickness]);
	return font;
}

export function labelEffects(label, mirror) {
	const effects = [sym("effects"), labelFont(label)];
	const justify = [...(label.justify ?? []), ...(mirror ? ["mirror"] : [])];
	if (justify.length > 0) effects.push([sym("justify"), ...justify.map(sym)]);
	return effects;
}

export const RAW_GRAPHIC_HEADS = new Set([
	"fp_line",
	"fp_arc",
	"fp_circle",
	"fp_rect",
	"fp_poly",
]);

export const GRAPHIC_LAYERS = new Set([
	"F.SilkS",
	"B.SilkS",
	"F.Fab",
	"B.Fab",
	"F.CrtYd",
	"B.CrtYd",
]);

export const FP_SETTING_HEADS = new Set([
	"solder_mask_margin",
	"solder_paste_margin",
	"solder_paste_margin_ratio",
	"solder_paste_ratio",
	"clearance",
	"zone_connect",
	"thermal_width",
	"thermal_gap",
	"zone",
	"net_tie_pad_groups",
	"private_layers",
	"duplicate_pad_numbers_are_jumpers",
	"jumper_pad_groups",
]);

export const PAD_MODEL_HEADS = new Set([
	"at",
	"size",
	"drill",
	"layers",
	"net",
	"uuid",
]);

export const ZONE_MODEL_HEADS = new Set([
	"net",
	"net_name",
	"layer",
	"layers",
	"uuid",
	"polygon",
	"filled_polygon",
	"fill_segments",
]);
