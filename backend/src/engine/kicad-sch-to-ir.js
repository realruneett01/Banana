import { validateCircuitIR } from "./circuit-ir.js";
import { newId } from "./ids.js";
import { parse } from "./sexpr.js";

const LABEL_HEADS = new Set(["label", "global_label", "hierarchical_label"]);

function roundCoord(val) {
	const r = Math.round(Number(val) * 100) / 100;
	return Object.is(r, -0) ? 0 : r;
}

function pointKey(x, y) {
	return `${roundCoord(x).toFixed(2)},${roundCoord(y).toFixed(2)}`;
}

class UnionFind {
	constructor() {
		this.parent = new Map();
	}

	find(x) {
		if (!this.parent.has(x)) {
			this.parent.set(x, x);
			return x;
		}
		let root = x;
		while (this.parent.get(root) !== root) {
			root = this.parent.get(root);
		}
		let curr = x;
		while (curr !== root) {
			const nxt = this.parent.get(curr);
			this.parent.set(curr, root);
			curr = nxt;
		}
		return root;
	}

	union(x, y) {
		const rootX = this.find(x);
		const rootY = this.find(y);
		if (rootX !== rootY) {
			this.parent.set(rootX, rootY);
		}
	}
}

function nodeSym(node) {
	if (node === null || node === undefined) return "";
	return typeof node === "object" ? (node.sym ?? "") : String(node);
}

function extractChildNode(node, head) {
	return node.find((c) => Array.isArray(c) && c[0]?.sym === head);
}

function extractAt(node) {
	const atNode = extractChildNode(node, "at");
	if (!atNode) return null;
	const x = Number(atNode[1]);
	const y = Number(atNode[2]);
	const rot = atNode.length > 3 ? Number(atNode[3]) : 0;
	return { x, y, rot };
}

function extractMirror(node) {
	const mNode = extractChildNode(node, "mirror");
	if (!mNode) return null;
	return nodeSym(mNode[1]).toLowerCase();
}

function extractLibId(node) {
	const libNode = extractChildNode(node, "lib_id");
	if (!libNode) return "";
	return nodeSym(libNode[1]);
}

function extractPinNumber(pinNode) {
	const numNode = extractChildNode(pinNode, "number");
	if (!numNode) return "";
	return nodeSym(numNode[1]);
}

function collectPins(node, pins) {
	if (!Array.isArray(node)) return;
	if (node[0]?.sym === "pin") {
		const at = extractAt(node);
		const num = extractPinNumber(node);
		if (at && num) pins.push({ pin: num, x: at.x, y: at.y });
		return;
	}
	for (let i = 1; i < node.length; i++) {
		if (Array.isArray(node[i])) collectPins(node[i], pins);
	}
}

function dedupeLibPins(pins) {
	const seen = new Set();
	const out = [];
	for (const p of pins) {
		const k = `${p.pin}:${roundCoord(p.x)},${roundCoord(p.y)}`;
		if (!seen.has(k)) {
			seen.add(k);
			out.push(p);
		}
	}
	return out;
}

function parseLibSymbols(libSymbolsNode) {
	const map = new Map();
	if (!Array.isArray(libSymbolsNode)) return map;
	for (const child of libSymbolsNode.slice(1)) {
		if (Array.isArray(child) && child[0]?.sym === "symbol") {
			const name = nodeSym(child[1]);
			const pins = [];
			collectPins(child, pins);
			map.set(name, dedupeLibPins(pins));
		}
	}
	return map;
}

function transformOffset(px, py, rot, mirror) {
	let x = px;
	let y = py;
	if (mirror === "x") y = -y;
	if (mirror === "y") x = -x;
	if (rot) {
		const rad = (rot * Math.PI) / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		const rx = x * cos - y * sin;
		const ry = x * sin + y * cos;
		x = rx;
		y = ry;
	}
	return { dx: x, dy: y };
}

function inRange(val, min, max) {
	return val >= min - 0.01 && val <= max + 0.01;
}

function isPointOnSegment(px, py, seg) {
	if (!inRange(px, Math.min(seg.x1, seg.x2), Math.max(seg.x1, seg.x2))) {
		return false;
	}
	if (!inRange(py, Math.min(seg.y1, seg.y2), Math.max(seg.y1, seg.y2))) {
		return false;
	}
	const dx = seg.x2 - seg.x1;
	const dy = seg.y2 - seg.y1;
	const len = Math.hypot(dx, dy);
	if (len === 0) return false;
	const cross = Math.abs((py - seg.y1) * dx - (px - seg.x1) * dy);
	return cross / len <= 0.01;
}

function extractWirePoints(wireNode) {
	const ptsNode = extractChildNode(wireNode, "pts");
	if (!ptsNode) return [];
	const pts = [];
	for (const child of ptsNode.slice(1)) {
		if (Array.isArray(child) && child[0]?.sym === "xy") {
			pts.push({ x: Number(child[1]), y: Number(child[2]) });
		}
	}
	return pts;
}

function addWireSegments(wireNode, segments, uf) {
	const pts = extractWirePoints(wireNode);
	for (let i = 0; i < pts.length - 1; i++) {
		const p1 = pts[i];
		const p2 = pts[i + 1];
		const k1 = pointKey(p1.x, p1.y);
		const k2 = pointKey(p2.x, p2.y);
		uf.union(k1, k2);
		segments.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, k: k1 });
	}
}

function connectPointToSegments(px, py, segments, uf) {
	const key = pointKey(px, py);
	uf.find(key);
	for (const seg of segments) {
		if (isPointOnSegment(px, py, seg)) {
			uf.union(key, seg.k);
		}
	}
	return key;
}

function processLabelNode(child, ctx) {
	const text = nodeSym(child[1]);
	const at = extractAt(child);
	if (!at) return;
	const key = connectPointToSegments(at.x, at.y, ctx.segments, ctx.uf);
	if (!ctx.pointLabels.has(key)) ctx.pointLabels.set(key, []);
	ctx.pointLabels.get(key).push(text);
	if (ctx.labelFirstPoint.has(text)) {
		ctx.uf.union(key, ctx.labelFirstPoint.get(text));
	} else {
		ctx.labelFirstPoint.set(text, key);
	}
}

function processJunctionNode(child, ctx) {
	const at = extractAt(child);
	if (at) connectPointToSegments(at.x, at.y, ctx.segments, ctx.uf);
}

function isLabelHead(head) {
	return LABEL_HEADS.has(head);
}

function processAstNode(child, ctx) {
	if (!Array.isArray(child)) return;
	const head = child[0]?.sym;
	if (head === "wire") {
		addWireSegments(child, ctx.segments, ctx.uf);
	} else if (head === "junction") {
		processJunctionNode(child, ctx);
	} else if (isLabelHead(head)) {
		processLabelNode(child, ctx);
	} else if (head === "bus" || head === "sheet") {
		ctx.warnings.push(`unsupported element: ${head}`);
	}
}

function isPropertyNode(child) {
	return Array.isArray(child) && child[0]?.sym === "property";
}

function extractProperties(symbolNode) {
	const props = new Map();
	for (const child of symbolNode) {
		if (isPropertyNode(child)) {
			props.set(nodeSym(child[1]), nodeSym(child[2]));
		}
	}
	return props;
}

function shouldSkipSymbol(libId, ref) {
	if (libId.startsWith("power:")) return true;
	return ref.startsWith("#");
}

function parseSymbolPart(symNode, idFn) {
	const libId = extractLibId(symNode);
	const props = extractProperties(symNode);
	const ref = props.get("Reference") || "";
	if (shouldSkipSymbol(libId, ref)) return null;
	const value = props.get("Value") || "";
	const footprint = props.get("Footprint") || "";
	const extraProps = {};
	for (const [k, v] of props) {
		if (k !== "Reference" && k !== "Value" && k !== "Footprint") {
			extraProps[k] = v;
		}
	}
	const at = extractAt(symNode) || { x: 0, y: 0, rot: 0 };
	const mirror = extractMirror(symNode);
	return {
		part: {
			id: idFn("part"),
			ref,
			value,
			symbol: libId,
			footprint,
			props: extraProps,
			placement: { x: at.x, y: at.y, rot: at.rot, side: "F" },
		},
		at,
		mirror,
	};
}

function connectPartPins(partData, libPins, ctx) {
	const { part, at, mirror } = partData;
	for (const lp of libPins) {
		const offset = transformOffset(lp.x, lp.y, at.rot, mirror);
		const px = at.x + offset.dx;
		const py = at.y + offset.dy;
		const key = connectPointToSegments(px, py, ctx.segments, ctx.uf);
		if (!ctx.pointPins.has(key)) ctx.pointPins.set(key, []);
		ctx.pointPins.get(key).push({
			partId: part.id,
			pin: lp.pin,
			ref: part.ref,
		});
	}
}

function findSymbolPins(child, libSymbolsMap, symbolId) {
	const libPins = libSymbolsMap.get(symbolId);
	if (libPins && libPins.length > 0) return libPins;
	const localPins = [];
	collectPins(child, localPins);
	return localPins.length > 0 ? localPins : null;
}

function processSymbols(ast, libSymbolsMap, ctx, idFn) {
	const parts = [];
	for (const child of ast.slice(1)) {
		if (Array.isArray(child) && child[0]?.sym === "symbol") {
			const parsed = parseSymbolPart(child, idFn);
			if (!parsed) continue;
			parts.push(parsed.part);
			const pins = findSymbolPins(child, libSymbolsMap, parsed.part.symbol);
			if (!pins) {
				ctx.warnings.push(`missing library symbol ${parsed.part.symbol}`);
				continue;
			}
			connectPartPins(parsed, pins, ctx);
		}
	}
	return parts;
}

function groupComponents(ctx) {
	const compPins = new Map();
	const compLabels = new Map();
	for (const [key, pins] of ctx.pointPins) {
		const root = ctx.uf.find(key);
		if (!compPins.has(root)) compPins.set(root, []);
		compPins.get(root).push(...pins);
	}
	for (const [key, labels] of ctx.pointLabels) {
		const root = ctx.uf.find(key);
		if (!compLabels.has(root)) compLabels.set(root, []);
		compLabels.get(root).push(...labels);
	}
	return { compPins, compLabels };
}

function dedupePins(pins) {
	const seen = new Set();
	const result = [];
	for (const p of pins) {
		const k = `${p.partId}:${p.pin}`;
		if (!seen.has(k)) {
			seen.add(k);
			result.push(p);
		}
	}
	return result;
}

function comparePins(a, b) {
	const refCmp = a.ref.localeCompare(b.ref, undefined, { numeric: true });
	if (refCmp !== 0) return refCmp;
	return a.pin.localeCompare(b.pin, undefined, { numeric: true });
}

function determineNetName(pins, labels) {
	if (labels.length > 0) {
		labels.sort();
		return labels[0];
	}
	pins.sort(comparePins);
	return `Net-(${pins[0].ref}-Pad${pins[0].pin})`;
}

function buildNets(compPins, compLabels, idFn) {
	const nets = [];
	for (const [root, rawPins] of compPins) {
		const pins = dedupePins(rawPins);
		const labels = compLabels.get(root) || [];
		if (pins.length === 0) continue;
		if (pins.length === 1 && labels.length === 0) continue;
		const name = determineNetName(pins, labels);
		nets.push({
			id: idFn("net"),
			name,
			pins: pins.map((p) => ({ partId: p.partId, pin: p.pin })),
		});
	}
	return nets;
}

function extractTitle(ast) {
	const tb = extractChildNode(ast, "title_block");
	if (!tb) return null;
	const titleNode = extractChildNode(tb, "title");
	if (!titleNode) return null;
	return nodeSym(titleNode[1]);
}

function createParseContext() {
	return {
		uf: new UnionFind(),
		segments: [],
		pointPins: new Map(),
		pointLabels: new Map(),
		labelFirstPoint: new Map(),
		warnings: [],
	};
}

function convertSchToIr(text, { name, idFn }) {
	if (typeof text !== "string") {
		return { ok: false, errors: ["Input must be a string"] };
	}
	let ast;
	try {
		ast = parse(text);
	} catch (err) {
		// Broad catch to guarantee sexpr parse errors are captured
		return { ok: false, errors: [err?.message || String(err)] };
	}
	if (!Array.isArray(ast) || ast[0]?.sym !== "kicad_sch") {
		return {
			ok: false,
			errors: ["Invalid KiCad schematic: root must be kicad_sch"],
		};
	}
	const ctx = createParseContext();
	for (const child of ast.slice(1)) {
		processAstNode(child, ctx);
	}
	const libNode = extractChildNode(ast, "lib_symbols");
	const libMap = parseLibSymbols(libNode);
	const parts = processSymbols(ast, libMap, ctx, idFn);
	const { compPins, compLabels } = groupComponents(ctx);
	const nets = buildNets(compPins, compLabels, idFn);
	const title = extractTitle(ast);
	const irName = name !== "imported" ? name : title || name;
	const ir = { schemaVersion: 1, name: irName, parts, nets, constraints: [] };
	const validation = validateCircuitIR(ir);
	if (!validation.ok) return { ok: false, errors: validation.errors };
	return { ok: true, ir, warnings: ctx.warnings };
}

export function kicadSchToIr(text, { name = "imported", idFn = newId } = {}) {
	try {
		return convertSchToIr(text, { name, idFn });
	} catch (err) {
		// Broad catch to guarantee kicadSchToIr never throws on malformed input
		return { ok: false, errors: [err?.message || String(err)] };
	}
}
