const EPSILON = 1e-6;

function getPartSize(part) {
	const size = part.props?.sizeMm;
	if (size && typeof size.w === "number" && typeof size.h === "number") {
		return { w: size.w, h: size.h };
	}
	return { w: 5, h: 5 };
}

function getPartBox(part, placement) {
	const size = getPartSize(part);
	const rot = placement.rot ?? 0;
	const isSwapped = rot === 90 || rot === 270 || rot === -90 || rot === -270;
	const w = isSwapped ? size.h : size.w;
	const h = isSwapped ? size.w : size.h;
	return {
		xMin: placement.x - w / 2,
		xMax: placement.x + w / 2,
		yMin: placement.y - h / 2,
		yMax: placement.y + h / 2,
	};
}

function hasPlacement(part) {
	const p = part.placement;
	return p != null && typeof p.x === "number" && typeof p.y === "number";
}

function compareRefs(refA, refB) {
	if (refA < refB) return -1;
	if (refA > refB) return 1;
	return 0;
}

function buildPartNetsMap(parts, nets) {
	const map = new Map();
	for (const part of parts) {
		map.set(part.id, new Set());
	}
	for (const net of nets) {
		const pins = Array.isArray(net.pins) ? net.pins : [];
		for (const pin of pins) {
			map.get(pin.partId)?.add(net.id);
		}
	}
	return map;
}

function pickBestStarter(remaining, netMap) {
	let bestIndex = 0;
	let bestCount = netMap.get(remaining[0].id)?.size ?? 0;

	for (let i = 1; i < remaining.length; i++) {
		const currPart = remaining[i];
		const currCount = netMap.get(currPart.id)?.size ?? 0;
		const diff = currCount - bestCount;
		const isBetter =
			diff > 0 ||
			(diff === 0 && compareRefs(currPart.ref, remaining[bestIndex].ref) < 0);
		if (isBetter) {
			bestIndex = i;
			bestCount = currCount;
		}
	}
	return remaining.splice(bestIndex, 1)[0];
}

function countSharedNets(netSet, orderedNets) {
	let count = 0;
	if (!netSet) return 0;
	for (const netId of netSet) {
		if (orderedNets.has(netId)) {
			count++;
		}
	}
	return count;
}

function pickNextPart(remaining, netMap, orderedNets) {
	let bestIndex = 0;
	let bestShared = countSharedNets(netMap.get(remaining[0].id), orderedNets);

	for (let i = 1; i < remaining.length; i++) {
		const currPart = remaining[i];
		const currShared = countSharedNets(netMap.get(currPart.id), orderedNets);
		const diff = currShared - bestShared;
		const isBetter =
			diff > 0 ||
			(diff === 0 && compareRefs(currPart.ref, remaining[bestIndex].ref) < 0);
		if (isBetter) {
			bestIndex = i;
			bestShared = currShared;
		}
	}
	return remaining.splice(bestIndex, 1)[0];
}

function orderUnplacedParts(unplaced, nets) {
	if (unplaced.length <= 1) return [...unplaced];
	const netMap = buildPartNetsMap(unplaced, nets);
	const remaining = [...unplaced];
	const first = pickBestStarter(remaining, netMap);
	const ordered = [first];
	const orderedNets = new Set(netMap.get(first.id));

	while (remaining.length > 0) {
		const next = pickNextPart(remaining, netMap, orderedNets);
		ordered.push(next);
		for (const netId of netMap.get(next.id) ?? []) {
			orderedNets.add(netId);
		}
	}
	return ordered;
}

function boxesOverlap(candBox, occBox, clearance) {
	const candXMin = candBox.xMin - clearance;
	const candXMax = candBox.xMax + clearance;
	const candYMin = candBox.yMin - clearance;
	const candYMax = candBox.yMax + clearance;
	const xOverlap =
		candXMin < occBox.xMax - EPSILON && candXMax > occBox.xMin + EPSILON;
	const yOverlap =
		candYMin < occBox.yMax - EPSILON && candYMax > occBox.yMin + EPSILON;
	return xOverlap && yOverlap;
}

function isPositionFree(candBox, occupiedBoxes, clearance) {
	for (const occ of occupiedBoxes) {
		if (boxesOverlap(candBox, occ, clearance)) {
			return false;
		}
	}
	return true;
}

function scanRow(ctx, row) {
	const { part, occupiedBoxes, options, startCol, endCol } = ctx;
	const { boardW, boardH, gridMm, side } = options;
	const size = getPartSize(part);
	const y = Math.round(row * gridMm * 10000) / 10000;
	if (y - size.h / 2 < 0 || y + size.h / 2 > boardH) return null;

	for (let col = startCol; col <= endCol; col++) {
		const x = Math.round(col * gridMm * 10000) / 10000;
		if (x - size.w / 2 < 0 || x + size.w / 2 > boardW) continue;
		const candBox = {
			xMin: x - size.w / 2,
			xMax: x + size.w / 2,
			yMin: y - size.h / 2,
			yMax: y + size.h / 2,
		};
		if (isPositionFree(candBox, occupiedBoxes, gridMm)) {
			return { x, y, rot: 0, side };
		}
	}
	return null;
}

function findGridPosition(part, occupiedBoxes, options) {
	const { boardH, gridMm, marginMm } = options;
	const startRow = Math.ceil(marginMm / gridMm);
	const endRow = Math.floor((boardH - marginMm) / gridMm);
	const startCol = Math.ceil(marginMm / gridMm);
	const endCol = Math.floor((options.boardW - marginMm) / gridMm);
	const ctx = { part, occupiedBoxes, options, startCol, endCol };

	for (let row = startRow; row <= endRow; row++) {
		const pos = scanRow(ctx, row);
		if (pos) return pos;
	}
	return null;
}

function normalizeOptions(options = {}) {
	return {
		boardW: options.boardW,
		boardH: options.boardH,
		gridMm: options.gridMm ?? 2.54,
		marginMm: options.marginMm ?? 2,
		side: options.side ?? "F",
	};
}

function placeParts(ordered, occupiedBoxes, opts) {
	const placed = [];
	for (const part of ordered) {
		const pos = findGridPosition(part, occupiedBoxes, opts);
		if (!pos) {
			throw new Error(`auto-place: board too small for ${part.ref}`);
		}
		part.placement = pos;
		occupiedBoxes.push(getPartBox(part, pos));
		placed.push(part.id);
	}
	return placed;
}

export function autoPlace(ir, options = {}) {
	const opts = normalizeOptions(options);
	const newIr = structuredClone(ir);
	const parts = newIr.parts ?? [];
	const nets = newIr.nets ?? [];

	const occupiedBoxes = [];
	const unplaced = [];
	for (const part of parts) {
		if (hasPlacement(part)) {
			occupiedBoxes.push(getPartBox(part, part.placement));
		} else {
			unplaced.push(part);
		}
	}

	const ordered = orderUnplacedParts(unplaced, nets);
	const placed = placeParts(ordered, occupiedBoxes, opts);
	return { ir: newIr, placed };
}
