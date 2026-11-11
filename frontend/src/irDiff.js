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
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (!deepEqual(a[i], b[i])) return false;
	}
	return true;
}

function deepEqualObjects(a, b) {
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	for (const key of keysA) {
		if (!Object.hasOwn(b, key)) return false;
		if (!deepEqual(a[key], b[key])) return false;
	}
	return true;
}

function deepEqual(a, b) {
	if (Object.is(a, b)) return true;
	if (!isObject(a) || !isObject(b)) return false;
	const isArrA = Array.isArray(a);
	const isArrB = Array.isArray(b);
	if (isArrA !== isArrB) return false;
	if (isArrA) return deepEqualArrays(a, b);
	return deepEqualObjects(a, b);
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

function compareByRefThenId(a, b) {
	const cmp = String(a.ref ?? "").localeCompare(String(b.ref ?? ""));
	if (cmp !== 0) return cmp;
	return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

function sortByRef(items) {
	return [...items].sort(compareByRefThenId);
}

function compareByNameThenId(a, b) {
	const cmp = String(a.name ?? "").localeCompare(String(b.name ?? ""));
	if (cmp !== 0) return cmp;
	return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

function sortByName(items) {
	return [...items].sort(compareByNameThenId);
}

function findPartFieldChanges(beforePart, afterPart) {
	const changes = [];
	for (const field of COMPARED_PART_FIELDS) {
		const beforeVal = beforePart[field];
		const afterVal = afterPart[field];
		if (!deepEqual(beforeVal, afterVal)) {
			changes.push({ field, before: beforeVal, after: afterVal });
		}
	}
	return changes;
}

function diffParts(beforeParts, afterParts) {
	const beforeMap = new Map(beforeParts.map((p) => [p.id, p]));
	const afterMap = new Map(afterParts.map((p) => [p.id, p]));
	const added = [];
	const changed = [];
	for (const part of afterParts) {
		const beforePart = beforeMap.get(part.id);
		if (!beforePart) {
			added.push(part);
			continue;
		}
		const fields = findPartFieldChanges(beforePart, part);
		if (fields.length > 0) {
			changed.push({ id: part.id, ref: part.ref ?? beforePart.ref, fields });
		}
	}
	const removed = beforeParts.filter((p) => !afterMap.has(p.id));
	return {
		added: sortByRef(added),
		removed: sortByRef(removed),
		changed: sortByRef(changed),
	};
}

function pinKey(pin) {
	return `${pin?.partId ?? ""}:${pin?.pin ?? ""}`;
}

function sortPins(pins) {
	return [...pins].sort((a, b) => pinKey(a).localeCompare(pinKey(b)));
}

function diffNetPins(beforePins = [], afterPins = []) {
	const beforeKeys = new Set(beforePins.map(pinKey));
	const afterKeys = new Set(afterPins.map(pinKey));
	const addedPins = afterPins.filter((p) => !beforeKeys.has(pinKey(p)));
	const removedPins = beforePins.filter((p) => !afterKeys.has(pinKey(p)));
	return {
		addedPins: sortPins(addedPins),
		removedPins: sortPins(removedPins),
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
	const beforeMap = new Map(beforeNets.map((n) => [n.id, n]));
	const afterMap = new Map(afterNets.map((n) => [n.id, n]));
	const added = [];
	const changed = [];
	for (const net of afterNets) {
		const beforeNet = beforeMap.get(net.id);
		if (!beforeNet) {
			added.push(net);
			continue;
		}
		const diff = diffNetItem(beforeNet, net);
		if (diff) changed.push(diff);
	}
	const removed = beforeNets.filter((n) => !afterMap.has(n.id));
	return {
		added: sortByName(added),
		removed: sortByName(removed),
		changed: sortByName(changed),
	};
}

function pluralize(count, singular, plural = `${singular}s`) {
	return `${count} ${count === 1 ? singular : plural}`;
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

function collectPartClauses(parts) {
	const clauses = [];
	const addedCount = parts?.added?.length || 0;
	if (addedCount > 0) clauses.push(`${pluralize(addedCount, "part")} added`);
	const removedCount = parts?.removed?.length || 0;
	if (removedCount > 0)
		clauses.push(`${pluralize(removedCount, "part")} removed`);
	const counts = countPartFieldChanges(parts?.changed || []);
	for (const field of COMPARED_PART_FIELDS) {
		const count = counts[field] || 0;
		if (count > 0) {
			const label = FIELD_LABELS[field] || field;
			clauses.push(`${pluralize(count, label)} changed`);
		}
	}
	return clauses;
}

function countNetPins(changedNets, pinProp) {
	return changedNets.reduce((sum, n) => sum + (n[pinProp]?.length || 0), 0);
}

function collectNetClauses(nets) {
	const clauses = [];
	const addedCount = nets?.added?.length || 0;
	if (addedCount > 0) clauses.push(`${pluralize(addedCount, "net")} added`);
	const removedCount = nets?.removed?.length || 0;
	if (removedCount > 0)
		clauses.push(`${pluralize(removedCount, "net")} removed`);
	const changed = nets?.changed || [];
	const renamedCount = changed.filter((n) => Boolean(n.renamedFrom)).length;
	if (renamedCount > 0)
		clauses.push(`${pluralize(renamedCount, "net")} renamed`);
	const pinsAdded = countNetPins(changed, "addedPins");
	if (pinsAdded > 0)
		clauses.push(`${pluralize(pinsAdded, "connection")} added`);
	const pinsRemoved = countNetPins(changed, "removedPins");
	if (pinsRemoved > 0)
		clauses.push(`${pluralize(pinsRemoved, "connection")} removed`);
	return clauses;
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
