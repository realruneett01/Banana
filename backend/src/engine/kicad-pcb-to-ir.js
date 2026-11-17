import { validateCircuitIR } from "./circuit-ir.js";
import { newId } from "./ids.js";
import { collectFootprintPads as collectPadGeometry } from "./kicad-library.js";
import {
	childPt,
	edgeCutsOutline,
	extractAt,
	extractChildNode,
	extractLayerName,
	extractLayerNames,
	extractLayers,
	extractPolygonPts,
	extractSide,
	FP_SETTING_HEADS,
	GRAPHIC_LAYERS,
	isNetKey,
	isReferenceText,
	isValueText,
	milliPt,
	netKeyOf,
	netNameOf,
	nodeSym,
	PAD_MODEL_HEADS,
	relAngle,
	roundCoord,
	roundMilli,
	uuidOf,
	withoutUuid,
	ZONE_MODEL_HEADS,
} from "./kicad-pcb-common.js";
import { orientFootprint } from "./kicad-pcb-edit.js";
import { parse, sym } from "./sexpr.js";

export { edgeCutsOutline, isEdgeCutsNode } from "./kicad-pcb-common.js";

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

// Board files store pad angles absolute; the editor wants them footprint-relative.
function toLocalPad(pad, fpRot) {
	const [x, y, rot] = pad.at;
	return { ...pad, at: [x, y, relAngle(rot, fpRot)] };
}

function strokeWidth(node) {
	const stroke = extractChildNode(node, "stroke");
	const width = extractChildNode(stroke ?? node, "width");
	return width ? roundMilli(width[1]) : 0.12;
}

// A rect becomes a polygon so it stays correct under any footprint rotation;
// `rect` lets the writer put it back as an fp_rect.
function rectToPoly(node) {
	const [x1, y1] = childPt(node, "start");
	const [x2, y2] = childPt(node, "end");
	const pts = [
		[x1, y1],
		[x2, y1],
		[x2, y2],
		[x1, y2],
	];
	return { type: "poly", pts, rect: true };
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
	return g && { ...g, layer, width: strokeWidth(node), ...fillFlag(node) };
}

// (fill yes) / (fill solid): the shape is drawn filled.
function fillFlag(node) {
	const fill = nodeSym(extractChildNode(node, "fill")?.[1]);
	return fill && fill !== "no" && fill !== "none" ? { fill: true } : {};
}

function compactGraphics(fpNode) {
	return fpNode
		.filter((c) => Array.isArray(c))
		.map(compactGraphic)
		.filter(Boolean);
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

// Back-side text is normally drawn mirrored; a file may say otherwise. The
// rest of (justify ...) (left, right, top, bottom) is kept as written.
function justifyFlags(textNode) {
	const effects = extractChildNode(textNode, "effects");
	const tokens = (extractChildNode(effects, "justify") ?? []).slice(1);
	const justify = tokens.map(nodeSym).filter((t) => t !== "mirror");
	return {
		...(tokens.length > justify.length ? { mirror: true } : {}),
		...(justify.length > 0 ? { justify } : {}),
	};
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
		...justifyFlags(text),
		...unlockedFlag(text),
	};
}

// (unlocked yes): the text does not turn with its footprint to stay upright.
function unlockedFlag(textNode) {
	const unlocked = extractChildNode(textNode, "unlocked");
	return unlocked && nodeSym(unlocked[1]) !== "no" ? { unlocked: true } : {};
}

// Numbered user layers can hold overlays of hundreds of thousands of
// strokes (the jetson demo has 287k on User.9), too big for the board JSON:
// footprint shapes on them are left out, with a warning.
function isUserLayerShape(node) {
	const head = node[0]?.sym ?? "";
	return head.startsWith("fp_") && /^User\.\d+$/.test(extractLayerName(node));
}

// User texts, shapes the compact graphics do not hold, and settings.
function isExtraNode(node) {
	const head = node[0]?.sym ?? "";
	if (FP_SETTING_HEADS.has(head)) return true;
	if (!head.startsWith("fp_") || isReferenceText(node)) return false;
	if (isValueText(node) || isUserLayerShape(node)) return false;
	return !compactGraphic(node);
}

// Copies of footprint children taken to the front at 0 degrees, the frame
// the writer builds a footprint in before turning it to its placement.
function frontItems(fpNode, nodes) {
	const layer = extractChildNode(fpNode, "layer") ?? [sym("layer"), "F.Cu"];
	const at = [sym("at"), 0, 0, extractAt(fpNode).rot];
	const tmp = [sym("footprint"), structuredClone(layer), at];
	tmp.push(...structuredClone(nodes));
	orientFootprint(tmp, 0, "F");
	return tmp.slice(3).map(withoutUuid);
}

// Pad settings (shape ratios, pin function and type, ...) kept as written.
function withPadExtra(pad, frontPadNode) {
	const extra = frontPadNode
		.slice(1)
		.filter((c) => Array.isArray(c) && !PAD_MODEL_HEADS.has(c[0]?.sym));
	return extra.length > 0 ? { ...pad, extra } : pad;
}

function isPadNode(node) {
	return node[0]?.sym === "pad";
}

// The Value text and the extras, front-side like a library footprint.
function rawFootprintItems(fpNode, fpRot) {
	const children = fpNode.filter((c) => Array.isArray(c));
	const front = (keep) => frontItems(fpNode, children.filter(keep));
	const [valueText] = front(isValueText);
	const extras = front(isExtraNode);
	const frontPads = front(isPadNode);
	const pads = collectPadGeometry(fpNode).map((pad, i) =>
		withPadExtra(toLocalPad(pad, fpRot), frontPads[i]),
	);
	return {
		...(valueText ? { valueText } : {}),
		...(extras.length > 0 ? { extras } : {}),
		pads,
	};
}

// (attr smd exclude_from_pos_files ...) flags, kept as written.
function footprintAttr(fpNode) {
	const attr = extractChildNode(fpNode, "attr");
	return attr ? { attr: attr.slice(1).map(nodeSym) } : {};
}

// Pads exactly as placed on the board (already flipped for B side), plus
// compact silk/fab/courtyard outlines, the attributes and the reference text
// position. The Value text, other texts and shapes and the settings are
// kept as written, front-side (see rawFootprintItems).
function embeddedFootprint(fpNode, fpRot) {
	const fp = {
		embedded: true,
		...footprintAttr(fpNode),
		...rawFootprintItems(fpNode, fpRot),
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

// An (arc ...) track passes through its mid point.
function midOf(node) {
	const mid = extractChildNode(node, "mid");
	return mid ? { mid: [roundCoord(mid[1]), roundCoord(mid[2])] } : {};
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
		...midOf(node),
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

// A zone on several layers lists them all; `layer` is the first.
function zoneLayers(node) {
	const layers = extractChildNode(node, "layers");
	if (!layers) return { layer: extractLayerName(node) };
	const names = layers.slice(1).map(nodeSym);
	return { layer: names[0] ?? "", layers: names };
}

// The outline and settings (clearances, thermals, keepout, ...) as written.
// Fills are left out: KiCad computes them from these, and they are most of a
// board's size.
function parseZone(node, netNumberToId) {
	const netNum = netKeyOf(extractChildNode(node, "net"));
	const settings = node
		.slice(1)
		.filter((c) => Array.isArray(c) && !ZONE_MODEL_HEADS.has(c[0]?.sym));
	return {
		...uuidOf(node),
		netId: netNumberToId.get(netNum) ?? "",
		...zoneLayers(node),
		polygon: extractPolygonPts(extractChildNode(node, "polygon")),
		settings,
	};
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
		drawings: [],
		footprints: {},
		warnings: [],
		usedRefs: new Set(),
		userLayerShapes: 0,
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

function addFootprint(fpNode, ctx, idFn) {
	const part = parseFootprintPart(fpNode, idFn);
	part.ref = uniqueRef(part.ref, ctx.usedRefs, ctx.warnings);
	ctx.parts.push(part);
	collectFootprintPads(fpNode, part.id, ctx.padConnections);
	ctx.footprints[part.id] = embeddedFootprint(fpNode, part.placement.rot);
	ctx.userLayerShapes += fpNode.filter(
		(c) => Array.isArray(c) && isUserLayerShape(c),
	).length;
}

const ELEMENT_LISTS = {
	segment: "rawSegments",
	arc: "rawSegments",
	via: "rawVias",
	zone: "rawZones",
	dimension: "drawings",
	target: "drawings",
};

// Board drawings (gr_line, gr_text, gr_poly, ...) are kept as written.
function elementList(head) {
	return head.startsWith("gr_") ? "drawings" : ELEMENT_LISTS[head];
}

function collectPcbElements(ast, ctx, idFn) {
	for (const child of ast.slice(1)) {
		if (!Array.isArray(child)) continue;
		const head = child[0]?.sym ?? "";
		if (head === "footprint" || head === "module") {
			addFootprint(child, ctx, idFn);
		} else {
			ctx[elementList(head)]?.push(child);
		}
	}
}

function resolveIrName(name, title) {
	if (name !== "imported-board") return name;
	return title || name;
}

// KiCad reads a bare keyword right after ')' as the start of a new list:
// "(curved_edges no)filter_ratio 0.9)" loads (and re-saves) as
// "(filter_ratio 0.9)". Strings match first, so a ')' inside one is kept.
const BARE_KEYWORD_AFTER_CLOSE = /"(?:[^"\\]|\\.)*"|\)(?=[A-Za-z_])/g;

function restoreMissingOpens(text) {
	let count = 0;
	const repaired = text.replace(BARE_KEYWORD_AFTER_CLOSE, (match) => {
		if (match !== ")") return match;
		count++;
		return ")(";
	});
	return { repaired, count };
}

// Strict parse first; only a board the strict parser rejects is retried with
// the KiCad recovery, and the original error stands if the retry fails too.
function parseOrNull(text) {
	try {
		return parse(text);
	} catch {
		return null;
	}
}

function parseWithKicadRecovery(text) {
	try {
		return { ast: parse(text), warnings: [] };
	} catch (err) {
		const { repaired, count } = restoreMissingOpens(text);
		const ast = count > 0 ? parseOrNull(repaired) : null;
		if (ast === null) throw err;
		const warning = `recovered ${count} lists missing '(' before a bare keyword, as KiCad does`;
		return { ast, warnings: [warning] };
	}
}

function parseAstOrError(text) {
	if (typeof text !== "string") {
		return { ok: false, errors: ["Input must be a string"] };
	}
	try {
		const { ast, warnings } = parseWithKicadRecovery(text);
		if (!Array.isArray(ast) || ast[0]?.sym !== "kicad_pcb") {
			return {
				ok: false,
				errors: ["Invalid KiCad PCB: root must be kicad_pcb"],
			};
		}
		return { ok: true, ast, warnings };
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

// The board's own setup (stackup, mask and paste rules, plot options) and
// thickness, as written.
function boardSetup(ast) {
	const setup = extractChildNode(ast, "setup");
	const general = extractChildNode(ast, "general");
	const thickness = extractChildNode(general, "thickness");
	return {
		...(setup ? { setup } : {}),
		...(thickness ? { thicknessMm: roundCoord(thickness[1]) } : {}),
	};
}

const ROUTING_HEADS = new Set(["segment", "arc", "via"]);

// Each track, arc and via keeps its place among them in the file, so the
// writer can interleave them as written (KiCad's zone refill depends on it).
function routingOrder(ast) {
	const order = new Map();
	for (const node of ast) {
		if (ROUTING_HEADS.has(node?.[0]?.sym)) order.set(node, order.size);
	}
	return order;
}

function buildBoardGeometry(ast, ctx, netNumberToId) {
	const order = routingOrder(ast);
	const withOrder = (node, parse) => ({
		...parse(node, netNumberToId),
		order: order.get(node),
	});
	return {
		...boardSetup(ast),
		outline: edgeCutsOutline(ctx.drawings),
		layers: extractLayers(ast),
		layerNames: extractLayerNames(ast),
		drawings: ctx.drawings,
		tracks: ctx.rawSegments.map((s) => withOrder(s, parseTrack)),
		vias: ctx.rawVias.map((v) => withOrder(v, parseVia)),
		zones: ctx.rawZones.map((z) => parseZone(z, netNumberToId)),
		footprints: ctx.footprints,
	};
}

function warnUserLayers(ctx) {
	if (ctx.userLayerShapes > 0) {
		const n = ctx.userLayerShapes;
		ctx.warnings.push(
			`left out ${n} footprint shape(s) on numbered User layers`,
		);
	}
}

function convertPcbToIr(text, { name, idFn }) {
	const parsed = parseAstOrError(text);
	if (!parsed.ok) return parsed;
	const { ast } = parsed;
	const ctx = createPcbContext();
	ctx.warnings.push(...parsed.warnings);
	collectPcbElements(ast, ctx, idFn);
	warnUserLayers(ctx);
	const netInfoMap = populateNetMap(ast, ctx);
	const { irNets, netNumberToId } = buildIrNets(netInfoMap, idFn);
	const ir = {
		schemaVersion: 1,
		name: resolveIrName(name, extractTitle(ast)),
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
