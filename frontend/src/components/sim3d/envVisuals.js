export const MAX_AMPLITUDE_MM = 1.5;

const PRESET_LABELS = Object.freeze({
	automotive: "Inside a car on a hot day: up to 125 C and constant shaking",
	aerospace:
		"High altitude flight: up to 12,000 m, -55 to 125 C with severe vibration",
	industrial: "Factory floor: up to 85 C with continuous machinery vibration",
	outdoor: "Outdoor weather: -30 to 70 C with direct exposure and moisture",
	"data-center":
		"Data center: controlled 18 to 35 C with active forced airflow",
	office: "Office desk: mild indoor conditions at 20-25 C",
});

const DEFAULT_LIGHTING = Object.freeze({
	skyColor: "#0a0c14",
	fogDensity: 0,
	lightColor: "#ffffff",
	lightIntensity: 0.8,
});

const LIGHTING_CONDITIONS = [
	[(m) => m.alt >= 8000, "#050711", 0.001, "#f5f8ff", 1.2],
	[(m) => m.maxT > 60, "#221610", 0.006, "#ffe8d6", 1.1],
	[(m) => m.minT < 0, "#0c1626", 0.005, "#d8eeff", 0.9],
	[(m) => m.maxHum > 80, "#0d181c", 0.008, "#e0f2fe", 0.85],
];

function getAmbient(env) {
	return env?.ambientC ?? env?.env?.ambientC ?? env;
}

function resolveAmbientBound(env, firstKey, secondKey) {
	if (!env) return 25;
	const amb = getAmbient(env);
	if (typeof amb === "number") return amb;
	if (typeof amb?.[firstKey] === "number") return amb[firstKey];
	if (typeof amb?.[secondKey] === "number") return amb[secondKey];
	return 25;
}

export function worstCaseAmbient(env) {
	return resolveAmbientBound(env, "max", "min");
}

function getMinAmbient(env) {
	return resolveAmbientBound(env, "min", "max");
}

function getMaxHumidity(env) {
	if (!env) return 0;
	const hum = env.humidityPct ?? env.env?.humidityPct;
	if (typeof hum === "number") return hum;
	if (typeof hum?.max === "number") return hum.max;
	return 0;
}

function getVibration(env) {
	return env?.vibration ?? env?.env?.vibration ?? null;
}

function getAltitude(env) {
	return env?.altitudeM ?? env?.env?.altitudeM ?? 0;
}

function getAirflow(env) {
	return env?.airflowMs ?? env?.env?.airflowMs ?? 0;
}

function hasShaking(env, vib) {
	if (vib?.psdG2Hz > 0) return true;
	const shock = vib?.shockG ?? env?.shockG ?? 0;
	return shock > 0;
}

function computeShake(vib) {
	if (!vib?.psdG2Hz || vib.psdG2Hz <= 0) {
		return { amplitudeMm: 0, frequencyHz: 0 };
	}
	const psd = Number(vib.psdG2Hz) || 0;
	const fromHz = Number(vib.fromHz) || 10;
	const toHz = Number(vib.toHz) || 1000;
	const bw = Math.max(0, toHz - fromHz);
	const gRms = Math.sqrt(psd * bw);
	const rawAmp = gRms * 0.08;
	const amplitudeMm = Math.min(
		MAX_AMPLITUDE_MM,
		Math.round(rawAmp * 100) / 100,
	);
	const frequencyHz = Math.min(25, Math.max(5, Math.round(fromHz)));
	return { amplitudeMm, frequencyHz };
}

function computeDroplets(maxHum) {
	if (maxHum <= 80) return 0;
	return Math.min(150, Math.round((maxHum - 80) * 5));
}

function resolveLighting(metrics) {
	for (const [
		match,
		skyColor,
		fogDensity,
		lightColor,
		lightIntensity,
	] of LIGHTING_CONDITIONS) {
		if (match(metrics)) {
			return { skyColor, fogDensity, lightColor, lightIntensity };
		}
	}
	return DEFAULT_LIGHTING;
}

function resolvePresetLabel(env) {
	const raw = env?.key ?? env?.name ?? env?.label ?? env?.env?.name ?? "";
	const key = String(raw).toLowerCase().replace(/\s+/g, "-");
	return PRESET_LABELS[key] ?? null;
}

function collectLabelParts(metrics) {
	const parts = [];
	if (metrics.maxT > 60) parts.push(`up to ${metrics.maxT} C`);
	if (metrics.minT < 0) parts.push(`freezing down to ${metrics.minT} C`);
	if (metrics.vib?.psdG2Hz > 0) parts.push("constant shaking");
	if (metrics.maxHum > 80) parts.push("high humidity");
	return parts;
}

function buildCustomLabel(env, metrics) {
	const preset = resolvePresetLabel(env);
	if (preset) return preset;
	const parts = collectLabelParts(metrics);
	const name =
		env?.name ?? env?.label ?? env?.env?.name ?? "Custom environment";
	if (parts.length === 0) return `${name}: benign conditions`;
	return `${name}: ${parts.join(" and ")}`;
}

const BADGE_CHECKS = [
	[(m) => m.maxT > 60, "Very hot"],
	[(m) => m.maxT > 40 && m.maxT <= 60, "Warm"],
	[(m) => m.minT < 0, "Freezing"],
	[(m) => hasShaking(m.env, m.vib), "Shaking"],
	[(m) => m.maxHum > 80, "Humid"],
	[(m) => m.alt >= 5000, "High altitude"],
	[(m) => m.air > 0, "Airflow"],
];

function extractEnvMetrics(env) {
	return {
		env,
		maxT: worstCaseAmbient(env),
		minT: getMinAmbient(env),
		vib: getVibration(env),
		maxHum: getMaxHumidity(env),
		alt: getAltitude(env),
		air: getAirflow(env),
	};
}

export function envBadges(env) {
	if (!env) return [];
	const metrics = extractEnvMetrics(env);
	const badges = [];
	for (const [matches, badge] of BADGE_CHECKS) {
		if (matches(metrics)) {
			badges.push(badge);
		}
	}
	return badges;
}

export function envToVisuals(env) {
	if (!env) {
		return {
			...DEFAULT_LIGHTING,
			shake: { amplitudeMm: 0, frequencyHz: 0 },
			droplets: 0,
			frost: false,
			heatShimmer: false,
			label: "Standard environment: benign conditions",
		};
	}
	const metrics = extractEnvMetrics(env);
	return {
		...resolveLighting(metrics),
		shake: computeShake(metrics.vib),
		droplets: computeDroplets(metrics.maxHum),
		frost: metrics.minT < 0,
		heatShimmer: metrics.maxT > 60,
		label: buildCustomLabel(env, metrics),
	};
}
