/**
 * Pure geometry and selection helpers for board preview.
 */

function toRect(part) {
	if (!part?.placement) return null;
	const { x, y, rot = 0, side = "F" } = part.placement;
	if (typeof x !== "number" || typeof y !== "number") return null;
	const w = part.props?.sizeMm?.w ?? 5;
	const h = part.props?.sizeMm?.h ?? 5;
	return { id: part.id, ref: part.ref, x, y, w, h, rot, side };
}

export function partRects(ir) {
	if (!ir?.parts || !Array.isArray(ir.parts)) return [];
	const rects = [];
	for (const part of ir.parts) {
		const rect = toRect(part);
		if (rect) rects.push(rect);
	}
	return rects;
}

function netPartCentres(net, partMap) {
	const seen = new Set();
	const centres = [];
	for (const pin of net.pins ?? []) {
		if (!pin.partId || seen.has(pin.partId)) continue;
		seen.add(pin.partId);
		const part = partMap.get(pin.partId);
		const pl = part?.placement;
		if (typeof pl?.x !== "number" || typeof pl?.y !== "number") continue;
		centres.push({ x: pl.x, y: pl.y });
	}
	return centres.sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
}

function chainCentres(net, centres) {
	const links = [];
	for (let i = 0; i < centres.length - 1; i++) {
		links.push({
			netId: net.id,
			name: net.name,
			from: centres[i],
			to: centres[i + 1],
		});
	}
	return links;
}

export function ratsnest(ir) {
	if (!ir?.nets || !Array.isArray(ir.nets)) return [];
	const partMap = new Map((ir.parts ?? []).map((p) => [p.id, p]));
	const links = [];
	for (const net of ir.nets) {
		const centres = netPartCentres(net, partMap);
		links.push(...chainCentres(net, centres));
	}
	return links;
}

function rectBounds(rect) {
	const rad = ((rect.rot || 0) * Math.PI) / 180;
	const cos = Math.abs(Math.cos(rad));
	const sin = Math.abs(Math.sin(rad));
	const halfW = ((rect.w ?? 5) * cos + (rect.h ?? 5) * sin) / 2;
	const halfH = ((rect.w ?? 5) * sin + (rect.h ?? 5) * cos) / 2;
	return {
		minX: rect.x - halfW,
		maxX: rect.x + halfW,
		minY: rect.y - halfH,
		maxY: rect.y + halfH,
	};
}

export function viewBoxFor(rects, { boardW, boardH, padMm = 2 } = {}) {
	let minX = typeof boardW === "number" ? 0 : Infinity;
	let maxX = typeof boardW === "number" ? boardW : -Infinity;
	let minY = typeof boardH === "number" ? 0 : Infinity;
	let maxY = typeof boardH === "number" ? boardH : -Infinity;

	for (const r of rects ?? []) {
		const b = rectBounds(r);
		minX = Math.min(minX, b.minX);
		maxX = Math.max(maxX, b.maxX);
		minY = Math.min(minY, b.minY);
		maxY = Math.max(maxY, b.maxY);
	}
	if (!Number.isFinite(minX)) return "0 0 100 100";
	const pad = Math.max(0, padMm);
	const width = maxX - minX + 2 * pad;
	const height = maxY - minY + 2 * pad;
	return `${minX - pad} ${minY - pad} ${width} ${height}`;
}

export function highlightSet(ir, selectedId) {
	if (!selectedId) return new Set();
	const isPart = ir?.parts?.some((p) => p.id === selectedId);
	if (isPart) return new Set([selectedId]);
	const net = ir?.nets?.find((n) => n.id === selectedId);
	if (net) {
		const partIds = (net.pins ?? []).map((p) => p.partId).filter(Boolean);
		return new Set(partIds);
	}
	return new Set();
}
