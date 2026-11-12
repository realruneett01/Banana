import { irToSpice, parseSiValue } from "./ir-to-spice.js";

function clampTemp(temp) {
	return Math.max(-55, Math.min(150, temp));
}

function resolveAmbientBounds(env) {
	const amb = env?.ambientC;
	if (typeof amb === "number") {
		return { min: amb, max: amb, mid: amb };
	}
	const hasMin = typeof amb?.min === "number";
	const hasMax = typeof amb?.max === "number";
	if (hasMin && hasMax) {
		return { min: amb.min, max: amb.max, mid: (amb.min + amb.max) / 2 };
	}
	const fallback = 25;
	return {
		min: hasMin ? amb.min : fallback,
		max: hasMax ? amb.max : fallback,
		mid: fallback,
	};
}

function createToleranceCorners(bounds, tolPct) {
	if (!(tolPct > 0)) return [];
	const tol = tolPct / 100;
	return [
		{
			id: "worst-low",
			label: "Worst-Low",
			tempC: clampTemp(bounds.max),
			valueScale: 1 - tol,
			supplyScale: 1,
		},
		{
			id: "worst-high",
			label: "Worst-High",
			tempC: clampTemp(bounds.min),
			valueScale: 1 + tol,
			supplyScale: 1,
		},
	];
}

function createSupplyCorners(bounds, supplyPct) {
	if (!(supplyPct > 0)) return [];
	const tol = supplyPct / 100;
	return [
		{
			id: "supply-low",
			label: "Supply-Low",
			tempC: clampTemp(bounds.mid),
			valueScale: 1,
			supplyScale: 1 - tol,
		},
		{
			id: "supply-high",
			label: "Supply-High",
			tempC: clampTemp(bounds.mid),
			valueScale: 1,
			supplyScale: 1 + tol,
		},
	];
}

export function cornersFor(env, { tolerancePct = 5, supplyPct = 0 } = {}) {
	const bounds = resolveAmbientBounds(env);
	const baseCorners = [
		{
			id: "nominal",
			label: "Nominal",
			tempC: clampTemp(bounds.mid),
			valueScale: 1,
			supplyScale: 1,
		},
		{
			id: "cold",
			label: "Cold",
			tempC: clampTemp(bounds.min),
			valueScale: 1,
			supplyScale: 1,
		},
		{
			id: "hot",
			label: "Hot",
			tempC: clampTemp(bounds.max),
			valueScale: 1,
			supplyScale: 1,
		},
	];
	return [
		...baseCorners,
		...createToleranceCorners(bounds, tolerancePct),
		...createSupplyCorners(bounds, supplyPct),
	];
}

function scalePassiveLine(tokens, valueScale) {
	const scale = valueScale ?? 1;
	const val = parseSiValue(tokens[3]);
	if (Number.isNaN(val)) return tokens.join(" ");
	const scaled = val * scale;
	tokens[3] = scaled.toExponential().replace("e+", "e");
	return tokens.join(" ");
}

function scaleDcSource(tokens, scale) {
	const val = parseSiValue(tokens[4]);
	if (!Number.isNaN(val)) {
		tokens[4] = Number((val * scale).toFixed(6)).toString();
	}
	return tokens.join(" ");
}

function scalePlainSource(tokens, scale) {
	const val = parseSiValue(tokens[3]);
	if (!Number.isNaN(val)) {
		tokens[3] = Number((val * scale).toFixed(6)).toString();
	}
	return tokens.join(" ");
}

function scaleVoltageLine(tokens, supplyScale) {
	const scale = supplyScale ?? 1;
	const isExplicitDc = tokens.length >= 5 && tokens[3].toUpperCase() === "DC";
	if (isExplicitDc) {
		return scaleDcSource(tokens, scale);
	}
	if (tokens.length >= 4) {
		return scalePlainSource(tokens, scale);
	}
	return tokens.join(" ");
}

function transformNetlistLine(line, corner) {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith(".")) {
		return line;
	}
	const tokens = trimmed.split(/\s+/);
	const first = tokens[0][0].toUpperCase();
	if (["R", "C", "L"].includes(first) && tokens.length >= 4) {
		return scalePassiveLine(tokens, corner.valueScale);
	}
	if (first === "V") {
		return scaleVoltageLine(tokens, corner.supplyScale);
	}
	return line;
}

function insertTempDirective(lines, tempC) {
	const withoutTemp = lines.filter((line) => !/^\s*\.temp\b/i.test(line));
	const tempLine = `.temp ${Number(tempC.toFixed(4))}`;
	const endIdx = withoutTemp.findIndex((line) => /^\s*\.end\b/i.test(line));
	if (endIdx === -1) {
		return [...withoutTemp, tempLine];
	}
	const result = [...withoutTemp];
	result.splice(endIdx, 0, tempLine);
	return result;
}

export function applyCorner(netlist, corner) {
	const lines = String(netlist || "").split(/\r?\n/);
	const transformed = lines.map((l) => transformNetlistLine(l, corner));
	const finalLines = insertTempDirective(transformed, corner.tempC);
	return finalLines.join("\n");
}

async function executeCornerRun(engine, netlist) {
	try {
		const res = await engine.run(netlist);
		return {
			ok: Boolean(res?.ok),
			plots: res?.plots,
			error: res?.error,
		};
	} catch (err) {
		// Broad catch to protect corner runner from engine crashes
		return {
			ok: false,
			plots: undefined,
			error: err?.message || String(err),
		};
	}
}

export async function runCorners({ ir, env, engine, analysis, options } = {}) {
	const spiceRes = irToSpice(ir, { analysis, ...options });
	if (!spiceRes.ok) {
		return { ok: false, errors: spiceRes.errors };
	}
	const corners = cornersFor(env, options);
	const results = [];
	for (const corner of corners) {
		const cornerNetlist = applyCorner(spiceRes.netlist, corner);
		const outcome = await executeCornerRun(engine, cornerNetlist);
		results.push({ ...corner, ...outcome });
	}
	return { ok: results.every((c) => c.ok), corners: results };
}
