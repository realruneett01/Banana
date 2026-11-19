import { randomUUID } from "node:crypto";
import { validateCircuitIR } from "./circuit-ir.js";
import { PIN_TYPES } from "./erc-pin-matrix.js";
import { newId } from "./ids.js";
import { parse } from "./sexpr.js";

const LABEL_HEADS = new Set(["label", "global_label", "hierarchical_label"]);
const CORE_PROP_KEYS = new Set(["Reference", "Value", "Footprint"]);
// Label kinds that reach other sheets, as recorded in a group's links.
const LINK_KINDS = { global_label: "global", hierarchical_label: "hier" };

function roundCoord(val) {
	const rounded = Math.round(Number(val) * 100) / 100;
	return rounded === 0 ? 0 : rounded;
}

function pointKey(x, y) {
	return `${roundCoord(x).toFixed(2)},${roundCoord(y).toFixed(2)}`;
}

export class UnionFind {
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
	if (node == null) return "";
	return typeof node === "object" ? (node.sym ?? "") : `${node}`;
}

function matchHead(item, head) {
	return Array.isArray(item) && item[0]?.sym === head;
}

function extractChildNode(node, head) {
	if (!Array.isArray(node)) return null;
	return node.find((c) => matchHead(c, head)) ?? null;
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

function extractChildText(node, head) {
	const child = extractChildNode(node, head);
	return child ? nodeSym(child[1]) : "";
}

function extractLibId(node) {
	return extractChildText(node, "lib_id");
}

function extractPinNumber(pinNode) {
	return extractChildText(pinNode, "number");
}

const SUB_SYMBOL_RE = /_(\d+)_(\d+)$/;

function parseSubSymbolUnitStyle(node, unit, style) {
	if (!matchHead(node, "symbol")) {
		return { unit, style };
	}
	const m = nodeSym(node[1]).match(SUB_SYMBOL_RE);
	if (!m) {
		return { unit: 0, style: 0 };
	}
	return { unit: Number(m[1]), style: Number(m[2]) };
}

const KNOWN_PIN_TYPES = new Set(PIN_TYPES);

function extractPinType(pinNode) {
	const type = nodeSym(pinNode[1]);
	return KNOWN_PIN_TYPES.has(type) ? type : null;
}

function recordPin(node, pins, unit, style) {
	const at = extractAt(node);
	const num = extractPinNumber(node);
	// Power ports often have an empty pin number; parts drop those later.
	if (at && extractChildNode(node, "number")) {
		const type = extractPinType(node);
		const name = extractChildText(node, "name");
		pins.push({ pin: num, name, x: at.x, y: at.y, unit, style, type });
	}
}

function collectPins(node, pins, unit = 0, style = 0) {
	if (!Array.isArray(node)) return;
	if (node[0]?.sym === "pin") {
		recordPin(node, pins, unit, style);
		return;
	}
	for (const child of node.slice(1)) {
		if (!Array.isArray(child)) continue;
		const next = parseSubSymbolUnitStyle(child, unit, style);
		collectPins(child, pins, next.unit, next.style);
	}
}

function dedupeBy(items, keyFn) {
	const seen = new Set();
	const out = [];
	for (const item of items) {
		const k = keyFn(item);
		if (!seen.has(k)) {
			seen.add(k);
			out.push(item);
		}
	}
	return out;
}

function dedupeLibPins(pins) {
	return dedupeBy(
		pins,
		(p) =>
			`${p.pin}:${roundCoord(p.x)},${roundCoord(p.y)}:${p.unit}:${p.style}`,
	);
}

// Lib entries with a (power ...) marker are power ports or PWR_FLAG.
function collectPowerLibs(libSymbolsNode) {
	const names = new Set();
	for (const child of libSymbolsNode?.slice(1) ?? []) {
		if (extractChildNode(child, "power")) names.add(nodeSym(child[1]));
	}
	return names;
}

function parseLibSymbols(libSymbolsNode) {
	const map = new Map();
	if (!Array.isArray(libSymbolsNode)) return map;
	for (const child of libSymbolsNode.slice(1)) {
		if (!Array.isArray(child) || child[0]?.sym !== "symbol") continue;
		const pins = [];
		collectPins(child, pins);
		map.set(nodeSym(child[1]), dedupeLibPins(pins));
	}
	return map;
}

function applyRotation(x, y, rot) {
	if (!rot) return { x, y };
	const rad = (rot * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	return {
		x: x * cos - y * sin,
		y: x * sin + y * cos,
	};
}

// Library pins are Y-up; the sheet is Y-down, so the symbol angle turns
// counter-clockwise on screen. Mirroring applies after the rotation.
function transformOffset(px, py, rot, mirror) {
	const r = applyRotation(px, -py, -rot);
	return {
		dx: mirror === "y" ? -r.x : r.x,
		dy: mirror === "x" ? -r.y : r.y,
	};
}

function inRange(val, min, max) {
	return val >= min - 0.01 && val <= max + 0.01;
}

function isPointWithinBounds(px, py, seg) {
	const withinX = inRange(
		px,
		Math.min(seg.x1, seg.x2),
		Math.max(seg.x1, seg.x2),
	);
	const withinY = inRange(
		py,
		Math.min(seg.y1, seg.y2),
		Math.max(seg.y1, seg.y2),
	);
	return withinX && withinY;
}

function isPointOnSegment(px, py, seg) {
	if (!isPointWithinBounds(px, py, seg)) return false;
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
		if (!Array.isArray(child) || child[0]?.sym !== "xy") continue;
		pts.push({ x: Number(child[1]), y: Number(child[2]) });
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

function recordPointLabel(key, text, ctx) {
	if (!ctx.pointLabels.has(key)) ctx.pointLabels.set(key, []);
	ctx.pointLabels.get(key).push(text);
	if (ctx.labelFirstPoint.has(text)) {
		ctx.uf.union(key, ctx.labelFirstPoint.get(text));
	} else {
		ctx.labelFirstPoint.set(text, key);
	}
}

function processLabelNode(child, ctx) {
	const text = nodeSym(child[1]);
	const at = extractAt(child);
	if (!at) return;
	const kind = LINK_KINDS[child[0].sym];
	if (isBusName(text)) {
		const link = kind && { kind, name: text };
		return recordBusName(at, { name: text, link }, ctx);
	}
	const key = connectPointToSegments(at.x, at.y, ctx.segments, ctx.uf);
	recordPointLabel(key, text, ctx);
	// Global and hierarchical labels reach other sheets, where a driver may be.
	if (!kind) return;
	ctx.drivenPoints.add(key);
	pushAt(ctx.pointLinks, key, { kind, name: text });
}

function pushAt(map, key, item) {
	if (!map.has(key)) map.set(key, []);
	map.get(key).push(item);
}

function processJunctionNode(child, ctx) {
	const at = extractAt(child);
	if (at) connectPointToSegments(at.x, at.y, ctx.segments, ctx.uf);
}

// kicad-cli skips the not-driven checks on a net carrying a no-connect flag.
function processNoConnectNode(child, ctx) {
	const at = extractAt(child);
	if (!at) return;
	const key = connectPointToSegments(at.x, at.y, ctx.segments, ctx.uf);
	ctx.drivenPoints.add(key);
	ctx.noConnectPoints.add(key);
}

// Sheet pins link this sheet's wires to a sub-sheet that may drive them.
function processSheetPins(sheetNode, ctx) {
	const sheet = extractChildText(sheetNode, "uuid");
	const file = extractProperties(sheetNode).get("Sheetfile") ?? "";
	ctx.sheets.push({ uuid: sheet, file });
	for (const pin of sheetNode.filter((c) => matchHead(c, "pin"))) {
		const at = extractAt(pin);
		if (at)
			recordSheetPin(
				at,
				{ kind: "sheetPin", sheet, name: nodeSym(pin[1]) },
				ctx,
			);
	}
}

function recordSheetPin(at, link, ctx) {
	if (isBusName(link.name)) {
		return recordBusName(at, { name: link.name, link }, ctx);
	}
	const key = connectPointToSegments(at.x, at.y, ctx.segments, ctx.uf);
	ctx.drivenPoints.add(key);
	pushAt(ctx.pointLinks, key, link);
}

// Buses: NAME[a..b] vectors and {A B} / NAME{A B} groups, where a token may
// name a bus_alias. "~{", "^{" and "_{" are overbar/super/subscript text.
const VECTOR_RE = /^(.*)\[(\d+)\.\.(\d+)\]$/;
const GROUP_RE = /^((?:[^{}]*[^{}~^_])?)\{([^{}]*)\}$/;

function isBusName(name) {
	return VECTOR_RE.test(name) || GROUP_RE.test(name);
}

// Vector members are keyed by position, as KiCad joins IO[8..15] to a
// sheet pin IO[0..7]: IO8 with IO0.
function vectorMembers([, prefix, from, to]) {
	const [a, b] = [Number(from), Number(to)];
	const step = a <= b ? 1 : -1;
	const out = [];
	for (let i = a; i !== b + step; i += step) {
		out.push({ key: `#${out.length}`, net: `${prefix}${i}` });
	}
	return out;
}

function memberNames(token) {
	const vector = VECTOR_RE.exec(token);
	return vector ? vectorMembers(vector).map((m) => m.net) : [token];
}

// Group members are keyed by their name inside the group; a named group
// NAME{...} prefixes its nets with "NAME.".
function groupMembers([, prefix, body], aliases) {
	const tokens = body.split(/[\s,]+/).filter(Boolean);
	const names = tokens
		.flatMap((t) => aliases.get(t) ?? [t])
		.flatMap(memberNames);
	const net = (name) => (prefix ? `${prefix}.${name}` : name);
	return names.map((name) => ({ key: name, net: net(name) }));
}

function busMembers(name, aliases) {
	const vector = VECTOR_RE.exec(name);
	if (vector) return vectorMembers(vector);
	return groupMembers(GROUP_RE.exec(name), aliases);
}

function recordBusName(at, entry, ctx) {
	const key = connectPointToSegments(at.x, at.y, ctx.busSegments, ctx.busUf);
	pushAt(ctx.busNames, key, entry);
}

function processBusAlias(child, ctx) {
	const members = extractChildNode(child, "members") ?? [];
	ctx.aliases.set(nodeSym(child[1]), members.slice(1).map(nodeSym));
}

// Each member of a bus is a net point. A naming entry gives it its name, so
// it joins wires labelled with that name. A member of a sheet-crossing bus
// name also gets that crossing, renamed to the member.
function expandBusEntry(root, entry, named, ctx) {
	for (const member of busMembers(entry.name, ctx.aliases)) {
		const key = `bus:${root}:${member.key}`;
		if (named) recordPointLabel(key, member.net, ctx);
		if (!entry.link) continue;
		ctx.drivenPoints.add(key);
		pushAt(ctx.pointLinks, key, { ...entry.link, name: member.net });
	}
}

const isBusLabel = (entry) => entry.link?.kind !== "sheetPin";

// A sheet pin names a bus's members only when no label on that bus does:
// IO[8..15] on a bus into sheet pin IO[0..7] has members IO8..IO15 here.
function expandBuses(ctx) {
	const byRoot = new Map();
	for (const [point, entries] of ctx.busNames) {
		for (const entry of entries) pushAt(byRoot, ctx.busUf.find(point), entry);
	}
	for (const [root, entries] of byRoot) {
		const labelled = entries.some(isBusLabel);
		for (const entry of entries) {
			expandBusEntry(root, entry, !labelled || isBusLabel(entry), ctx);
		}
	}
}

function handleUnsupportedHead(head, ctx) {
	if (head === "sheet") {
		ctx.warnings.push(`unsupported element: ${head}`);
	}
}

const NODE_HANDLERS = new Map([
	["wire", (child, ctx) => addWireSegments(child, ctx.segments, ctx.uf)],
	["bus", (child, ctx) => addWireSegments(child, ctx.busSegments, ctx.busUf)],
	["bus_alias", processBusAlias],
	["junction", processJunctionNode],
	["no_connect", processNoConnectNode],
	["sheet", processSheetPins],
]);

function processAstNode(child, ctx) {
	if (!Array.isArray(child)) return;
	const head = child[0]?.sym;
	if (LABEL_HEADS.has(head)) return processLabelNode(child, ctx);
	NODE_HANDLERS.get(head)?.(child, ctx);
	handleUnsupportedHead(head, ctx);
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

function extractSymbolExtraProps(props) {
	const extraProps = {};
	for (const [k, v] of props) {
		if (!CORE_PROP_KEYS.has(k)) {
			extraProps[k] = v;
		}
	}
	return extraProps;
}

function extractSymbolPlacement(symNode) {
	const at = extractAt(symNode);
	return at ? at : { x: 0, y: 0, rot: 0 };
}

function extractInstanceUnit(symNode) {
	const node = extractChildNode(symNode, "unit");
	if (!node || node[1] == null) return 1;
	const val = Number(node[1]);
	return Number.isFinite(val) ? val : 1;
}

function extractInstanceStyle(symNode) {
	const node =
		extractChildNode(symNode, "convert") ??
		extractChildNode(symNode, "body_style");
	if (!node || node[1] == null) return 1;
	const val = Number(node[1]);
	return Number.isFinite(val) ? val : 1;
}

// KiCad 7+ keeps each sheet instance's reference and unit on the symbol:
// (instances (project "name" (path "/<root uuid>/<sheet uuid>..." ...))).
function findInstance(symNode, sheetPath) {
	const projects = extractChildNode(symNode, "instances")?.slice(1) ?? [];
	const paths = projects.flatMap((p) => (Array.isArray(p) ? p.slice(1) : []));
	return paths.find((p) => matchHead(p, "path") && nodeSym(p[1]) === sheetPath);
}

// Without a sheet path or a matching instance: the Reference property.
function instanceRefUnit(symNode, props, sheetPath) {
	const instance = sheetPath && findInstance(symNode, sheetPath);
	const ref = props.get("Reference") || "";
	if (!instance) return { ref, unit: extractInstanceUnit(symNode) };
	const instanceRef = extractChildText(instance, "reference");
	return { ref: instanceRef || ref, unit: extractInstanceUnit(instance) };
}

function parseSymbolData(symNode, sheetPath) {
	const libId = extractLibId(symNode);
	const props = extractProperties(symNode);
	const { ref, unit } = instanceRefUnit(symNode, props, sheetPath);
	return {
		virtual: shouldSkipSymbol(libId, ref),
		libId,
		libKey: extractChildText(symNode, "lib_name") || libId,
		ref,
		props,
		at: extractSymbolPlacement(symNode),
		mirror: extractMirror(symNode),
		unit,
		style: extractInstanceStyle(symNode),
	};
}

function createPartRecord(parsed, idFn, finalRef) {
	const { libId, props, at } = parsed;
	return {
		id: idFn("part"),
		ref: finalRef,
		value: props.get("Value") || "",
		symbol: libId,
		footprint: props.get("Footprint") || "",
		props: extractSymbolExtraProps(props),
		placement: { x: at.x, y: at.y, rot: at.rot, side: "F" },
	};
}

function matchUnit(pinUnit, targetUnit) {
	return pinUnit === 0 || pinUnit === targetUnit;
}

function matchStyle(pinStyle, targetStyle) {
	return pinStyle === 0 || pinStyle === targetStyle;
}

function matchesPin(p, unit, style) {
	return matchUnit(p.unit, unit) && matchStyle(p.style, style);
}

function pinsForInstance(pins, unit, style) {
	return pins.filter((p) => matchesPin(p, unit, style));
}

function isAnnotatedRef(ref) {
	return Boolean(ref && !ref.endsWith("?"));
}

function canMergeInstance(ref, unit, refMap, refUnits) {
	if (!isAnnotatedRef(ref) || !refMap.has(ref)) return false;
	const units = refUnits.get(ref);
	return Boolean(units && !units.has(unit));
}

function resolveUniqueRef(ref, refMap, ctx) {
	let n = 2;
	let candidate = `${ref}_${n}`;
	while (refMap.has(candidate)) {
		n++;
		candidate = `${ref}_${n}`;
	}
	ctx.warnings.push(`renamed duplicate reference ${ref} to ${candidate}`);
	return candidate;
}

function resolvePartRef(ref, refMap, ctx) {
	if (!refMap.has(ref)) return ref;
	return resolveUniqueRef(ref, refMap, ctx);
}

function resolveTargetPart(parsed, symState, ctx) {
	const { refMap, refUnits, idFn } = symState;
	const { ref, unit } = parsed;
	if (canMergeInstance(ref, unit, refMap, refUnits)) {
		refUnits.get(ref).add(unit);
		return { part: refMap.get(ref), isNew: false };
	}
	const finalRef = resolvePartRef(ref, refMap, ctx);
	const part = createPartRecord(parsed, idFn, finalRef);
	refMap.set(finalRef, part);
	refUnits.set(finalRef, new Set([unit]));
	return { part, isNew: true };
}

function connectLibPin(lp, at, mirror, ctx) {
	const offset = transformOffset(lp.x, lp.y, at.rot, mirror);
	const px = at.x + offset.dx;
	const py = at.y + offset.dy;
	return connectPointToSegments(px, py, ctx.segments, ctx.uf);
}

function connectPartPins(partData, libPins, ctx) {
	const { part, at, mirror } = partData;
	for (const lp of libPins) {
		const key = connectLibPin(lp, at, mirror, ctx);
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

function recordPinTypes(part, pins) {
	for (const { pin, type } of pins) {
		if (!type) continue;
		part.pinTypes ??= {};
		part.pinTypes[pin] = type;
	}
}

// "~" is KiCad's marker for an unnamed pin.
function recordPinNames(part, pins) {
	for (const { pin, name } of pins) {
		if (!name || name === "~") continue;
		part.pinNames ??= {};
		part.pinNames[pin] = name;
	}
}

function connectSymbolPins(child, libMap, parsed, target) {
	const rawPins = findSymbolPins(child, libMap, parsed.libKey);
	if (!rawPins) {
		target.ctx.warnings.push(`missing library symbol ${parsed.libId}`);
		return;
	}
	const pins = pinsForInstance(rawPins, parsed.unit, parsed.style).filter(
		(p) => p.pin,
	);
	const partData = {
		part: target.part,
		at: parsed.at,
		mirror: parsed.mirror,
	};
	connectPartPins(partData, pins, target.ctx);
	recordPinTypes(target.part, pins);
	recordPinNames(target.part, pins);
}

// Typed pins of power ports and PWR_FLAG, kept for ERC only (not parts).
// A power port's hidden pin may have an empty number; it still counts.
function recordErcPin(key, ercPin, ctx) {
	if (!ercPin.type) return;
	if (!ctx.pointErcPins.has(key)) ctx.pointErcPins.set(key, []);
	ctx.pointErcPins.get(key).push(ercPin);
}

// Power ports and PWR_FLAG are not parts, but they drive their net; a
// power_in port also names it by its Value, globally like a global label.
function connectPowerSymbol(parsed, libSymbolsMap, ctx) {
	if (!ctx.powerLibs.has(parsed.libKey)) return;
	const libPins = libSymbolsMap.get(parsed.libKey);
	const netName = parsed.props.get("Value");
	for (const lp of pinsForInstance(libPins, parsed.unit, parsed.style)) {
		const key = connectLibPin(lp, parsed.at, parsed.mirror, ctx);
		ctx.drivenPoints.add(key);
		recordErcPin(key, { ref: parsed.ref, pin: lp.pin, type: lp.type }, ctx);
		if (lp.type === "power_in" && netName) {
			recordPointLabel(key, netName, ctx);
			pushAt(ctx.pointLinks, key, { kind: "global", name: netName });
		}
	}
}

function processSingleSymbol(child, libSymbolsMap, ctx, symState) {
	const parsed = parseSymbolData(child, ctx.sheetPath);
	if (parsed.virtual) {
		connectPowerSymbol(parsed, libSymbolsMap, ctx);
		return null;
	}
	const { part, isNew } = resolveTargetPart(parsed, symState, ctx);
	connectSymbolPins(child, libSymbolsMap, parsed, { part, ctx });
	return isNew ? part : null;
}

function processSymbols(ast, libSymbolsMap, ctx, idFn) {
	const refMap = new Map();
	const refUnits = new Map();
	const symState = { refMap, refUnits, idFn };
	const parts = [];
	for (const child of ast.slice(1)) {
		if (!Array.isArray(child) || child[0]?.sym !== "symbol") continue;
		const part = processSingleSymbol(child, libSymbolsMap, ctx, symState);
		if (part) parts.push(part);
	}
	return parts;
}

function appendGroupedItems(sourceMap, targetMap, uf) {
	for (const [key, items] of sourceMap) {
		const root = uf.find(key);
		if (!targetMap.has(root)) targetMap.set(root, []);
		targetMap.get(root).push(...items);
	}
}

function groupComponents(ctx) {
	const compPins = new Map();
	const compLabels = new Map();
	const compErcPins = new Map();
	const compLinks = new Map();
	appendGroupedItems(ctx.pointPins, compPins, ctx.uf);
	appendGroupedItems(ctx.pointLabels, compLabels, ctx.uf);
	appendGroupedItems(ctx.pointErcPins, compErcPins, ctx.uf);
	appendGroupedItems(ctx.pointLinks, compLinks, ctx.uf);
	const noConnectRoots = new Set(
		[...ctx.noConnectPoints].map((k) => ctx.uf.find(k)),
	);
	const compSites = new Map();
	const compFlags = new Map();
	appendGroupedItems(pointSites(ctx), compSites, ctx.uf);
	appendGroupedItems(noConnectFlags(ctx), compFlags, ctx.uf);
	const comps = { compPins, compLabels, compErcPins, compLinks };
	return { ...comps, noConnectRoots, compSites, compFlags };
}

// Pin sites: one per part per point, as KiCad counts stacked pins once.
function pointSites(ctx) {
	const sites = new Map();
	for (const [key, pins] of ctx.pointPins) {
		sites.set(key, [...new Set(pins.map((p) => p.partId))]);
	}
	return sites;
}

const flagPin = (p) => (p.partId ? { partId: p.partId, pin: p.pin } : p);

// The pins sitting exactly on each no-connect flag, one list per flag; a
// flag on a bare wire has none.
function noConnectFlags(ctx) {
	const flags = new Map();
	for (const key of ctx.noConnectPoints) {
		const at = ctx.pointPins.get(key) ?? [];
		const pins = [...at, ...(ctx.pointErcPins.get(key) ?? [])];
		if (pins.length > 0) pushAt(flags, key, pins.map(flagPin));
	}
	return flags;
}

function dedupePins(pins) {
	return dedupeBy(pins, (p) => `${p.partId}:${p.pin}`);
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

function shouldSkipNet(pins, labels) {
	if (pins.length === 0) return true;
	return pins.length === 1 && labels.length === 0;
}

function buildNets(groups, drivenRoots, idFn) {
	const nets = [];
	for (const [root, rawPins] of groups.compPins) {
		const pins = dedupePins(rawPins);
		const labels = groups.compLabels.get(root) || [];
		if (shouldSkipNet(pins, labels)) continue;
		const ercPins = groups.compErcPins.get(root);
		nets.push({
			id: idFn("net"),
			name: determineNetName(pins, labels),
			...(drivenRoots.has(root) && { driven: true }),
			pins: pins.map((p) => ({ partId: p.partId, pin: p.pin })),
			...(ercPins && { ercPins }),
		});
	}
	return nets;
}

function groupRoots(groups) {
	const { compPins, compErcPins, compLinks } = groups;
	const keys = [compPins, compErcPins, compLinks].flatMap((m) => [...m.keys()]);
	return new Set(keys);
}

// Like shouldSkipNet, but ERC-only pins and off-sheet links keep a group.
function isLoneGroup(group, labels) {
	const pinCount = group.pins.length + group.ercPins.length;
	return pinCount <= 1 && labels.length === 0 && group.links.length === 0;
}

// For no_connect_connected: the group's pin sites (power-port pins count
// one each) and, per no-connect flag, the pins under it.
function noConnectFields(root, groups) {
	const sites = groups.compSites.get(root)?.length ?? 0;
	const ercSites = groups.compErcPins.get(root)?.length ?? 0;
	const noConnects = groups.compFlags.get(root) ?? [];
	return { pinSites: sites + ercSites, noConnects };
}

function buildErcGroup(root, groups) {
	const pins = dedupePins(groups.compPins.get(root) ?? []);
	const labels = [...(groups.compLabels.get(root) ?? [])];
	const named = pins.length > 0 || labels.length > 0;
	const group = {
		name: named ? determineNetName(pins, labels) : "",
		pins: pins.map((p) => ({ partId: p.partId, pin: p.pin })),
		ercPins: groups.compErcPins.get(root) ?? [],
		links: groups.compLinks.get(root) ?? [],
		...(groups.noConnectRoots.has(root) && { noConnect: true }),
		...noConnectFields(root, groups),
	};
	return isLoneGroup(group, labels) ? null : group;
}

// Every connected group, with the links that join it to other sheets.
function buildErcGroups(groups) {
	const out = [];
	for (const root of groupRoots(groups)) {
		const group = buildErcGroup(root, groups);
		if (group) out.push(group);
	}
	return out;
}

function extractTitle(ast) {
	const tb = extractChildNode(ast, "title_block");
	if (!tb) return null;
	const titleNode = extractChildNode(tb, "title");
	return titleNode ? nodeSym(titleNode[1]) : null;
}

function createParseContext(aliases = new Map()) {
	return {
		uf: new UnionFind(),
		segments: [],
		busUf: new UnionFind(),
		busSegments: [],
		busNames: new Map(),
		aliases: new Map(aliases),
		pointPins: new Map(),
		pointLabels: new Map(),
		labelFirstPoint: new Map(),
		drivenPoints: new Set(),
		noConnectPoints: new Set(),
		pointErcPins: new Map(),
		pointLinks: new Map(),
		sheets: [],
		warnings: [],
	};
}

function isKicadSchAst(ast) {
	return Array.isArray(ast) && ast[0]?.sym === "kicad_sch";
}

function parseSchAst(text) {
	if (typeof text !== "string") {
		return { ok: false, errors: ["Input must be a string"] };
	}
	try {
		const ast = parse(text);
		if (!isKicadSchAst(ast)) {
			return {
				ok: false,
				errors: ["Invalid KiCad schematic: root must be kicad_sch"],
			};
		}
		return { ok: true, ast };
	} catch (err) {
		// Broad catch to guarantee sexpr parse errors are captured
		return { ok: false, errors: [err?.message || String(err)] };
	}
}

function resolveIrName(name, ast) {
	if (name !== "imported") return name;
	return extractTitle(ast) || name;
}

function populateContextElements(ast, ctx) {
	for (const child of ast.slice(1)) {
		processAstNode(child, ctx);
	}
	expandBuses(ctx);
}

function assembleCircuit(ast, ctx, idFn) {
	populateContextElements(ast, ctx);
	const libNode = extractChildNode(ast, "lib_symbols");
	const libMap = parseLibSymbols(libNode);
	ctx.powerLibs = collectPowerLibs(libNode);
	const parts = processSymbols(ast, libMap, ctx, idFn);
	const groups = groupComponents(ctx);
	const drivenRoots = new Set([...ctx.drivenPoints].map((k) => ctx.uf.find(k)));
	const nets = buildNets(groups, drivenRoots, idFn);
	return { parts, nets, groups };
}

const TEXT_ANNOTATION_KINDS = {
	label: "label",
	global_label: "globalLabel",
	hierarchical_label: "hierLabel",
	text: "text",
};

const POINT_ANNOTATION_KINDS = {
	no_connect: "noConnect",
	junction: "junction",
};

function nextAnnotationId(idFn) {
	return idFn?.("annotation") ?? `ann_${randomUUID()}`;
}

function extractAtCoords(node) {
	const atNode = extractChildNode(node, "at");
	if (!atNode) return null;
	const x = Number(atNode[1]);
	const y = Number(atNode[2]);
	const rot = atNode.length > 3 ? Number(atNode[3]) : undefined;
	return { x, y, rot };
}

function parseTextAnnotation(head, child, idFn) {
	const kind = TEXT_ANNOTATION_KINDS[head];
	if (!kind) return null;
	const at = extractAtCoords(child);
	if (!at) return null;
	const uuid = extractChildText(child, "uuid");
	return {
		id: nextAnnotationId(idFn),
		kind,
		x: at.x,
		y: at.y,
		text: nodeSym(child[1]),
		...(at.rot !== undefined && { rot: at.rot }),
		...(uuid && { uuid }),
	};
}

function parsePointAnnotation(head, child, idFn) {
	const kind = POINT_ANNOTATION_KINDS[head];
	if (!kind) return null;
	const at = extractAtCoords(child);
	if (!at) return null;
	const uuid = extractChildText(child, "uuid");
	return {
		id: nextAnnotationId(idFn),
		kind,
		x: at.x,
		y: at.y,
		...(uuid && { uuid }),
	};
}

function parseLineAnnotation(child, idFn) {
	const pts = extractWirePoints(child);
	if (pts.length !== 2) return null;
	const uuid = extractChildText(child, "uuid");
	return {
		id: nextAnnotationId(idFn),
		kind: "line",
		x: pts[0].x,
		y: pts[0].y,
		x2: pts[1].x,
		y2: pts[1].y,
		...(uuid && { uuid }),
	};
}

function parseBusSegments(child, idFn) {
	const pts = extractWirePoints(child);
	if (pts.length < 2) return [];
	const uuid = extractChildText(child, "uuid");
	const segments = [];
	for (let i = 0; i < pts.length - 1; i++) {
		segments.push({
			id: nextAnnotationId(idFn),
			kind: "bus",
			x: pts[i].x,
			y: pts[i].y,
			x2: pts[i + 1].x,
			y2: pts[i + 1].y,
			...(uuid && { uuid }),
		});
	}
	return segments;
}

function parseChildAnnotation(child, idFn) {
	if (!Array.isArray(child) || !child[0]) return null;
	const head = child[0]?.sym;
	if (head === "polyline") return parseLineAnnotation(child, idFn);
	if (head === "bus") return parseBusSegments(child, idFn);
	return (
		parseTextAnnotation(head, child, idFn) ??
		parsePointAnnotation(head, child, idFn)
	);
}

function collectAnnotations(ast, idFn) {
	const annotations = [];
	for (const child of ast.slice(1)) {
		const parsed = parseChildAnnotation(child, idFn);
		if (Array.isArray(parsed)) {
			annotations.push(...parsed);
		} else if (parsed) {
			annotations.push(parsed);
		}
	}
	return annotations;
}

function convertSchToIr(text, { name, idFn }) {
	const parsed = parseSchAst(text);
	if (!parsed.ok) return parsed;

	const { ast } = parsed;
	const ctx = createParseContext();
	const { parts, nets } = assembleCircuit(ast, ctx, idFn);
	const annotations = collectAnnotations(ast, idFn);
	const ir = {
		schemaVersion: 1,
		name: resolveIrName(name, ast),
		parts,
		nets,
		constraints: [],
		annotations,
	};

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

// For whole-project ERC: parts, connected groups with their off-sheet links
// (global names, hierarchical labels, sheet pins) and the sub-sheets used.
// `aliases` adds bus aliases defined on other sheets of the project; the
// result's `aliases` holds those plus this sheet's own. `sheetPath` is the
// instance's KiCad path "/<root uuid>/<sheet uuid>..." (default: this
// sheet as root), which picks each symbol's reference and unit.
export function kicadSchToErcGraph(text, options = {}) {
	const { idFn = newId, aliases, sheetPath } = options;
	try {
		const parsed = parseSchAst(text);
		if (!parsed.ok) return parsed;
		const ctx = createParseContext(aliases);
		ctx.sheetPath = sheetPath ?? `/${extractChildText(parsed.ast, "uuid")}`;
		const { parts, groups } = assembleCircuit(parsed.ast, ctx, idFn);
		const ercGroups = buildErcGroups(groups);
		const { sheets, sheetPath: path } = ctx;
		return {
			ok: true,
			parts,
			groups: ercGroups,
			sheets,
			aliases: ctx.aliases,
			path,
		};
	} catch (err) {
		// Broad catch: one malformed sheet must not abort a project walk
		return { ok: false, errors: [err?.message || String(err)] };
	}
}
