export function refPrefix(ref) {
	if (typeof ref !== "string") return "X";
	const match = ref.match(/^([A-Za-z_#]+)/);
	return match ? match[1] : "X";
}

export function refNumber(ref) {
	if (typeof ref !== "string") return null;
	const match = ref.match(/(\d+)$/);
	return match ? Number.parseInt(match[1], 10) : null;
}

export function findDuplicateRefs(ir) {
	const counts = new Map();
	for (const part of ir?.parts || []) {
		const ref = part?.ref;
		if (typeof ref === "string" && ref.length > 0) {
			counts.set(ref, (counts.get(ref) || 0) + 1);
		}
	}
	const duplicates = [];
	for (const [ref, count] of counts) {
		if (count > 1) {
			duplicates.push(ref);
		}
	}
	return duplicates;
}

function compareCandidatesX(a, b) {
	const ax = a.part.placement?.x ?? 0;
	const bx = b.part.placement?.x ?? 0;
	if (ax !== bx) return ax - bx;
	const ay = a.part.placement?.y ?? 0;
	const by = b.part.placement?.y ?? 0;
	if (ay !== by) return ay - by;
	return a.index - b.index;
}

function compareCandidatesY(a, b) {
	const ay = a.part.placement?.y ?? 0;
	const by = b.part.placement?.y ?? 0;
	if (ay !== by) return ay - by;
	const ax = a.part.placement?.x ?? 0;
	const bx = b.part.placement?.x ?? 0;
	if (ax !== bx) return ax - bx;
	return a.index - b.index;
}

function allocateNumber(prefix, usedMap, start) {
	let set = usedMap.get(prefix);
	if (!set) {
		set = new Set();
		usedMap.set(prefix, set);
	}
	let num = start;
	while (set.has(num)) {
		num++;
	}
	set.add(num);
	return num;
}

function buildUsedMap(parts, mode) {
	const usedMap = new Map();
	if (mode !== "keep") return usedMap;
	for (const part of parts) {
		const num = refNumber(part?.ref);
		if (num === null) continue;
		const prefix = refPrefix(part.ref);
		if (!usedMap.has(prefix)) {
			usedMap.set(prefix, new Set());
		}
		usedMap.get(prefix).add(num);
	}
	return usedMap;
}

function collectCandidates(parts, mode) {
	const candidates = [];
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		const isNumbered = refNumber(part?.ref) !== null;
		if (mode === "keep" && isNumbered) continue;
		candidates.push({ part, index });
	}
	return candidates;
}

function applyAnnotations(candidates, usedMap, start, newParts) {
	const changes = [];
	for (const { part, index } of candidates) {
		const prefix = refPrefix(part?.ref);
		const num = allocateNumber(prefix, usedMap, start);
		const newRef = `${prefix}${num}`;
		newParts[index].ref = newRef;
		if (part?.ref !== newRef) {
			changes.push({ id: part?.id, from: part?.ref, to: newRef });
		}
	}
	return changes;
}

export function annotate(ir, { mode = "keep", order = "x", start = 1 } = {}) {
	const parts = ir?.parts || [];
	const newParts = parts.map((p) => ({ ...p }));
	const usedMap = buildUsedMap(parts, mode);
	const candidates = collectCandidates(parts, mode);
	const comparator = order === "y" ? compareCandidatesY : compareCandidatesX;
	candidates.sort(comparator);
	const changes = applyAnnotations(candidates, usedMap, start, newParts);
	return {
		ir: { ...ir, parts: newParts },
		changes,
	};
}
