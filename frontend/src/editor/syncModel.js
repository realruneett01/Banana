function isFiniteNumber(n) {
	return typeof n === "number" && Number.isFinite(n);
}

function hasUsablePlacement(part) {
	const pl = part?.placement;
	if (!pl) return false;
	return isFiniteNumber(pl.x) && isFiniteNumber(pl.y);
}

function getPointCoords(pt) {
	if (Array.isArray(pt)) {
		return { x: pt[0], y: pt[1] };
	}
	return { x: pt?.x, y: pt?.y };
}

function getOutlineBounds(outline) {
	if (!Array.isArray(outline) || outline.length === 0) {
		return null;
	}
	let maxX = -Infinity;
	let minY = Infinity;
	for (const pt of outline) {
		const { x, y } = getPointCoords(pt);
		if (isFiniteNumber(x)) maxX = Math.max(maxX, x);
		if (isFiniteNumber(y)) minY = Math.min(minY, y);
	}
	if (!Number.isFinite(maxX) || !Number.isFinite(minY)) {
		return null;
	}
	return { maxX, minY };
}

function isSlotOccupied(parts, x, y) {
	return parts.some((p) => {
		const pl = p.placement;
		if (!hasUsablePlacement(p)) return false;
		return pl.x === x && pl.y === y;
	});
}

function findNextFreeSlot(parts, startX, startY, spacing) {
	let y = startY;
	while (isSlotOccupied(parts, startX, y)) {
		y += spacing;
	}
	return { x: startX, y };
}

function placeUnplacedParts(parts, bounds, spacing) {
	const startX = bounds ? bounds.maxX + spacing : 0;
	const startY = bounds ? bounds.minY : 0;
	const allPlaced = parts.filter(hasUsablePlacement);
	const resultParts = [];
	const placedIds = [];

	for (const part of parts) {
		if (hasUsablePlacement(part)) {
			resultParts.push(part);
			continue;
		}
		const slot = findNextFreeSlot(allPlaced, startX, startY, spacing);
		const newPart = {
			...part,
			placement: { x: slot.x, y: slot.y, rot: 0, side: "F" },
		};
		allPlaced.push(newPart);
		resultParts.push(newPart);
		placedIds.push(part.id);
	}

	return { parts: resultParts, placedIds };
}

function findOrphanIndices(items, validNetIds) {
	if (!Array.isArray(items)) return [];
	const orphans = [];
	for (let i = 0; i < items.length; i++) {
		const netId = items[i]?.netId;
		if (!netId || !validNetIds.has(netId)) {
			orphans.push(i);
		}
	}
	return orphans;
}

function findBoardOrphans(board, validNetIds) {
	return {
		tracks: findOrphanIndices(board?.tracks, validNetIds),
		vias: findOrphanIndices(board?.vias, validNetIds),
		zones: findOrphanIndices(board?.zones, validNetIds),
	};
}

function formatItemSummary(count, singular, plural) {
	if (count === 0) return null;
	const noun = count === 1 ? singular : plural;
	const verb = count === 1 ? "belongs" : "belong";
	return `${count} ${noun} no longer ${verb} to any connection`;
}

function buildSyncSummary(placedCount, orphans) {
	const clauses = [];
	if (placedCount > 0) {
		const noun = placedCount === 1 ? "part" : "parts";
		clauses.push(`${placedCount} new ${noun} placed next to the board`);
	}
	const tMsg = formatItemSummary(orphans.tracks.length, "track", "tracks");
	const vMsg = formatItemSummary(orphans.vias.length, "via", "vias");
	const zMsg = formatItemSummary(orphans.zones.length, "zone", "zones");
	if (tMsg) clauses.push(tMsg);
	if (vMsg) clauses.push(vMsg);
	if (zMsg) clauses.push(zMsg);

	if (clauses.length === 0) {
		return { inSync: true, summary: "Board already matches the schematic" };
	}
	return { inSync: false, summary: clauses.join(", ") };
}

function cloneBoard(board) {
	return {
		...(board ?? {}),
		outline: board?.outline ?? null,
		tracks: Array.isArray(board?.tracks) ? [...board.tracks] : [],
		vias: Array.isArray(board?.vias) ? [...board.vias] : [],
		zones: Array.isArray(board?.zones) ? [...board.zones] : [],
	};
}

function cloneIr(ir, nextParts) {
	return {
		...(ir ?? {}),
		parts: nextParts,
		nets: Array.isArray(ir?.nets) ? [...ir.nets] : [],
	};
}

export function syncBoardFromIr(ir, board, options = {}) {
	const spacing =
		isFiniteNumber(options?.spacing) && options.spacing > 0
			? options.spacing
			: 10;
	const bounds = getOutlineBounds(board?.outline);
	const rawParts = Array.isArray(ir?.parts) ? ir.parts : [];
	const { parts: nextParts, placedIds } = placeUnplacedParts(
		rawParts,
		bounds,
		spacing,
	);

	const validNetIds = new Set(
		(ir?.nets ?? []).map((n) => n?.id).filter(Boolean),
	);
	const orphans = findBoardOrphans(board, validNetIds);
	const status = buildSyncSummary(placedIds.length, orphans);

	return {
		ir: cloneIr(ir, nextParts),
		board: cloneBoard(board),
		report: {
			inSync: status.inSync,
			summary: status.summary,
			placed: placedIds,
			orphanTracks: orphans.tracks,
			orphanVias: orphans.vias,
			orphanZones: orphans.zones,
		},
	};
}

export function removeOrphans(board, report) {
	const orphanTracks = new Set(report?.orphanTracks ?? []);
	const orphanVias = new Set(report?.orphanVias ?? []);
	const orphanZones = new Set(report?.orphanZones ?? []);

	const tracks = (board?.tracks ?? []).filter((_, i) => !orphanTracks.has(i));
	const vias = (board?.vias ?? []).filter((_, i) => !orphanVias.has(i));
	const zones = (board?.zones ?? []).filter((_, i) => !orphanZones.has(i));

	return {
		...(board ?? {}),
		tracks,
		vias,
		zones,
	};
}
