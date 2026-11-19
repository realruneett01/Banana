const COMPARED_PART_FIELDS = [
	"ref",
	"value",
	"footprint",
	"placement",
	"props",
];

const FIELD_LABELS = {
	ref: "ref",
	value: "value",
	footprint: "footprint",
	placement: "placement",
	props: "prop",
};

function isObject(val) {
	return Boolean(val && typeof val === "object");
}

function deepEqualArrays(a, b) {
	return a.length === b.length && a.every((val, i) => deepEqual(val, b[i]));
}

function deepEqualObjects(a, b) {
	const keysA = Object.keys(a);
	if (keysA.length !== Object.keys(b).length) return false;
	return keysA.every(
		(key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]),
	);
}

function deepEqual(a, b) {
	if (Object.is(a, b)) return true;
	if (!isObject(a) || !isObject(b)) return false;
	const isArrA = Array.isArray(a);
	if (isArrA !== Array.isArray(b)) return false;
	return isArrA ? deepEqualArrays(a, b) : deepEqualObjects(a, b);
}

function getDesignArrays(design) {
	if (!isObject(design)) {
		return { parts: [], nets: [] };
	}
	return {
		parts: Array.isArray(design.parts) ? design.parts : [],
		nets: Array.isArray(design.nets) ? design.nets : [],
	};
}

function sortEntities(items, keyProp) {
	return [...items].sort((a, b) => {
		const cmp = String(a[keyProp] ?? "").localeCompare(
			String(b[keyProp] ?? ""),
		);
		if (cmp !== 0) return cmp;
		return String(a.id ?? "").localeCompare(String(b.id ?? ""));
	});
}

function findPartFieldChanges(beforePart, afterPart) {
	const changes = [];
	for (const field of COMPARED_PART_FIELDS) {
		const before = beforePart[field];
		const after = afterPart[field];
		if (!deepEqual(before, after)) {
			changes.push({ field, before, after });
		}
	}
	return changes;
}

function diffPartItem(beforePart, afterPart) {
	const fields = findPartFieldChanges(beforePart, afterPart);
	if (fields.length === 0) return null;
	return { id: afterPart.id, ref: afterPart.ref ?? beforePart.ref, fields };
}

function diffEntities(beforeItems, afterItems, diffItem, keyProp) {
	const beforeMap = new Map(beforeItems.map((item) => [item.id, item]));
	const afterMap = new Map(afterItems.map((item) => [item.id, item]));
	const added = [];
	const changed = [];
	for (const item of afterItems) {
		const beforeItem = beforeMap.get(item.id);
		if (!beforeItem) {
			added.push(item);
		} else {
			const diff = diffItem(beforeItem, item);
			if (diff) changed.push(diff);
		}
	}
	const removed = beforeItems.filter((item) => !afterMap.has(item.id));
	return {
		added: sortEntities(added, keyProp),
		removed: sortEntities(removed, keyProp),
		changed: sortEntities(changed, keyProp),
	};
}

function diffParts(beforeParts, afterParts) {
	return diffEntities(beforeParts, afterParts, diffPartItem, "ref");
}

function pinKey(pin) {
	return `${pin?.partId ?? ""}:${pin?.pin ?? ""}`;
}

function sortPins(pins) {
	return [...pins].sort((a, b) => pinKey(a).localeCompare(pinKey(b)));
}

function filterMissingPins(pins, existingKeys) {
	return sortPins(pins.filter((p) => !existingKeys.has(pinKey(p))));
}

function diffNetPins(beforePins = [], afterPins = []) {
	const beforeKeys = new Set(beforePins.map(pinKey));
	const afterKeys = new Set(afterPins.map(pinKey));
	return {
		addedPins: filterMissingPins(afterPins, beforeKeys),
		removedPins: filterMissingPins(beforePins, afterKeys),
	};
}

function diffNetItem(beforeNet, afterNet) {
	const { addedPins, removedPins } = diffNetPins(beforeNet.pins, afterNet.pins);
	const isRenamed = beforeNet.name !== afterNet.name;
	const hasPinChanges = addedPins.length > 0 || removedPins.length > 0;
	if (!isRenamed && !hasPinChanges) {
		return null;
	}
	const changed = {
		id: afterNet.id,
		name: afterNet.name,
		addedPins,
		removedPins,
	};
	if (isRenamed) {
		changed.renamedFrom = beforeNet.name;
	}
	return changed;
}

function diffNets(beforeNets, afterNets) {
	return diffEntities(beforeNets, afterNets, diffNetItem, "name");
}

function pluralize(count, singular, plural = `${singular}s`) {
	return `${count} ${count === 1 ? singular : plural}`;
}

function clause(count, noun, action) {
	return count > 0 ? `${pluralize(count, noun)} ${action}` : null;
}

function collectEntityClauses(group, noun) {
	return [
		clause(group?.added?.length, noun, "added"),
		clause(group?.removed?.length, noun, "removed"),
	].filter(Boolean);
}

function countPartFieldChanges(changedParts) {
	const counts = {};
	for (const part of changedParts) {
		for (const change of part.fields || []) {
			counts[change.field] = (counts[change.field] || 0) + 1;
		}
	}
	return counts;
}

function collectPartFieldClauses(changedParts) {
	const counts = countPartFieldChanges(changedParts || []);
	return COMPARED_PART_FIELDS.map((field) =>
		clause(counts[field], FIELD_LABELS[field] || field, "changed"),
	).filter(Boolean);
}

function collectPartClauses(parts) {
	return [
		...collectEntityClauses(parts, "part"),
		...collectPartFieldClauses(parts?.changed),
	];
}

function countNetPins(changedNets, pinProp) {
	return changedNets.reduce((sum, n) => sum + (n[pinProp]?.length || 0), 0);
}

function collectNetChangeClauses(changed = []) {
	const renamedCount = changed.filter((n) => Boolean(n.renamedFrom)).length;
	return [
		clause(renamedCount, "net", "renamed"),
		clause(countNetPins(changed, "addedPins"), "connection", "added"),
		clause(countNetPins(changed, "removedPins"), "connection", "removed"),
	].filter(Boolean);
}

function collectNetClauses(nets) {
	return [
		...collectEntityClauses(nets, "net"),
		...collectNetChangeClauses(nets?.changed),
	];
}

function hasAnyItems(...lists) {
	return lists.some((list) => Array.isArray(list) && list.length > 0);
}

export function summarizeIrDiff(diff) {
	if (!isObject(diff)) return "No changes";
	const clauses = [
		...collectPartClauses(diff.parts),
		...collectNetClauses(diff.nets),
	];
	if (clauses.length === 0) return "No changes";
	return clauses.join(", ");
}

export function diffIr(before, after) {
	const cleanBefore = getDesignArrays(before);
	const cleanAfter = getDesignArrays(after);
	const parts = diffParts(cleanBefore.parts, cleanAfter.parts);
	const nets = diffNets(cleanBefore.nets, cleanAfter.nets);
	const summary = summarizeIrDiff({ parts, nets });
	const isEmpty = !hasAnyItems(
		parts.added,
		parts.removed,
		parts.changed,
		nets.added,
		nets.removed,
		nets.changed,
	);
	return { parts, nets, summary, isEmpty };
}
