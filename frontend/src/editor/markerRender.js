const DEFAULT_RADIUS = 1.2;
const DEFAULT_STROKE = 0.3;
// Screen pixels when options.zoom is given: markers keep one size at any zoom.
const SCREEN_RADIUS_PX = 5;
const SCREEN_STROKE_PX = 1.5;

const SEVERITY_COLORS = Object.freeze({
	error: "red",
	warning: "orange",
});

function resolveColor(severity) {
	if (typeof severity !== "string") {
		return "blue";
	}
	return SEVERITY_COLORS[severity.toLowerCase()] ?? "blue";
}

function toFiniteNumber(val) {
	if (typeof val === "number" && Number.isFinite(val)) {
		return val;
	}
	if (typeof val === "string" && val.trim() !== "") {
		const num = Number(val);
		return Number.isFinite(num) ? num : null;
	}
	return null;
}

function coordsFromArray(arr) {
	if (!Array.isArray(arr) || arr.length < 2) {
		return null;
	}
	const x = toFiniteNumber(arr[0]);
	const y = toFiniteNumber(arr[1]);
	if (x === null || y === null) {
		return null;
	}
	return { x, y };
}

function coordsFromObject(obj) {
	if (!obj || typeof obj !== "object") {
		return null;
	}
	const x = toFiniteNumber(obj.x);
	const y = toFiniteNumber(obj.y);
	if (x === null || y === null) {
		return null;
	}
	return { x, y };
}

function extractCoords(marker) {
	if (!marker || typeof marker !== "object") {
		return null;
	}
	const pos = marker.position ?? marker.at;
	const fromArray = coordsFromArray(pos);
	if (fromArray) return fromArray;
	const fromObj = coordsFromObject(pos);
	if (fromObj) return fromObj;
	return coordsFromObject(marker);
}

function screenZoom(options) {
	const zoom = options?.zoom;
	return Number.isFinite(zoom) && zoom > 0 ? zoom : null;
}

function resolveSize(options) {
	if (typeof options === "number" && Number.isFinite(options)) {
		return { r: options, strokeWidth: DEFAULT_STROKE };
	}
	if (options && Number.isFinite(options.radius)) {
		return { r: options.radius, strokeWidth: DEFAULT_STROKE };
	}
	const zoom = screenZoom(options);
	if (!zoom) return { r: DEFAULT_RADIUS, strokeWidth: DEFAULT_STROKE };
	return { r: SCREEN_RADIUS_PX / zoom, strokeWidth: SCREEN_STROKE_PX / zoom };
}

function resolveTitle(marker) {
	const raw = marker.message ?? marker.title ?? marker.text;
	if (raw == null) {
		return "";
	}
	return String(raw);
}

function resolveBaseKey(marker, index, coords) {
	if (marker.key != null) return String(marker.key);
	if (marker.id != null) return String(marker.id);
	if (marker.issueId != null) return `${marker.issueId}_${index}`;
	return `marker_${index}_${coords.x}_${coords.y}`;
}

function makeUniqueKey(baseKey, index, seen) {
	let key = baseKey;
	if (seen.has(key)) {
		key = `${baseKey}_${index}`;
	}
	seen.add(key);
	return key;
}

export function markerGlyphs(markers, options) {
	if (!Array.isArray(markers)) {
		return [];
	}
	const size = resolveSize(options);
	const seen = new Set();
	const glyphs = [];

	for (let i = 0; i < markers.length; i++) {
		const m = markers[i];
		const coords = extractCoords(m);
		if (!coords) continue;

		const baseKey = resolveBaseKey(m, i, coords);
		const key = makeUniqueKey(baseKey, i, seen);
		glyphs.push({
			key,
			x: coords.x,
			y: coords.y,
			...size,
			color: resolveColor(m?.severity),
			title: resolveTitle(m),
		});
	}

	return glyphs;
}
