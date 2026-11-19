import { refNumber, refPrefix } from "./annotate.js";

const COORD_PAIRS = [
	["x", "y"],
	["x2", "y2"],
	["xm", "ym"],
];

const BOARD_KEYS = ["tracks", "vias", "graphics", "zones"];

const DELETION_HANDLERS = [
	{
		prop: "parts",
		createCommand: (id) => ({ type: "deletePart", partId: id }),
	},
	{
		prop: "annotations",
		createCommand: (id) => ({ type: "deleteAnnotation", id }),
	},
	{
		prop: "sheets",
		createCommand: (id) => ({ type: "deleteSheet", sheetId: id }),
	},
];

function nextId(prefix) {
	return `${prefix}_${crypto.randomUUID()}`;
}

export function selectAllIds(doc) {
	if (!doc?.ir) return [];
	const ir = doc.ir;
	const parts = (ir.parts ?? []).map((p) => p.id);
	const annotations = (ir.annotations ?? []).map((a) => a.id);
	const sheets = (ir.sheets ?? []).map((s) => s.id);
	return [...parts, ...annotations, ...sheets].filter(Boolean);
}

function collectCoordPoints(item, pts) {
	if (!item) return;
	for (const [kx, ky] of COORD_PAIRS) {
		if (typeof item[kx] === "number" && typeof item[ky] === "number") {
			pts.push([item[kx], item[ky]]);
		}
	}
}

function collectPartPoint(p, pts) {
	const pos = p.placement ?? p;
	if (typeof pos?.x === "number" && typeof pos?.y === "number") {
		pts.push([pos.x, pos.y]);
	}
}

function computeOrigin(points) {
	if (points.length === 0) return { x: 0, y: 0 };
	let minX = points[0][0];
	let minY = points[0][1];
	for (const [x, y] of points) {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
	}
	return { x: minX, y: minY };
}

function collectSchematicPoints(parts, annotations, sheets) {
	const pts = [];
	for (const p of parts) collectPartPoint(p, pts);
	for (const a of annotations) collectCoordPoints(a, pts);
	for (const s of sheets) collectCoordPoints(s, pts);
	return pts;
}

function addPinConnections(netName, keptPins, connections) {
	for (let i = 0; i < keptPins.length - 1; i++) {
		connections.push({
			netName,
			partIdA: keptPins[i].partId,
			pinA: keptPins[i].pin,
			partIdB: keptPins[i + 1].partId,
			pinB: keptPins[i + 1].pin,
		});
	}
}

function collectKeptConnections(nets, partIdSet) {
	const connections = [];
	for (const net of nets) {
		const kept = (net.pins ?? []).filter((p) => partIdSet.has(p.partId));
		if (kept.length >= 2) {
			addPinConnections(net.name, kept, connections);
		}
	}
	return connections;
}

export function copySchematic(doc, selectionIds) {
	const ids = new Set(selectionIds ?? doc?.selection ?? []);
	const ir = doc?.ir ?? {};
	const parts = (ir.parts ?? []).filter((p) => ids.has(p.id));
	const annotations = (ir.annotations ?? []).filter((a) => ids.has(a.id));
	const sheets = (ir.sheets ?? []).filter((s) => ids.has(s.id));
	const partIdSet = new Set(parts.map((p) => p.id));
	const connections = collectKeptConnections(ir.nets ?? [], partIdSet);
	const points = collectSchematicPoints(parts, annotations, sheets);

	return {
		kind: "schematic",
		parts: structuredClone(parts),
		annotations: structuredClone(annotations),
		sheets: structuredClone(sheets),
		connections,
		origin: computeOrigin(points),
	};
}

function buildUsedRefNumbers(parts) {
	const map = new Map();
	for (const p of parts) {
		const num = refNumber(p?.ref);
		if (num === null) continue;
		const prefix = refPrefix(p.ref);
		if (!map.has(prefix)) map.set(prefix, new Set());
		map.get(prefix).add(num);
	}
	return map;
}

function nextFreeRef(prefix, usedMap) {
	if (!usedMap.has(prefix)) usedMap.set(prefix, new Set());
	const used = usedMap.get(prefix);
	let n = 1;
	while (used.has(n)) n++;
	used.add(n);
	return `${prefix}${n}`;
}

function nextUniqueString(
	base,
	usedSet,
	formatCandidate = (b, n) => `${b}_${n}`,
) {
	if (!usedSet.has(base)) {
		usedSet.add(base);
		return base;
	}
	let n = 1;
	while (usedSet.has(formatCandidate(base, n))) n++;
	const res = formatCandidate(base, n);
	usedSet.add(res);
	return res;
}

function uniqueSheetName(name, usedNames) {
	return nextUniqueString(name || "Sheet", usedNames);
}

function cleanSheetFile(name) {
	const clean = (name ?? "").replace(/[^A-Za-z0-9_-]/g, "");
	return `${clean || "sheet"}.kicad_sch`;
}

function uniqueSheetFile(file, name, usedFiles) {
	const base = file || cleanSheetFile(name);
	return nextUniqueString(
		base,
		usedFiles,
		(b, n) => `${b.replace(/\.kicad_sch$/, "")}_${n}.kicad_sch`,
	);
}

function shiftCoords(obj, dx, dy) {
	if (!obj) return;
	obj.x = (obj.x ?? 0) + dx;
	obj.y = (obj.y ?? 0) + dy;
	for (const [kx, ky] of [
		["x2", "y2"],
		["xm", "ym"],
	]) {
		if (typeof obj[kx] === "number") obj[kx] += dx;
		if (typeof obj[ky] === "number") obj[ky] += dy;
	}
}

function translatePart(part, dx, dy, ref) {
	const next = structuredClone(part);
	next.id = nextId("part");
	next.ref = ref;
	const target = next.placement ?? next;
	shiftCoords(target, dx, dy);
	return next;
}

function translateSheet(sheet, dx, dy, meta) {
	const next = structuredClone(sheet);
	next.id = nextId("sheet");
	next.name = meta.name;
	next.file = meta.file;
	shiftCoords(next, dx, dy);
	if (Array.isArray(next.pins)) {
		next.pins = next.pins.map((pin) => ({
			...pin,
			id: nextId("pin"),
		}));
	}
	return next;
}

function translateAnnotation(ann, dx, dy) {
	const next = structuredClone(ann);
	next.id = nextId("ann");
	shiftCoords(next, dx, dy);
	return next;
}

function addPastedParts(clipParts, dx, dy, ctx) {
	for (const p of clipParts) {
		const newRef = nextFreeRef(refPrefix(p.ref), ctx.usedRefs);
		const newPart = translatePart(p, dx, dy, newRef);
		ctx.partIdMap.set(p.id, newPart.id);
		ctx.commands.push({ type: "addPart", part: newPart });
	}
}

function addPastedSheets(clipSheets, dx, dy, ctx) {
	for (const s of clipSheets) {
		const name = uniqueSheetName(s.name, ctx.usedNames);
		const file = uniqueSheetFile(s.file, name, ctx.usedFiles);
		const newSheet = translateSheet(s, dx, dy, { name, file });
		ctx.commands.push({ type: "addSheet", sheet: newSheet });
	}
}

function addPastedConnections(clipConnections, ctx) {
	for (const conn of clipConnections) {
		const partIdA = ctx.partIdMap.get(conn.partIdA);
		const partIdB = ctx.partIdMap.get(conn.partIdB);
		if (partIdA && partIdB) {
			ctx.commands.push({
				type: "connect",
				partIdA,
				pinA: conn.pinA,
				partIdB,
				pinB: conn.pinB,
			});
		}
	}
}

export function pasteSchematicCommands(doc, clip, at) {
	const dx = (at?.x ?? 0) - (clip?.origin?.x ?? 0);
	const dy = (at?.y ?? 0) - (clip?.origin?.y ?? 0);
	const ctx = {
		commands: [],
		partIdMap: new Map(),
		usedRefs: buildUsedRefNumbers(doc?.ir?.parts ?? []),
		usedNames: new Set((doc?.ir?.sheets ?? []).map((s) => s.name)),
		usedFiles: new Set((doc?.ir?.sheets ?? []).map((s) => s.file)),
	};

	addPastedParts(clip?.parts ?? [], dx, dy, ctx);
	addPastedSheets(clip?.sheets ?? [], dx, dy, ctx);

	for (const a of clip?.annotations ?? []) {
		ctx.commands.push({
			type: "addAnnotation",
			annotation: translateAnnotation(a, dx, dy),
		});
	}

	addPastedConnections(clip?.connections ?? [], ctx);

	return { type: "batch", commands: ctx.commands };
}

export function duplicateSchematicCommands(
	doc,
	selectionIds,
	offset = { x: 2.54, y: 2.54 },
) {
	const clip = copySchematic(doc, selectionIds);
	const at = {
		x: clip.origin.x + (offset?.x ?? 2.54),
		y: clip.origin.y + (offset?.y ?? 2.54),
	};
	return pasteSchematicCommands(doc, clip, at);
}

function appendItemDeletions(items, idSet, createCommand, commands) {
	for (const item of items) {
		if (idSet.has(item.id)) commands.push(createCommand(item.id));
	}
}

function collectDeletionCommands(ir, idSet) {
	const commands = [];
	for (const { prop, createCommand } of DELETION_HANDLERS) {
		appendItemDeletions(ir?.[prop] ?? [], idSet, createCommand, commands);
	}
	return commands;
}

export function cutSchematicCommands(doc, selectionIds) {
	const clip = copySchematic(doc, selectionIds);
	const ids = new Set(selectionIds ?? doc?.selection ?? []);
	const commands = collectDeletionCommands(doc?.ir, ids);
	return { clip, command: { type: "batch", commands } };
}

function hasIdOrSelf(set, item) {
	if (item.id && set.has(item.id)) return true;
	if (item.uuid && set.has(item.uuid)) return true;
	return set.has(item);
}

function toLookupSet(val) {
	if (!val) return null;
	return val instanceof Set ? val : new Set(Array.isArray(val) ? val : []);
}

function isItemSelected(item, selection, key) {
	if (!selection) return false;
	const directSet = toLookupSet(selection);
	if (directSet) return hasIdOrSelf(directSet, item);
	if (typeof selection === "object" && selection[key]) {
		const groupSet = toLookupSet(selection[key]);
		return groupSet ? hasIdOrSelf(groupSet, item) : false;
	}
	return false;
}

function collectTrackPoints(t, pts) {
	for (const key of ["start", "end", "mid"]) {
		if (Array.isArray(t[key])) pts.push(t[key]);
	}
}

function collectViaPoint(v, pts) {
	if (Array.isArray(v.at)) {
		pts.push(v.at);
		return;
	}
	collectCoordPoints(v, pts);
}

function collectFootprintPoint(fp, pts) {
	if (Array.isArray(fp.at)) {
		pts.push(fp.at);
		return;
	}
	if (Array.isArray(fp.position)) {
		pts.push(fp.position);
		return;
	}
	collectCoordPoints(fp.placement ?? fp, pts);
}

function collectZonePoints(z, pts) {
	const poly = z.polygon ?? z.points ?? [];
	for (const p of poly) {
		if (Array.isArray(p)) pts.push(p);
	}
}

function collectAllBoardPoints(items) {
	const pts = [];
	for (const t of items.tracks) collectTrackPoints(t, pts);
	for (const v of items.vias) collectViaPoint(v, pts);
	for (const g of items.graphics) collectCoordPoints(g, pts);
	for (const f of items.footprints) collectFootprintPoint(f, pts);
	for (const z of items.zones) collectZonePoints(z, pts);
	return pts;
}

function extractFootprintList(footprints) {
	if (Array.isArray(footprints)) return footprints;
	if (footprints && typeof footprints === "object") {
		return Object.values(footprints);
	}
	return [];
}

function filterBoardItems(board, selection) {
	const fpList = extractFootprintList(board?.footprints);
	const res = {
		footprints: fpList.filter((f) =>
			isItemSelected(f, selection, "footprints"),
		),
	};
	for (const key of BOARD_KEYS) {
		res[key] = (board?.[key] ?? []).filter((item) =>
			isItemSelected(item, selection, key),
		);
	}
	return res;
}

export function copyBoard(board, selection) {
	const items = filterBoardItems(board, selection);
	const clip = {
		kind: "board",
		origin: computeOrigin(collectAllBoardPoints(items)),
		footprints: structuredClone(items.footprints),
	};
	for (const key of BOARD_KEYS) {
		clip[key] = structuredClone(items[key]);
	}
	return clip;
}

function collectNetsFromItem(item, set) {
	if (item?.netId) set.add(item.netId);
	if (item?.net) set.add(item.net);
}

function addNetEntry(entry, set) {
	if (typeof entry === "string") {
		set.add(entry);
	} else if (entry) {
		if (entry.id) set.add(entry.id);
		if (entry.name) set.add(entry.name);
	}
}

function collectNetsFromList(nets, set) {
	if (!nets) return;
	const items = Array.isArray(nets) ? nets : Array.from(nets.values?.() ?? []);
	for (const item of items) addNetEntry(item, set);
}

function collectBoardNetNames(board) {
	const set = new Set();
	if (!board) return set;
	collectNetsFromList(board.nets, set);
	collectNetsFromList(board.netNames, set);
	if (set.size > 0) return set;
	for (const t of board.tracks ?? []) collectNetsFromItem(t, set);
	for (const v of board.vias ?? []) collectNetsFromItem(v, set);
	return set;
}

function filterNetId(netId, knownNets) {
	if (!netId) return "";
	return knownNets.has(netId) ? netId : "";
}

function shiftPoint(pt, dx, dy) {
	return [pt[0] + dx, pt[1] + dy];
}

function cloneBoardItem(item, prefix, knownNets) {
	const next = structuredClone(item);
	next.uuid = crypto.randomUUID();
	if (next.id) next.id = nextId(prefix);
	if (knownNets) {
		if ("netId" in next) next.netId = filterNetId(next.netId, knownNets);
		if ("net" in next) next.net = filterNetId(next.net, knownNets);
	}
	return next;
}

function translateTrack(track, dx, dy, knownNets) {
	const next = cloneBoardItem(track, "track", knownNets);
	next.start = shiftPoint(next.start, dx, dy);
	next.end = shiftPoint(next.end, dx, dy);
	if (Array.isArray(next.mid)) next.mid = shiftPoint(next.mid, dx, dy);
	return next;
}

function translateVia(via, dx, dy, knownNets) {
	const next = cloneBoardItem(via, "via", knownNets);
	if (Array.isArray(next.at)) next.at = shiftPoint(next.at, dx, dy);
	shiftCoords(next, dx, dy);
	return next;
}

function translateGraphic(gfx, dx, dy) {
	const next = cloneBoardItem(gfx, "gfx");
	shiftCoords(next, dx, dy);
	return next;
}

function translateFootprint(fp, dx, dy, knownNets) {
	const next = cloneBoardItem(fp, "fp", knownNets);
	if (Array.isArray(next.at)) next.at = shiftPoint(next.at, dx, dy);
	if (Array.isArray(next.position))
		next.position = shiftPoint(next.position, dx, dy);
	if (next.placement) shiftCoords(next.placement, dx, dy);
	if (Array.isArray(next.pads)) {
		next.pads = next.pads.map((p) => ({
			...p,
			netId: filterNetId(p.netId, knownNets),
		}));
	}
	return next;
}

function translateZone(zone, dx, dy, knownNets) {
	const next = cloneBoardItem(zone, "zone", knownNets);
	if (Array.isArray(next.polygon)) {
		next.polygon = next.polygon.map((p) => shiftPoint(p, dx, dy));
	}
	return next;
}

function getTargetCoords(at) {
	if (Array.isArray(at)) return [at[0], at[1]];
	return [at?.x ?? 0, at?.y ?? 0];
}

function buildPastedBoardItems(clip, dx, dy, known) {
	return {
		tracks: (clip?.tracks ?? []).map((t) => translateTrack(t, dx, dy, known)),
		vias: (clip?.vias ?? []).map((v) => translateVia(v, dx, dy, known)),
		graphics: (clip?.graphics ?? []).map((g) => translateGraphic(g, dx, dy)),
		footprints: (clip?.footprints ?? []).map((f) =>
			translateFootprint(f, dx, dy, known),
		),
		zones: (clip?.zones ?? []).map((z) => translateZone(z, dx, dy, known)),
	};
}

export function pasteBoard(board, clip, at) {
	const [tx, ty] = getTargetCoords(at);
	const dx = tx - (clip?.origin?.x ?? 0);
	const dy = ty - (clip?.origin?.y ?? 0);
	const known = collectBoardNetNames(board);
	const items = buildPastedBoardItems(clip, dx, dy, known);

	const res = {
		...(board ?? {}),
		footprints: Array.isArray(board?.footprints)
			? [...board.footprints, ...items.footprints]
			: board?.footprints,
	};
	for (const key of BOARD_KEYS) {
		res[key] = [...(board?.[key] ?? []), ...items[key]];
	}
	return res;
}

export function duplicateBoard(board, selection, offset = { x: 1, y: 1 }) {
	const clip = copyBoard(board, selection);
	const at = {
		x: clip.origin.x + (offset?.x ?? 1),
		y: clip.origin.y + (offset?.y ?? 1),
	};
	return pasteBoard(board, clip, at);
}
