export const VALID_FIELDS = new Set([
	"ref",
	"value",
	"footprint",
	"symbol",
	"datasheet",
]);

export function sortRefs(refs) {
	if (!Array.isArray(refs)) return [];
	return [...refs].sort((a, b) =>
		String(a).localeCompare(String(b), undefined, { numeric: true }),
	);
}

export function getDatasheetValue(part) {
	if (!part) return "";
	return part.datasheet ?? part.props?.Datasheet ?? part.props?.datasheet ?? "";
}

export function getCustomProps(part) {
	const custom = {};
	if (!part?.props || typeof part.props !== "object") return custom;
	for (const [key, value] of Object.entries(part.props)) {
		if (key.toLowerCase() !== "datasheet") {
			custom[key] = value;
		}
	}
	return custom;
}

function resolveGroupBy(groupBy) {
	if (groupBy === false) return [];
	if (groupBy === true) return ["value", "footprint"];
	if (Array.isArray(groupBy)) return groupBy;
	return ["value", "footprint"];
}

function buildSingleRow(part) {
	const ref = part.ref ?? "";
	return {
		key: part.id || ref || "part",
		refs: ref ? [ref] : [],
		value: part.value ?? "",
		footprint: part.footprint ?? "",
		datasheet: getDatasheetValue(part),
		custom: getCustomProps(part),
		qty: 1,
		partIds: [part.id],
	};
}

function computeGroupKey(part, groupFields) {
	return groupFields.map((field) => String(part[field] ?? "")).join("::");
}

function collectGroups(parts, groupFields) {
	const map = new Map();
	for (const part of parts) {
		const key = computeGroupKey(part, groupFields);
		const list = map.get(key);
		if (list) {
			list.push(part);
		} else {
			map.set(key, [part]);
		}
	}
	return map;
}

function buildGroupRow(groupParts) {
	const first = groupParts[0];
	const refs = sortRefs(groupParts.map((p) => p.ref).filter(Boolean));
	return {
		key: refs.join(",") || first.id,
		refs,
		value: first.value ?? "",
		footprint: first.footprint ?? "",
		datasheet: getDatasheetValue(first),
		custom: getCustomProps(first),
		qty: groupParts.length,
		partIds: groupParts.map((p) => p.id),
	};
}

function sortRowList(rows) {
	return [...rows].sort((a, b) => {
		const refA = a.refs?.[0] ?? a.key ?? "";
		const refB = b.refs?.[0] ?? b.key ?? "";
		return String(refA).localeCompare(String(refB), undefined, {
			numeric: true,
		});
	});
}

export function buildRows(ir, options = {}) {
	const parts = Array.isArray(ir?.parts) ? ir.parts : [];
	const groupFields = resolveGroupBy(options.groupBy);
	if (groupFields.length === 0) {
		return sortRowList(parts.map(buildSingleRow));
	}
	const groupMap = collectGroups(parts, groupFields);
	const rows = Array.from(groupMap.values()).map(buildGroupRow);
	return sortRowList(rows);
}

function buildPartLookups(parts) {
	const byId = new Map();
	const byRef = new Map();
	for (const p of parts) {
		if (p.id) byId.set(p.id, p);
		if (p.ref) byRef.set(p.ref, p);
	}
	return { byId, byRef };
}

function resolvePartsByKey(key, lookups) {
	if (lookups.byId.has(key)) {
		return [lookups.byId.get(key)];
	}
	if (lookups.byRef.has(key)) {
		return [lookups.byRef.get(key)];
	}
	if (key.includes(",")) {
		const refs = key.split(",").map((s) => s.trim());
		return refs.map((r) => lookups.byRef.get(r)).filter(Boolean);
	}
	return [];
}

function findPartsByDirectRef(edit, lookups) {
	if (edit.partId) {
		const p = lookups.byId.get(edit.partId);
		return p ? [p] : [];
	}
	if (edit.ref) {
		const p = lookups.byRef.get(edit.ref);
		return p ? [p] : [];
	}
	return null;
}

function findPartsByArrayRefs(edit, lookups) {
	if (Array.isArray(edit.partIds)) {
		return edit.partIds.map((id) => lookups.byId.get(id)).filter(Boolean);
	}
	if (Array.isArray(edit.refs)) {
		return edit.refs.map((r) => lookups.byRef.get(r)).filter(Boolean);
	}
	return null;
}

function findPartsForEdit(edit, lookups) {
	const direct = findPartsByDirectRef(edit, lookups);
	if (direct) return direct;
	const byArray = findPartsByArrayRefs(edit, lookups);
	if (byArray) return byArray;
	const key = edit.key ?? edit.rowKey;
	if (typeof key === "string" && key) {
		return resolvePartsByKey(key, lookups);
	}
	return [];
}

function flattenObjectEntry([key, val]) {
	if (!val || typeof val !== "object") return [];
	return Object.entries(val).map(([field, value]) => ({ key, field, value }));
}

function normalizeObjectEdits(edits) {
	return Object.entries(edits).flatMap(flattenObjectEntry);
}

function normalizeEditItems(edits) {
	if (!edits) return [];
	if (Array.isArray(edits)) return edits;
	if (typeof edits === "object") return normalizeObjectEdits(edits);
	return [];
}

function extractFieldUpdates(item) {
	if (item.field !== undefined) {
		return [{ field: item.field, value: item.value }];
	}
	const updates = [];
	for (const [k, v] of Object.entries(item)) {
		if (VALID_FIELDS.has(k)) {
			updates.push({ field: k, value: v });
		}
	}
	return updates;
}

function getCurrentFieldValue(part, field) {
	if (field === "datasheet") {
		return getDatasheetValue(part);
	}
	return part[field] ?? "";
}

function isFieldValueEqual(current, next) {
	const curStr =
		current === undefined || current === null ? "" : String(current);
	const nextStr = next === undefined || next === null ? "" : String(next);
	return curStr === nextStr;
}

function applyPartFieldChange(part, field, value, changes) {
	const current = getCurrentFieldValue(part, field);
	const changeKey = `${part.id}::${field}`;
	if (isFieldValueEqual(current, value)) {
		changes.delete(changeKey);
	} else {
		changes.set(changeKey, {
			type: "setPartField",
			partId: part.id,
			field,
			value: String(value ?? ""),
		});
	}
}

function applyPartUpdates(part, updates, changes) {
	for (const { field, value } of updates) {
		if (VALID_FIELDS.has(field)) {
			applyPartFieldChange(part, field, value, changes);
		}
	}
}

function applyItemChanges(item, lookups, changes) {
	const targetParts = findPartsForEdit(item, lookups);
	const updates = extractFieldUpdates(item);
	for (const part of targetParts) {
		applyPartUpdates(part, updates, changes);
	}
}

export function editsToCommand(ir, edits) {
	const parts = Array.isArray(ir?.parts) ? ir.parts : [];
	const lookups = buildPartLookups(parts);
	const items = normalizeEditItems(edits);
	const changes = new Map();

	for (const item of items) {
		applyItemChanges(item, lookups, changes);
	}

	return {
		type: "batch",
		commands: Array.from(changes.values()),
	};
}
