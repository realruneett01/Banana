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

function getAmbient(env) {
	return env?.ambientC ?? env?.env?.ambientC ?? env;
}

export function worstCaseAmbient(env) {
	if (!env) return 25;
	const amb = getAmbient(env);
	if (typeof amb === "number") return amb;
	if (typeof amb?.max === "number") return amb.max;
	if (typeof amb?.min === "number") return amb.min;
	return 25;
}

function getMinAmbient(env) {
	if (!env) return 25;
	const amb = getAmbient(env);
	if (typeof amb === "number") return amb;
	if (typeof amb?.min === "number") return amb.min;
	if (typeof amb?.max === "number") return amb.max;
	return 25;
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

function resolveLighting(maxT, minT, alt, maxHum) {
	if (alt >= 8000) {
		return {
			skyColor: "#050711",
			fogDensity: 0.001,
			lightColor: "#f5f8ff",
			lightIntensity: 1.2,
		};
	}
	if (maxT > 60) {
		return {
			skyColor: "#221610",
			fogDensity: 0.006,
			lightColor: "#ffe8d6",
			lightIntensity: 1.1,
		};
	}
	if (minT < 0) {
		return {
			skyColor: "#0c1626",
			fogDensity: 0.005,
			lightColor: "#d8eeff",
			lightIntensity: 0.9,
		};
	}
	if (maxHum > 80) {
		return {
			skyColor: "#0d181c",
			fogDensity: 0.008,
			lightColor: "#e0f2fe",
			lightIntensity: 0.85,
		};
	}
	return {
		skyColor: "#0a0c14",
		fogDensity: 0,
		lightColor: "#ffffff",
		lightIntensity: 0.8,
	};
}

function resolvePresetLabel(env) {
	const raw = env?.key ?? env?.name ?? env?.label ?? env?.env?.name ?? "";
	const key = String(raw).toLowerCase().replace(/\s+/g, "-");
	return PRESET_LABELS[key] ?? null;
}

function buildCustomLabel(env, maxT, minT) {
	const preset = resolvePresetLabel(env);
	if (preset) return preset;
	const parts = [];
	if (maxT > 60) parts.push(`up to ${maxT} C`);
	if (minT < 0) parts.push(`freezing down to ${minT} C`);
	const vib = getVibration(env);
	if (vib?.psdG2Hz > 0) parts.push("constant shaking");
	const hum = getMaxHumidity(env);
	if (hum > 80) parts.push("high humidity");
	const name =
		env?.name ?? env?.label ?? env?.env?.name ?? "Custom environment";
	if (parts.length === 0) return `${name}: benign conditions`;
	return `${name}: ${parts.join(" and ")}`;
}

export function envBadges(env) {
	if (!env) return [];
	const badges = [];
	const maxT = worstCaseAmbient(env);
	const minT = getMinAmbient(env);
	const vib = getVibration(env);
	const maxHum = getMaxHumidity(env);
	const alt = getAltitude(env);
	const air = getAirflow(env);

	if (maxT > 60) badges.push("Very hot");
	else if (maxT > 40) badges.push("Warm");

	if (minT < 0) badges.push("Freezing");
	if (vib?.psdG2Hz > 0 || (vib?.shockG ?? env?.shockG ?? 0) > 0) {
		badges.push("Shaking");
	}
	if (maxHum > 80) badges.push("Humid");
	if (alt >= 5000) badges.push("High altitude");
	if (air > 0) badges.push("Airflow");

	return badges;
}

export function envToVisuals(env) {
	if (!env) {
		return {
			skyColor: "#0a0c14",
			fogDensity: 0,
			lightColor: "#ffffff",
			lightIntensity: 0.8,
			shake: { amplitudeMm: 0, frequencyHz: 0 },
			droplets: 0,
			frost: false,
			heatShimmer: false,
			label: "Standard environment: benign conditions",
		};
	}
	const maxT = worstCaseAmbient(env);
	const minT = getMinAmbient(env);
	const alt = getAltitude(env);
	const maxHum = getMaxHumidity(env);
	const lighting = resolveLighting(maxT, minT, alt, maxHum);
	const vib = getVibration(env);
	return {
		...lighting,
		shake: computeShake(vib),
		droplets: computeDroplets(maxHum),
		frost: minT < 0,
		heatShimmer: maxT > 60,
		label: buildCustomLabel(env, maxT, minT),
	};
}
