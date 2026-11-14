import { validateCircuitIR } from "./circuit-ir.js";
import { newId } from "./ids.js";
import { collectFootprintPads as collectPadGeometry } from "./kicad-library.js";
import { parse } from "./sexpr.js";

// KiCad's internal unit is 1 nm: keep every digit a board file can hold.
function roundCoord(val) {
	const r = Math.round(Number(val) * 1e6) / 1e6;
	return Object.is(r, -0) ? 0 : r;
}

function nodeSym(node) {
	if (node === null || node === undefined) return "";
	return typeof node === "object" ? (node.sym ?? "") : String(node);
}

function extractChildNode(node, head) {
	if (!Array.isArray(node)) return null;
	return node.find((c) => Array.isArray(c) && c[0]?.sym === head) ?? null;
}

function extractAt(node) {
	const atNode = extractChildNode(node, "at");
	if (!atNode) return { x: 0, y: 0, rot: 0 };
	const x = roundCoord(atNode[1]);
	const y = roundCoord(atNode[2]);
	const rot = atNode.length > 3 ? roundCoord(atNode[3]) : 0;
	return { x, y, rot };
}

function extractLayerName(node) {
	const lNode = extractChildNode(node, "layer");
	if (!lNode || lNode.length < 2) return "";
	return nodeSym(lNode[1]);
}

function extractLayers(ast) {
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

function applyPropertyNode(child, props) {
	if (child[0]?.sym === "property" && child.length >= 3) {
		props.set(nodeSym(child[1]), nodeSym(child[2]));
	}
}

function applyFpTextNode(child, props) {
	if (child[0]?.sym !== "fp_text" || child.length < 3) return;
	const kind = nodeSym(child[1]).toLowerCase();
	if (kind === "reference" && !props.has("Reference")) {
		props.set("Reference", nodeSym(child[2]));
	}
	if (kind === "value" && !props.has("Value")) {
		props.set("Value", nodeSym(child[2]));
	}
}

function extractFootprintProperties(node) {
	const props = new Map();
	for (const child of node) {
		if (Array.isArray(child)) {
			applyPropertyNode(child, props);
			applyFpTextNode(child, props);
		}
	}
	return props;
}

function extractSide(node) {
	const layer = extractLayerName(node);
	return layer.startsWith("B") ? "B" : "F";
}

function parsePlacement(fpNode) {
	const at = extractAt(fpNode);
	return { x: at.x, y: at.y, rot: at.rot, side: extractSide(fpNode) };
}

function extractExtraProps(props) {
	const extra = {};
	for (const [k, v] of props) {
		if (k !== "Reference" && k !== "Value" && k !== "Footprint") {
			extra[k] = v;
		}
	}
	return extra;
}

function parseFootprintPart(fpNode, idFn) {
	const fpName = nodeSym(fpNode[1]);
	const props = extractFootprintProperties(fpNode);
	const ref = props.get("Reference") || "";
	const value = props.get("Value") || "";
	const footprint = props.get("Footprint") || fpName;
	const symbol = props.get("Symbol") || props.get("ki_symbol") || "";
	return {
		id: idFn("part"),
		ref,
		value,
		symbol,
		footprint,
		props: extractExtraProps(props),
		placement: parsePlacement(fpNode),
	};
}

// KiCad 9 writes (net 3 "GND") against a net table; KiCad 10 writes
// (net "GND") with no number, so the name itself keys the net.
function netKeyOf(netNode) {
	if (!Array.isArray(netNode) || netNode.length < 2) return 0;
	return typeof netNode[1] === "number" ? netNode[1] : nodeSym(netNode[1]);
}

function isNetKey(key) {
	return typeof key === "string" ? key !== "" : key > 0;
}

function netNameOf(netNode) {
	const key = netKeyOf(netNode);
	if (typeof key === "string") return key;
	return netNode.length > 2 ? nodeSym(netNode[2]) : "";
}

function parsePad(padNode, partId, padConnections) {
	const padNum = nodeSym(padNode[1]);
	const netNode = extractChildNode(padNode, "net");
	const netNum = netKeyOf(netNode);
	if (!isNetKey(netNum)) return;
	const netName = netNameOf(netNode);
	padConnections.push({ netNum, netName, partId, pin: padNum });
}

function collectFootprintPads(fpNode, partId, padConnections) {
	for (const child of fpNode) {
		if (Array.isArray(child) && child[0]?.sym === "pad") {
			parsePad(child, partId, padConnections);
		}
	}
}

function relAngle(rot, fpRot) {
	return (((rot - fpRot) % 360) + 360) % 360;
}

// Board files store pad angles absolute; the editor wants them footprint-relative.
function toLocalPad(pad, fpRot) {
	const [x, y, rot] = pad.at;
	return { ...pad, at: [x, y, relAngle(rot, fpRot)] };
}

const GRAPHIC_LAYERS = new Set([
	"F.SilkS",
	"B.SilkS",
	"F.Fab",
	"B.Fab",
	"F.CrtYd",
	"B.CrtYd",
]);

function roundMilli(val) {
	const r = Math.round(Number(val) * 1000) / 1000;
	return Object.is(r, -0) ? 0 : r;
}

function milliPt(node) {
	return [roundMilli(node?.[1] ?? 0), roundMilli(node?.[2] ?? 0)];
}

function childPt(node, head) {
	return milliPt(extractChildNode(node, head));
}

function strokeWidth(node) {
	const stroke = extractChildNode(node, "stroke");
	const width = extractChildNode(stroke ?? node, "width");
	return width ? roundMilli(width[1]) : 0.12;
}

// A rect becomes a polygon so it stays correct under any footprint rotation.
function rectToPoly(node) {
	const [x1, y1] = childPt(node, "start");
	const [x2, y2] = childPt(node, "end");
	const pts = [
		[x1, y1],
		[x2, y1],
		[x2, y2],
		[x1, y2],
	];
	return { type: "poly", pts };
}

function circleShape(node) {
	const center = childPt(node, "center");
	const [ex, ey] = childPt(node, "end");
	const radius = roundMilli(Math.hypot(ex - center[0], ey - center[1]));
	return { type: "circle", center, radius };
}

// Board files written by KiCad 7+ always give arcs a mid point.
function arcShape(node) {
	if (!extractChildNode(node, "mid")) return null;
	const [start, mid, end] = ["start", "mid", "end"].map((h) =>
		childPt(node, h),
	);
	return { type: "arc", start, mid, end };
}

function polyShape(node) {
	const pts = (extractChildNode(node, "pts") ?? []).filter(
		(c) => Array.isArray(c) && c[0]?.sym === "xy",
	);
	return { type: "poly", pts: pts.map(milliPt) };
}

const GRAPHIC_SHAPES = new Map([
	[
		"fp_line",
		(n) => ({
			type: "line",
			start: childPt(n, "start"),
			end: childPt(n, "end"),
		}),
	],
	["fp_rect", rectToPoly],
	["fp_circle", circleShape],
	["fp_arc", arcShape],
	["fp_poly", polyShape],
]);

// Footprint-local silk/fab/courtyard outlines in the editor's primitive shape. Text
// strokes stay out to keep the board JSON small.
function compactGraphic(node) {
	const shape = GRAPHIC_SHAPES.get(node[0]?.sym);
	const layer = extractLayerName(node);
	if (!shape || !GRAPHIC_LAYERS.has(layer)) return null;
	const g = shape(node);
	return g && { ...g, layer, width: strokeWidth(node) };
}

function compactGraphics(fpNode) {
	return fpNode
		.filter((c) => Array.isArray(c))
		.map(compactGraphic)
		.filter(Boolean);
}

function isReferenceText(node) {
	const head = node[0]?.sym;
	const kind = nodeSym(node[1]);
	if (head === "property") return kind === "Reference";
	return head === "fp_text" && kind.toLowerCase() === "reference";
}

function fontChild(textNode, head) {
	const effects = extractChildNode(textNode, "effects");
	return extractChildNode(extractChildNode(effects, "font"), head);
}

function fontHeight(textNode) {
	const size = fontChild(textNode, "size");
	return size ? roundMilli(size[1]) : 1;
}

// Stroke thickness, only when the file gives one.
function fontThickness(textNode) {
	const thickness = fontChild(textNode, "thickness");
	return thickness ? { thickness: roundMilli(thickness[1]) } : {};
}

// KiCad 8+ writes (hide yes); older files a bare `hide` in the text or its
// effects.
function hiddenFlag(textNode) {
	const hide = extractChildNode(textNode, "hide");
	const effects = extractChildNode(textNode, "effects") ?? [];
	const bare = [...textNode, ...effects].some((n) => nodeSym(n) === "hide");
	const hidden = hide ? nodeSym(hide[1]) !== "no" : bare;
	return hidden ? { hide: true } : {};
}

// Back-side text is normally drawn mirrored; a file may say otherwise.
function mirrorFlag(textNode) {
	const effects = extractChildNode(textNode, "effects");
	const justify = extractChildNode(effects, "justify") ?? [];
	return justify.some((n) => nodeSym(n) === "mirror") ? { mirror: true } : {};
}

// Reference text position: footprint-local, angle relative to the footprint
// (the board file stores text angles absolute, like pad angles).
function referenceLabel(fpNode, fpRot) {
	const text = fpNode.find((c) => Array.isArray(c) && isReferenceText(c));
	const at = extractChildNode(text, "at");
	if (!at) return null;
	const rot = at.length > 3 ? Number(at[3]) : 0;
	return {
		at: milliPt(at),
		rot: relAngle(rot, fpRot),
		layer: extractLayerName(text),
		size: fontHeight(text),
		...fontThickness(text),
		...hiddenFlag(text),
		...mirrorFlag(text),
	};
}

// (attr smd exclude_from_pos_files ...) flags, kept as written.
function footprintAttr(fpNode) {
	const attr = extractChildNode(fpNode, "attr");
	return attr ? { attr: attr.slice(1).map(nodeSym) } : {};
}

// Pads exactly as placed on the board (already flipped for B side), plus
// compact silk/fab/courtyard outlines, the attributes and the reference text
// position.
function embeddedFootprint(fpNode, fpRot) {
	const fp = {
		embedded: true,
		...footprintAttr(fpNode),
		pads: collectPadGeometry(fpNode).map((pad) => toLocalPad(pad, fpRot)),
		graphics: compactGraphics(fpNode),
	};
	const refLabel = referenceLabel(fpNode, fpRot);
	return refLabel ? { ...fp, refLabel } : fp;
}

function collectDeclaredNets(ast, netInfoMap) {
	for (const child of ast.slice(1)) {
		if (Array.isArray(child) && child[0]?.sym === "net") {
			const netNum = Number(child[1]);
			const name = child.length > 2 ? nodeSym(child[2]) : "";
			if (netNum > 0 && name !== "") {
				netInfoMap.set(netNum, { number: netNum, name, pins: [] });
			}
		}
	}
}

function registerNetNumber(netNum, netName, netInfoMap) {
	if (!isNetKey(netNum)) return;
	if (!netInfoMap.has(netNum)) {
		const fallbackName = netName || `Net-${netNum}`;
		netInfoMap.set(netNum, { number: netNum, name: fallbackName, pins: [] });
	} else if (netName && !netInfoMap.get(netNum).name) {
		netInfoMap.get(netNum).name = netName;
	}
}

function attachPadConnections(padConnections, netInfoMap) {
	for (const conn of padConnections) {
		registerNetNumber(conn.netNum, conn.netName, netInfoMap);
		const netInfo = netInfoMap.get(conn.netNum);
		if (netInfo) {
			netInfo.pins.push({ partId: conn.partId, pin: conn.pin });
		}
	}
}

function dedupePins(pins) {
	const seen = new Set();
	const out = [];
	for (const p of pins) {
		const k = `${p.partId}:${p.pin}`;
		if (!seen.has(k)) {
			seen.add(k);
			out.push(p);
		}
	}
	return out;
}

function compareNetEntries([a], [b]) {
	if (typeof a === "number" && typeof b === "number") return a - b;
	return String(a).localeCompare(String(b));
}

function buildIrNets(netInfoMap, idFn) {
	const sortedEntries = [...netInfoMap.entries()].sort(compareNetEntries);
	const irNets = [];
	const netNumberToId = new Map();
	for (const [netNum, info] of sortedEntries) {
		const netId = idFn("net");
		netNumberToId.set(netNum, netId);
		irNets.push({
			id: netId,
			name: info.name,
			pins: dedupePins(info.pins),
		});
	}
	return { irNets, netNumberToId };
}

// The uuid lets a saved edit delete exactly this track or via.
function uuidOf(node) {
	const uuid = nodeSym(extractChildNode(node, "uuid")?.[1]);
	return uuid ? { uuid } : {};
}

function parseTrack(node, netNumberToId) {
	const startNode = extractChildNode(node, "start");
	const endNode = extractChildNode(node, "end");
	const widthNode = extractChildNode(node, "width");
	const netNum = netKeyOf(extractChildNode(node, "net"));
	return {
		...uuidOf(node),
		netId: netNumberToId.get(netNum) ?? "",
		layer: extractLayerName(node),
		start: [roundCoord(startNode?.[1] || 0), roundCoord(startNode?.[2] || 0)],
		end: [roundCoord(endNode?.[1] || 0), roundCoord(endNode?.[2] || 0)],
		widthMm: roundCoord(widthNode?.[1] || 0),
	};
}

function parseVia(node, netNumberToId) {
	const at = extractAt(node);
	const sizeNode = extractChildNode(node, "size");
	const drillNode = extractChildNode(node, "drill");
	const netNum = netKeyOf(extractChildNode(node, "net"));
	return {
		...uuidOf(node),
		netId: netNumberToId.get(netNum) ?? "",
		at: [at.x, at.y],
		drillMm: roundCoord(drillNode?.[1] || 0),
		sizeMm: roundCoord(sizeNode?.[1] || 0),
	};
}

function extractPolygonPts(polyNode) {
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

function parseZone(node, netNumberToId) {
	const netNum = netKeyOf(extractChildNode(node, "net"));
	const polyNode =
		extractChildNode(node, "filled_polygon") ||
		extractChildNode(node, "polygon");
	return {
		netId: netNumberToId.get(netNum) ?? "",
		layer: extractLayerName(node),
		polygon: extractPolygonPts(polyNode),
	};
}

function parseGrRectOutline(rectNode) {
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

function normAngle(a) {
	let res = a % (2 * Math.PI);
	if (res < 0) res += 2 * Math.PI;
	return res;
}

function ptsToSegments(pts) {
	const segs = [];
	for (let i = 0; i < pts.length - 1; i++) {
		segs.push({ start: pts[i], end: pts[i + 1] });
	}
	return segs;
}

function sampleArcCircle(c, p1, pm, p2) {
	const r = Math.hypot(p1[0] - c[0], p1[1] - c[1]);
	const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
	const am = Math.atan2(pm[1] - c[1], pm[0] - c[0]);
	const a2 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
	const dm = normAngle(am - a1);
	const d2 = normAngle(a2 - a1);
	const sweep = dm < d2 ? d2 : -(2 * Math.PI - d2);
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

function approximateMidArc(p1, pm, p2) {
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

function approximateAngleArc(c, p1, angleDeg) {
	const r = Math.hypot(p1[0] - c[0], p1[1] - c[1]);
	const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
	const sweep = (angleDeg * Math.PI) / 180;
	const pts = [p1];
	for (let i = 1; i < 8; i++) {
		const ang = a1 + (i / 8) * sweep;
		pts.push([
			roundCoord(c[0] + r * Math.cos(ang)),
			roundCoord(c[1] + r * Math.sin(ang)),
		]);
	}
	const aEnd = a1 + sweep;
	pts.push([
		roundCoord(c[0] + r * Math.cos(aEnd)),
		roundCoord(c[1] + r * Math.sin(aEnd)),
	]);
	return ptsToSegments(pts);
}

function parseGrArcSegments(node) {
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

function isPointClose(p1, p2) {
	return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) <= 0.05;
}

function findNextSegment(curr, segs, used) {
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

function chainSegmentsToPolygon(segs) {
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

function isEdgeCutsNode(child) {
	return Array.isArray(child) && extractLayerName(child) === "Edge.Cuts";
}

function processEdgeCutsNode(child, rects, segs) {
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

function extractEdgeCutsOutline(ast) {
	const rects = [];
	const segs = [];
	for (const child of ast.slice(1)) {
		if (isEdgeCutsNode(child)) {
			processEdgeCutsNode(child, rects, segs);
		}
	}
	if (rects.length > 0) return parseGrRectOutline(rects[0]);
	return chainSegmentsToPolygon(segs);
}

function extractTitle(ast) {
	const tb = extractChildNode(ast, "title_block");
	if (!tb) return null;
	const titleNode = extractChildNode(tb, "title");
	return titleNode ? nodeSym(titleNode[1]) : null;
}

function scanElementNet(node, netInfoMap) {
	const netNode = extractChildNode(node, "net");
	registerNetNumber(netKeyOf(netNode), netNameOf(netNode ?? []), netInfoMap);
}

function scanElements(list, netInfoMap) {
	for (const el of list) {
		scanElementNet(el, netInfoMap);
	}
}

function createPcbContext() {
	return {
		parts: [],
		padConnections: [],
		rawSegments: [],
		rawVias: [],
		rawZones: [],
		footprints: {},
		warnings: [],
		usedRefs: new Set(),
	};
}

function findCandidateRef(base, usedRefs) {
	if (base !== "NOREF" && !usedRefs.has(base)) {
		return base;
	}
	let n = base === "NOREF" ? 1 : 2;
	while (usedRefs.has(`${base}_${n}`)) {
		n++;
	}
	return `${base}_${n}`;
}

function uniqueRef(ref, usedRefs, warnings) {
	const base = ref !== "" && ref !== "REF**" ? ref : "NOREF";
	const finalRef = findCandidateRef(base, usedRefs);
	usedRefs.add(finalRef);
	if (finalRef !== ref) {
		const old = ref || "empty";
		warnings.push(`renamed footprint reference ${old} to ${finalRef}`);
	}
	return finalRef;
}

function collectPcbElements(ast, ctx, idFn) {
	for (const child of ast.slice(1)) {
		if (!Array.isArray(child)) continue;
		const head = child[0]?.sym;
		if (head === "footprint" || head === "module") {
			const part = parseFootprintPart(child, idFn);
			part.ref = uniqueRef(part.ref, ctx.usedRefs, ctx.warnings);
			ctx.parts.push(part);
			collectFootprintPads(child, part.id, ctx.padConnections);
			ctx.footprints[part.id] = embeddedFootprint(child, part.placement.rot);
		} else if (head === "segment") {
			ctx.rawSegments.push(child);
		} else if (head === "via") {
			ctx.rawVias.push(child);
		} else if (head === "zone") {
			ctx.rawZones.push(child);
		}
	}
}

function resolveIrName(name, title) {
	if (name !== "imported-board") return name;
	return title || name;
}

function parseAstOrError(text) {
	if (typeof text !== "string") {
		return { ok: false, errors: ["Input must be a string"] };
	}
	try {
		const ast = parse(text);
		if (!Array.isArray(ast) || ast[0]?.sym !== "kicad_pcb") {
			return {
				ok: false,
				errors: ["Invalid KiCad PCB: root must be kicad_pcb"],
			};
		}
		return { ok: true, ast };
	} catch (err) {
		// Broad catch to guarantee sexpr parse errors are captured
		return { ok: false, errors: [err?.message || String(err)] };
	}
}

function populateNetMap(ast, ctx) {
	const netInfoMap = new Map();
	collectDeclaredNets(ast, netInfoMap);
	attachPadConnections(ctx.padConnections, netInfoMap);
	scanElements(ctx.rawSegments, netInfoMap);
	scanElements(ctx.rawVias, netInfoMap);
	scanElements(ctx.rawZones, netInfoMap);
	return netInfoMap;
}

function buildBoardGeometry(ast, ctx, netNumberToId) {
	return {
		outline: extractEdgeCutsOutline(ast),
		layers: extractLayers(ast),
		tracks: ctx.rawSegments.map((s) => parseTrack(s, netNumberToId)),
		vias: ctx.rawVias.map((v) => parseVia(v, netNumberToId)),
		zones: ctx.rawZones.map((z) => parseZone(z, netNumberToId)),
		footprints: ctx.footprints,
	};
}

function convertPcbToIr(text, { name, idFn }) {
	const parsed = parseAstOrError(text);
	if (!parsed.ok) return parsed;
	const { ast } = parsed;
	const ctx = createPcbContext();
	collectPcbElements(ast, ctx, idFn);
	const netInfoMap = populateNetMap(ast, ctx);
	const { irNets, netNumberToId } = buildIrNets(netInfoMap, idFn);
	const irName = resolveIrName(name, extractTitle(ast));
	const ir = {
		schemaVersion: 1,
		name: irName,
		parts: ctx.parts,
		nets: irNets,
		constraints: [],
	};
	const validation = validateCircuitIR(ir);
	if (!validation.ok) return { ok: false, errors: validation.errors };
	return {
		ok: true,
		ir,
		board: buildBoardGeometry(ast, ctx, netNumberToId),
		warnings: ctx.warnings,
	};
}

export function kicadPcbToIr(
	text,
	{ name = "imported-board", idFn = newId } = {},
) {
	try {
		return convertPcbToIr(text, { name, idFn });
	} catch (err) {
		// Broad catch to guarantee kicadPcbToIr never throws on malformed input
		return { ok: false, errors: [err?.message || String(err)] };
	}
}
