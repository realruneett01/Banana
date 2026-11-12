export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 200;

export const GRID_PRESETS = Object.freeze({
	schematic: [0.635, 1.27, 2.54],
	pcb: [0.1, 0.25, 0.5, 1, 1.27, 2.54],
});

export function screenToWorld(pt, view) {
	return {
		x: (pt.x - view.pan.x) / view.zoom,
		y: (pt.y - view.pan.y) / view.zoom,
	};
}

export function worldToScreen(pt, view) {
	return {
		x: pt.x * view.zoom + view.pan.x,
		y: pt.y * view.zoom + view.pan.y,
	};
}

export function zoomAt(view, screenPt, factor) {
	const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom * factor));
	const wx = (screenPt.x - view.pan.x) / view.zoom;
	const wy = (screenPt.y - view.pan.y) / view.zoom;
	return {
		pan: {
			x: screenPt.x - wx * nextZoom,
			y: screenPt.y - wy * nextZoom,
		},
		zoom: nextZoom,
	};
}

export function panBy(view, dx, dy) {
	return {
		pan: {
			x: view.pan.x + dx,
			y: view.pan.y + dy,
		},
		zoom: view.zoom,
	};
}

function computeFitScale(bw, bh, size, margin) {
	const availW = size.width * (1 - 2 * margin);
	const availH = size.height * (1 - 2 * margin);
	if (bw <= 0) return availH / bh;
	if (bh <= 0) return availW / bw;
	return Math.min(availW / bw, availH / bh);
}

export function fitToBounds(bounds, size, margin = 0.05) {
	if (!bounds) {
		return { pan: { x: size.width / 2, y: size.height / 2 }, zoom: 4 };
	}
	const bw = bounds.maxX - bounds.minX;
	const bh = bounds.maxY - bounds.minY;
	if (bw <= 0 && bh <= 0) {
		return { pan: { x: size.width / 2, y: size.height / 2 }, zoom: 4 };
	}
	const scale = computeFitScale(bw, bh, size, margin);
	const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
	const cx = (bounds.minX + bounds.maxX) / 2;
	const cy = (bounds.minY + bounds.maxY) / 2;
	return {
		pan: {
			x: size.width / 2 - cx * zoom,
			y: size.height / 2 - cy * zoom,
		},
		zoom,
	};
}

export function snap(value, grid) {
	if (grid <= 0) {
		return Object.is(value, -0) ? 0 : value;
	}
	const snapped = Math.round(value / grid) * grid;
	const cleaned = Math.round(snapped * 1e6) / 1e6;
	return cleaned === 0 ? 0 : cleaned;
}

export function snapPoint(pt, grid) {
	return {
		x: snap(pt.x, grid),
		y: snap(pt.y, grid),
	};
}

export function formatCoord(mm, units) {
	const val = mm === 0 ? 0 : mm;
	if (units === "in") {
		return (val / 25.4).toFixed(4);
	}
	if (units === "mil") {
		return (val / 0.0254).toFixed(1);
	}
	return val.toFixed(4);
}

export function bboxOfPoints(points) {
	if (!Array.isArray(points) || points.length === 0) {
		return null;
	}
	const xs = points.map((p) => (Array.isArray(p) ? p[0] : p.x));
	const ys = points.map((p) => (Array.isArray(p) ? p[1] : p.y));
	return {
		minX: Math.min(...xs),
		minY: Math.min(...ys),
		maxX: Math.max(...xs),
		maxY: Math.max(...ys),
	};
}
