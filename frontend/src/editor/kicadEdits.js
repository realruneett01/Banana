import { diffIr } from "../irDiff.js";
import { graphicsEdits } from "./boardGraphics.js";
import { buildAllPinPos } from "./schematicGeometry.js";

// Patch ops beyond setValue/move run after them, in this stage order, so
// in-place ops see the original refs and later ops see the renamed ones.
const STAGES = ["delete", "rename", "add", "field", "net", "track"];

const SUMMARY_WORDS = [
	["value", "value"],
	["position", "position"],
	["added", "added part"],
	["removed", "removed part"],
	["field", "field"],
	["connection", "connection"],
	["track", "track"],
	["via", "via"],
	["annotation", "annotation"],
];

function isFiniteCoord(coord) {
	return typeof coord === "number" && Number.isFinite(coord);
}

function isValidPlacement(placement) {
	if (!placement) return false;
	if (!isFiniteCoord(placement.x)) return false;
	if (!isFiniteCoord(placement.y)) return false;
	if (placement.rot !== undefined && !isFiniteCoord(placement.rot)) {
		return false;
	}
	return true;
}

function listOf(value) {
	return Array.isArray(value) ? value : [];
}

function createContext(afterIr) {
	const parts = listOf(afterIr?.parts);
	const nets = listOf(afterIr?.nets);
	return {
		legacy: { sch: [], pcb: [] },
		staged: [],
		unsupported: [],
		counts: {},
		parts: new Map(parts.map((p) => [p.id, p])),
		nets,
		pinPos: buildAllPinPos(parts, nets),
		removedIds: new Set(),
	};
}

function stage(ctx, name, kind, edit) {
	ctx.staged.push({ rank: STAGES.indexOf(name), kind, edit });
}

function count(ctx, key) {
	ctx.counts[key] = (ctx.counts[key] ?? 0) + 1;
}

function placementOf(part) {
	const { x, y, rot } = part.placement;
	return { x, y, rot: rot ?? 0 };
}

function addFootprintOp(part, ctx) {
	if (!part.footprint) return;
	stage(ctx, "add", "pcb", {
		op: "addFootprint",
		ref: part.ref,
		libId: part.footprint,
		value: part.value ?? "",
		...placementOf(part),
		side: part.placement.side ?? "F",
	});
}

function addPart(part, ctx) {
	const ref = part.ref ?? part.id;
	if (!part.symbol) {
		ctx.unsupported.push(`${ref} has no library symbol`);
		return;
	}
	if (!isValidPlacement(part.placement)) {
		ctx.unsupported.push(`${ref} has non-finite coordinates`);
		return;
	}
	count(ctx, "added");
	stage(ctx, "add", "sch", {
		op: "addSymbol",
		ref,
		libId: part.symbol,
		value: part.value ?? "",
		footprint: part.footprint ?? "",
		...placementOf(part),
	});
	addFootprintOp(part, ctx);
}

function removePart(part, ctx) {
	const ref = part.ref ?? part.id;
	ctx.removedIds.add(part.id);
	count(ctx, "removed");
	stage(ctx, "delete", "sch", { op: "deleteSymbol", ref });
	if (part.footprint) {
		stage(ctx, "delete", "pcb", { op: "deleteFootprint", ref });
	}
}

function processPlacementChange(change, ref, pcbEdits, unsupported) {
	const before = change.before || {};
	const after = change.after || {};
	if (!isValidPlacement(after)) {
		unsupported.push(`${ref} has non-finite coordinates`);
		return;
	}
	const move = { op: "move", ref, x: after.x, y: after.y, rot: after.rot ?? 0 };
	// The in-place patcher flips the footprint as pcbnew does.
	if (before.side !== after.side) move.side = after.side === "B" ? "B" : "F";
	pcbEdits.push(move);
}

function mapValue(part, change, ctx) {
	const edit = { op: "setValue", ref: part.oldRef, value: change.after };
	ctx.legacy.sch.push(edit);
	ctx.legacy.pcb.push({ ...edit });
}

function mapPlacement(part, change, ctx) {
	processPlacementChange(change, part.oldRef, ctx.legacy.pcb, ctx.unsupported);
}

function mapRename(part, change, ctx) {
	const edit = { ref: change.before, name: "Reference", value: change.after };
	count(ctx, "field");
	stage(ctx, "rename", "sch", { op: "setField", ...edit });
	if (part.oldFootprint) {
		stage(ctx, "rename", "pcb", { op: "setFootprintField", ...edit });
	}
}

function padNetsOf(partId, nets) {
	return nets.flatMap((net) =>
		listOf(net.pins)
			.filter((pin) => pin.partId === partId)
			.map((pin) => ({ net: net.name ?? net.id, pin: pin.pin })),
	);
}

function stagePadNet(ctx, ref, net, pin) {
	stage(ctx, "net", "pcb", { op: "setPadNet", ref, pad: String(pin), net });
}

function mapFootprint(part, change, ctx) {
	const { after, newRef } = part;
	count(ctx, "field");
	stage(ctx, "field", "sch", {
		op: "setField",
		ref: newRef,
		name: "Footprint",
		value: change.after ?? "",
	});
	if (change.before) {
		stage(ctx, "add", "pcb", { op: "deleteFootprint", ref: newRef });
	}
	if (!change.after) return;
	if (!isValidPlacement(after.placement)) {
		ctx.unsupported.push(`${newRef} has non-finite coordinates`);
		return;
	}
	addFootprintOp(after, ctx);
	for (const { net, pin } of padNetsOf(after.id, ctx.nets)) {
		stagePadNet(ctx, newRef, net, pin);
	}
}

function isText(value) {
	return typeof value === "string" || isFiniteCoord(value);
}

function mapProp(part, key, change, ctx) {
	const oldVal = change.before?.[key];
	const newVal = change.after?.[key];
	if (JSON.stringify(oldVal) === JSON.stringify(newVal)) return;
	if (!isText(newVal)) {
		ctx.unsupported.push(`${part.newRef} changed field ${key}`);
		return;
	}
	const edit = { ref: part.newRef, name: key, value: String(newVal) };
	count(ctx, "field");
	stage(ctx, "field", "sch", { op: "setField", ...edit });
	if (part.after.footprint) {
		stage(ctx, "field", "pcb", { op: "setFootprintField", ...edit });
	}
}

function mapProps(part, change, ctx) {
	const keys = new Set([
		...Object.keys(change.before ?? {}),
		...Object.keys(change.after ?? {}),
	]);
	for (const key of keys) {
		mapProp(part, key, change, ctx);
	}
}

const FIELD_HANDLERS = {
	value: mapValue,
	placement: mapPlacement,
	ref: mapRename,
	footprint: mapFootprint,
	props: mapProps,
};

function describeChangedPart(change, ctx) {
	const fields = listOf(change.fields);
	const after = ctx.parts.get(change.id) ?? {};
	const refChange = fields.find((f) => f.field === "ref");
	const fpChange = fields.find((f) => f.field === "footprint");
	return {
		after,
		newRef: change.ref ?? change.id,
		oldRef: refChange ? refChange.before : (change.ref ?? change.id),
		oldFootprint: fpChange ? fpChange.before : after.footprint,
	};
}

function processChangedPart(change, ctx) {
	const part = describeChangedPart(change, ctx);
	for (const fieldChange of listOf(change.fields)) {
		const handler = FIELD_HANDLERS[fieldChange.field];
		if (handler) {
			handler(part, fieldChange, ctx);
		} else {
			ctx.unsupported.push(`${part.newRef} changed ${fieldChange.field}`);
		}
	}
}

function connectPin(netName, pinRef, ctx) {
	const part = ctx.parts.get(pinRef.partId);
	const pos = ctx.pinPos.get(`${pinRef.partId}:${pinRef.pin}`);
	if (!part || !pos) {
		ctx.unsupported.push(`connection ${netName} uses an unknown part`);
		return;
	}
	count(ctx, "connection");
	stage(ctx, "net", "sch", {
		op: "addLabel",
		net: netName,
		x: pos[0],
		y: pos[1],
	});
	if (part.footprint) stagePadNet(ctx, part.ref, netName, pinRef.pin);
}

function connectPins(netName, pins, ctx) {
	for (const pinRef of listOf(pins)) {
		connectPin(netName, pinRef, ctx);
	}
}

function keepsPins(pins, ctx) {
	return listOf(pins).some((pin) => !ctx.removedIds.has(pin.partId));
}

function processChangedNet(net, ctx) {
	const name = net.name ?? net.id;
	if (net.renamedFrom !== undefined) {
		ctx.unsupported.push(
			`connection ${net.renamedFrom} was renamed to ${name}`,
		);
	}
	if (keepsPins(net.removedPins, ctx)) {
		ctx.unsupported.push(`connection ${name} lost a pin`);
	}
	connectPins(name, net.addedPins, ctx);
}

function processNets(nets, ctx) {
	for (const net of nets.added) {
		connectPins(net.name ?? net.id, net.pins, ctx);
	}
	for (const net of nets.changed) {
		processChangedNet(net, ctx);
	}
	for (const net of nets.removed) {
		if (keepsPins(net.pins, ctx)) {
			ctx.unsupported.push(`connection ${net.name ?? net.id} removed`);
		}
	}
}

function toPoint(p) {
	if (Array.isArray(p)) return { x: p[0], y: p[1] };
	return { x: p?.x, y: p?.y };
}

function trackPoints(track) {
	const points = listOf(track.points);
	return (points.length >= 2 ? points : [track.start, track.end]).map(toPoint);
}

function netNameOf(netId, ctx) {
	return ctx.nets.find((n) => n.id === netId)?.name ?? 0;
}

function addTrackOp(track, ctx) {
	count(ctx, "track");
	stage(ctx, "track", "pcb", {
		op: "addTrack",
		layer: track.layer ?? "F.Cu",
		width: track.widthMm ?? track.width ?? 0.25,
		points: trackPoints(track),
		net: netNameOf(track.netId, ctx),
	});
}

function addViaOp(via, ctx) {
	const { x, y } = toPoint(via.at);
	count(ctx, "via");
	stage(ctx, "track", "pcb", {
		op: "addVia",
		x,
		y,
		size: via.sizeMm,
		drill: via.drillMm,
		net: netNameOf(via.netId, ctx),
	});
}

// deleteTrack removes any segment, arc or via by its uuid.
function removeByUuid(item, kind, where, ctx) {
	if (!item.uuid) {
		ctx.unsupported.push(`a ${kind}${where} was removed`);
		return;
	}
	count(ctx, kind);
	stage(ctx, "delete", "pcb", { op: "deleteTrack", uuid: item.uuid });
}

function removeTrackOp(track, ctx) {
	removeByUuid(track, "track", ` on ${track.layer ?? "F.Cu"}`, ctx);
}

function removeViaOp(via, ctx) {
	removeByUuid(via, "via", "", ctx);
}

function missingFrom(tracks, others) {
	const keys = new Set(others.map((t) => JSON.stringify(t)));
	return tracks.filter((t) => !keys.has(JSON.stringify(t)));
}

function processBoardItems(boards, key, [addOp, removeOp], ctx) {
	const before = listOf(boards?.before?.[key]);
	const after = listOf(boards?.after?.[key]);
	for (const item of missingFrom(after, before)) addOp(item, ctx);
	for (const item of missingFrom(before, after)) removeOp(item, ctx);
}

function processTracks(boards, ctx) {
	processBoardItems(boards, "tracks", [addTrackOp, removeTrackOp], ctx);
	processBoardItems(boards, "vias", [addViaOp, removeViaOp], ctx);
}

function stageGraphicOp(ctx, op) {
	const stageName = op.op === "deleteGraphic" ? "delete" : "track";
	stage(ctx, stageName, "pcb", op);
}

function processGraphics(boards, ctx) {
	for (const op of graphicsEdits(boards?.before, boards?.after)) {
		stageGraphicOp(ctx, op);
	}
}

function compareEdits(a, b) {
	const refCmp = String(a.ref ?? "").localeCompare(String(b.ref ?? ""));
	if (refCmp !== 0) return refCmp;
	return String(a.op ?? "").localeCompare(String(b.op ?? ""));
}

function orderedEdits(ctx, kind) {
	const staged = ctx.staged
		.filter((item) => item.kind === kind)
		.sort((a, b) => a.rank - b.rank)
		.map((item) => item.edit);
	return [...[...ctx.legacy[kind]].sort(compareEdits), ...staged];
}

function formatPlural(n, singular, plural = `${singular}s`) {
	return `${n} ${n === 1 ? singular : plural}`;
}

function joinClauses(clauses) {
	if (clauses.length < 2) return clauses.join("");
	return `${clauses.slice(0, -1).join(", ")} and ${clauses.at(-1)}`;
}

function buildSummary(canSaveInPlace, counts) {
	if (!canSaveInPlace) {
		return "Nothing to save";
	}
	const clauses = SUMMARY_WORDS.filter(([key]) => counts[key] > 0).map(
		([key, word]) => formatPlural(counts[key], word),
	);
	if (clauses.length === 0) return "Edits will be saved";
	return `${joinClauses(clauses)} will be saved`;
}

const ANNOTATION_MAP = {
	label: { op: "addLabel", kind: "local", net: true, rot: true },
	globalLabel: { op: "addLabel", kind: "global", net: true, rot: true },
	hierLabel: { op: "addLabel", kind: "hierarchical", net: true, rot: true },
	noConnect: { op: "addNoConnect" },
	junction: { op: "addJunction" },
	text: { op: "addText", text: true, rot: true },
	line: { op: "addLine", segment: true },
	bus: { op: "addBus", segment: true },
};

export function annotationToOp(ann) {
	const spec = ANNOTATION_MAP[ann.kind];
	if (!spec) return null;
	if (spec.segment) {
		return { op: spec.op, x1: ann.x, y1: ann.y, x2: ann.x2, y2: ann.y2 };
	}
	const edit = { op: spec.op };
	if (spec.net) edit.net = ann.text;
	if (spec.text) edit.text = ann.text;
	edit.x = ann.x;
	edit.y = ann.y;
	if (spec.rot && ann.rot !== undefined) edit.rot = ann.rot;
	if (spec.kind) edit.kind = spec.kind;
	return edit;
}

const MOVED_FIELDS = ["x", "y", "x2", "y2", "rot", "text"];

function isMoved(prev, curr) {
	return MOVED_FIELDS.some((k) => prev[k] !== curr[k]);
}

function processAnnotationItem(ann, prev, ctx) {
	if (!prev) {
		count(ctx, "annotation");
		stage(ctx, "add", "sch", annotationToOp(ann));
		return;
	}
	const uuid = ann.uuid ?? prev.uuid;
	if (isMoved(prev, ann) && uuid) {
		count(ctx, "annotation");
		stage(ctx, "delete", "sch", { op: "deleteItem", uuid });
		stage(ctx, "add", "sch", annotationToOp(ann));
	}
}

function processRemovedAnnotation(ann, afterMap, ctx) {
	if (!afterMap.has(ann.id) && ann.uuid) {
		count(ctx, "annotation");
		stage(ctx, "delete", "sch", { op: "deleteItem", uuid: ann.uuid });
	}
}

function processAnnotations(beforeIr, afterIr, ctx) {
	const beforeList = listOf(beforeIr?.annotations);
	const afterList = listOf(afterIr?.annotations);
	const beforeMap = new Map(beforeList.map((a) => [a.id, a]));
	const afterMap = new Map(afterList.map((a) => [a.id, a]));
	for (const ann of afterList) {
		processAnnotationItem(ann, beforeMap.get(ann.id), ctx);
	}
	for (const ann of beforeList) {
		processRemovedAnnotation(ann, afterMap, ctx);
	}
}

function collectEdits(diff, boards, ctx) {
	for (const part of diff.parts.removed) removePart(part, ctx);
	for (const part of diff.parts.added) addPart(part, ctx);
	for (const part of diff.parts.changed) processChangedPart(part, ctx);
	processNets(diff.nets, ctx);
	processTracks(boards, ctx);
	processGraphics(boards, ctx);
	ctx.counts.value = ctx.legacy.sch.length;
	ctx.counts.position = ctx.legacy.pcb.filter((e) => e.op === "move").length;
}

/**
 * Maps editor model changes onto KiCad patch ops for the backend patch
 * pipeline. `boards` ({ before, after }) is optional and adds track,
 * via, and board graphics edits.
 * Library sources are resolved server-side from each op's libId.
 */
export function editsFromIrChange(before, after, boards) {
	const ctx = createContext(after);
	collectEdits(diffIr(before, after), boards, ctx);
	processAnnotations(before, after, ctx);
	const sch = orderedEdits(ctx, "sch");
	const pcb = orderedEdits(ctx, "pcb");
	const hasEdits = sch.length > 0 || pcb.length > 0;
	const canSaveInPlace = ctx.unsupported.length === 0 && hasEdits;
	const summary = buildSummary(canSaveInPlace, ctx.counts);
	return { sch, pcb, unsupported: ctx.unsupported, canSaveInPlace, summary };
}
