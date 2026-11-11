import { diffIr } from "../irDiff.js";

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

function processPlacementChange(change, ref, pcbEdits, unsupported) {
	const before = change.before || {};
	const after = change.after || {};
	if (before.side !== after.side) {
		unsupported.push(`${ref} moved to the other side of the board`);
		return;
	}
	if (!isValidPlacement(after)) {
		unsupported.push(`${ref} has non-finite coordinates`);
		return;
	}
	pcbEdits.push({
		op: "move",
		ref,
		x: after.x,
		y: after.y,
		rot: after.rot ?? 0,
	});
}

function processFieldChange(partRef, fieldChange, edits, unsupported) {
	const { field, before, after } = fieldChange;
	if (field === "value") {
		edits.sch.push({ op: "setValue", ref: partRef, value: after });
		edits.pcb.push({ op: "setValue", ref: partRef, value: after });
		return;
	}
	if (field === "placement") {
		processPlacementChange(fieldChange, partRef, edits.pcb, unsupported);
		return;
	}
	if (field === "ref") {
		unsupported.push(`${before} was renamed to ${after}`);
		return;
	}
	if (field === "footprint") {
		unsupported.push(`${partRef} changed footprint`);
		return;
	}
	unsupported.push(`${partRef} changed ${field}`);
}

function processChangedParts(changedParts, edits, unsupported) {
	for (const part of changedParts) {
		const ref = part.ref ?? part.id;
		for (const change of part.fields ?? []) {
			processFieldChange(ref, change, edits, unsupported);
		}
	}
}

function processPartList(parts, suffix, unsupported) {
	for (const part of parts) {
		const label = part.ref ?? part.id;
		unsupported.push(`${label} ${suffix}`);
	}
}

function processNetList(nets, action, unsupported) {
	for (const net of nets) {
		const name = net.name ?? net.id;
		unsupported.push(`connection ${name} ${action}`);
	}
}

function compareEdits(a, b) {
	const refCmp = String(a.ref ?? "").localeCompare(String(b.ref ?? ""));
	if (refCmp !== 0) return refCmp;
	return String(a.op ?? "").localeCompare(String(b.op ?? ""));
}

function sortEdits(edits) {
	return [...edits].sort(compareEdits);
}

function formatPlural(count, singular, plural = `${singular}s`) {
	return `${count} ${count === 1 ? singular : plural}`;
}

function buildSummary(canSaveInPlace, valueCount, posCount) {
	if (!canSaveInPlace) {
		return "Nothing to save";
	}
	const clauses = [];
	if (valueCount > 0) {
		clauses.push(formatPlural(valueCount, "value"));
	}
	if (posCount > 0) {
		clauses.push(formatPlural(posCount, "position"));
	}
	return `${clauses.join(" and ")} will be saved`;
}

export function editsFromIrChange(before, after) {
	const diff = diffIr(before, after);
	const edits = { sch: [], pcb: [] };
	const unsupported = [];

	processPartList(diff.parts.added, "was added", unsupported);
	processPartList(diff.parts.removed, "was removed", unsupported);
	processChangedParts(diff.parts.changed, edits, unsupported);
	processNetList(diff.nets.added, "added", unsupported);
	processNetList(diff.nets.removed, "removed", unsupported);
	processNetList(diff.nets.changed, "changed", unsupported);

	const sch = sortEdits(edits.sch);
	const pcb = sortEdits(edits.pcb);
	const hasEdits = sch.length > 0 || pcb.length > 0;
	const canSaveInPlace = unsupported.length === 0 && hasEdits;
	const posCount = pcb.filter((e) => e.op === "move").length;
	const summary = buildSummary(canSaveInPlace, sch.length, posCount);

	return { sch, pcb, unsupported, canSaveInPlace, summary };
}
