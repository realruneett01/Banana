import { temperatureColor } from "./flowModel.js";

const DEFAULT_LABELS = Object.freeze([
	"cool",
	"warm",
	"hot",
	"hot - avoid touching",
	"too hot - parts may fail",
]);

function resolveAmbient(ambientC) {
	if (typeof ambientC === "number") return ambientC;
	if (typeof ambientC?.max === "number") return ambientC.max;
	return 25;
}

function resolveThetaJA(part, thetaJA) {
	if (typeof thetaJA === "number") return thetaJA;
	if (part?.footprint && thetaJA?.[part.footprint] !== undefined) {
		return thetaJA[part.footprint];
	}
	if (typeof part?.props?.thetaJA === "number") {
		return part.props.thetaJA;
	}
	return thetaJA?.default ?? 150;
}

function computePartTemp(part, power, thetaJA, ambient) {
	const theta = resolveThetaJA(part, thetaJA);
	const raw = ambient + power * theta;
	return Math.round(raw * 10) / 10;
}

export function partTemperatures(options = {}) {
	const { ir, partPowers = {}, ambientC, thetaJA = { default: 150 } } = options;
	const ambient = resolveAmbient(ambientC);
	const parts = Array.isArray(ir?.parts)
		? ir.parts
		: Array.isArray(ir)
			? ir
			: [];
	const partMap = new Map();
	for (const p of parts) {
		if (p?.id) partMap.set(p.id, p);
	}
	const allIds = new Set([...partMap.keys(), ...Object.keys(partPowers || {})]);
	const result = {};
	for (const id of allIds) {
		const part = partMap.get(id);
		const power = Number(partPowers?.[id] ?? part?.props?.powerW ?? 0);
		result[id] = computePartTemp(part, power, thetaJA, ambient);
	}
	return result;
}

function calcPlacementHeat(cx, cy, p, ambient) {
	const tempC = Number(p.tempC ?? p.temp ?? ambient);
	const delta = tempC - ambient;
	if (delta <= 0) return ambient;
	const radius = Math.max(0.5, Number(p.radiusMm ?? p.radius ?? 5));
	const distSq = (cx - p.x) ** 2 + (cy - p.y) ** 2;
	const falloff = Math.exp(-distSq / (2 * radius * radius));
	return ambient + delta * falloff;
}

function evaluateCell(cx, cy, placements, ambient) {
	let maxVal = ambient;
	for (const p of placements) {
		const heat = calcPlacementHeat(cx, cy, p, ambient);
		if (heat > maxVal) maxVal = heat;
	}
	return maxVal;
}

function buildGridValues(cols, rows, cell, places, ambient) {
	const values = new Float32Array(cols * rows);
	for (let r = 0; r < rows; r++) {
		const cy = (r + 0.5) * cell;
		for (let c = 0; c < cols; c++) {
			values[r * cols + c] = evaluateCell(
				(c + 0.5) * cell,
				cy,
				places,
				ambient,
			);
		}
	}
	return values;
}

export function heatGrid(options = {}) {
	const ambient = resolveAmbient(options.ambientC);
	const cell = Math.max(0.1, Number(options.cellMm) || 1);
	const boardW = Math.max(1, Number(options.boardW) || 100);
	const boardH = Math.max(1, Number(options.boardH) || 100);
	const cols = Math.max(1, Math.ceil(boardW / cell));
	const rows = Math.max(1, Math.ceil(boardH / cell));
	const places = Array.isArray(options.placements) ? options.placements : [];
	const values = buildGridValues(cols, rows, cell, places, ambient);

	return {
		cols,
		rows,
		values,
		boardW,
		boardH,
		cellMm: cell,
		placements: places,
	};
}

export function legendStops(minC = 25, maxC = 105) {
	const min =
		typeof minC === "object" ? (minC?.minC ?? 25) : Number(minC) || 25;
	const rawMax =
		typeof minC === "object" ? (minC?.maxC ?? 105) : Number(maxC) || 105;
	const max = rawMax <= min ? min + 80 : rawMax;
	const stops = [];
	for (let i = 0; i < 5; i++) {
		const t = min + (i / 4) * (max - min);
		const tempC = Math.round(t);
		stops.push({
			tempC,
			label: DEFAULT_LABELS[i],
			color: temperatureColor(tempC),
		});
	}
	return stops;
}

function findHottestPart(temps) {
	if (!temps) return null;
	const entries = Array.isArray(temps)
		? temps.map((p) => [p.id ?? p.partId, p.tempC ?? p.temp])
		: Object.entries(temps);
	let hottest = null;
	let maxT = -Infinity;
	for (const [id, val] of entries) {
		const t = Number(val?.tempC ?? val?.temp ?? val);
		if (Number.isFinite(t) && t > maxT) {
			maxT = t;
			hottest = { id, tempC: t };
		}
	}
	return hottest;
}

function formatHeatSentence(partId, tempC, rating) {
	const rounded = Math.round(tempC);
	if (typeof rating === "number" && tempC > rating) {
		return `${partId} is the hottest part at ${rounded} C, exceeding its limit of ${rating} C.`;
	}
	if (tempC >= 85) {
		return `${partId} is the hottest part at ${rounded} C (too hot - parts may fail).`;
	}
	if (tempC >= 60) {
		return `${partId} is the hottest part at ${rounded} C (hot - avoid touching).`;
	}
	if (tempC > 40) {
		return `${partId} is the hottest part at ${rounded} C (warm).`;
	}
	return `${partId} is the hottest part at ${rounded} C (cool).`;
}

export function plainHeatSummary(temps, ratings) {
	const hottest = findHottestPart(temps);
	if (!hottest) {
		return "All parts are running cool at safe ambient temperatures.";
	}
	const r = ratings?.[hottest.id];
	const rating = typeof r === "number" ? r : (r?.maxC ?? r?.tjMaxC);
	return formatHeatSentence(hottest.id, hottest.tempC, rating);
}
