const PRESET_SPECS = [
	[
		"office",
		"Office",
		"Consumer indoor 0-40 C, 10-80 %RH, 0 m",
		[0, 40],
		[10, 80],
		0,
	],
	[
		"automotive",
		"Automotive",
		"AEC-Q100 grade 1: -40 to 125 C, 5-95 %RH, vibration 0.04 g2/Hz 10-2000 Hz, shock 50 g",
		[-40, 125],
		[5, 95],
		0,
		{ vibration: { psdG2Hz: 0.04, fromHz: 10, toHz: 2000 }, shockG: 50 },
	],
	[
		"industrial",
		"Industrial",
		"-40 to 85 C, 5-95 %RH, vibration 0.01 g2/Hz 10-500 Hz",
		[-40, 85],
		[5, 95],
		0,
		{ vibration: { psdG2Hz: 0.01, fromHz: 10, toHz: 500 } },
	],
	[
		"outdoor",
		"Outdoor",
		"-30 to 70 C, 0-100 %RH, 2000 m",
		[-30, 70],
		[0, 100],
		2000,
	],
	[
		"aerospace",
		"Aerospace",
		"-55 to 125 C, 0-100 %RH, 12000 m, vibration 0.1 g2/Hz 20-2000 Hz, shock 100 g",
		[-55, 125],
		[0, 100],
		12000,
		{ vibration: { psdG2Hz: 0.1, fromHz: 20, toHz: 2000 }, shockG: 100 },
	],
	[
		"data-center",
		"Data Center",
		"18-35 C, 20-80 %RH, airflow 2 m/s",
		[18, 35],
		[20, 80],
		0,
		{ airflowMs: 2 },
	],
];

function buildPreset([
	key,
	label,
	description,
	[tMin, tMax],
	[hMin, hMax],
	altitudeM,
	extras = {},
]) {
	return {
		key,
		label,
		description,
		env: {
			name: label,
			ambientC: { min: tMin, max: tMax },
			humidityPct: { min: hMin, max: hMax },
			altitudeM,
			...extras,
		},
	};
}

export const ENV_PRESETS = PRESET_SPECS.map(buildPreset);

export function withNewId(env, idFn) {
	const newId = typeof idFn === "function" ? idFn() : idFn;
	return {
		...env,
		id: newId,
	};
}

function isNumber(val) {
	return typeof val === "number" && !Number.isNaN(val);
}

function isWithin100(val) {
	return val >= 0 && val <= 100;
}

function isNonEmptyString(val) {
	if (typeof val !== "string") {
		return false;
	}
	return val.trim().length > 0;
}

function isPresent(val) {
	if (val === undefined || val === null) {
		return false;
	}
	return val !== "";
}

function checkOrder({ low, high, mainKey, highKey, mainMsg, highMsg }, errors) {
	if (!isNumber(low) || !isNumber(high)) {
		return;
	}
	if (low > high) {
		errors[mainKey] = mainMsg;
		errors[highKey] = highMsg;
	}
}

function checkRange(range, label, errKey, errors) {
	checkOrder(
		{
			low: range?.min,
			high: range?.max,
			mainKey: errKey,
			highKey: `${errKey}.max`,
			mainMsg: `${label} min must be <= max`,
			highMsg: `${label} max must be >= min`,
		},
		errors,
	);
}

function validateBound(val, boundKey, config, errors) {
	const prop = `${config.prefix}.${boundKey}`;
	const boundLabel = boundKey === "min" ? "Min" : "Max";
	if (!isNumber(val)) {
		errors[prop] = `${boundLabel} ${config.name} is required`;
		return;
	}
	if (config.isPercent && !isWithin100(val)) {
		errors[prop] = `${boundLabel} ${config.name} must be between 0 and 100%`;
	}
}

function validateRange(range, config, errors) {
	if (!range || typeof range !== "object") {
		errors[`${config.prefix}.min`] = `Min ${config.name} is required`;
		errors[`${config.prefix}.max`] = `Max ${config.name} is required`;
		return;
	}
	validateBound(range.min, "min", config, errors);
	validateBound(range.max, "max", config, errors);
	checkRange(range, config.label, config.prefix, errors);
}

const AMBIENT_CONFIG = {
	prefix: "ambientC",
	name: "ambient temperature",
	label: "Ambient",
};

const HUMIDITY_CONFIG = {
	prefix: "humidityPct",
	name: "humidity",
	label: "Humidity",
	isPercent: true,
};

function validateBasicFields(draft, errors) {
	if (!isNonEmptyString(draft.name)) {
		errors.name = "Name is required";
	}
	if (!isNumber(draft.altitudeM)) {
		errors.altitudeM = "Altitude is required";
	}
}

function hasVibrationData(vibration) {
	if (!vibration || typeof vibration !== "object") {
		return false;
	}
	const keys = Object.keys(vibration);
	if (keys.length === 0) {
		return false;
	}
	return keys.some((k) => isPresent(vibration[k]));
}

const VIBRATION_REQUIRED = [
	["psdG2Hz", "vibration.psdG2Hz", "Vibration PSD (g²/Hz) is required"],
	["fromHz", "vibration.fromHz", "From frequency (Hz) is required"],
	["toHz", "vibration.toHz", "To frequency (Hz) is required"],
];

function validateVibration(vibration, errors) {
	if (!hasVibrationData(vibration)) {
		return;
	}
	for (const [prop, errKey, msg] of VIBRATION_REQUIRED) {
		if (!isNumber(vibration[prop])) {
			errors[errKey] = msg;
		}
	}
	checkOrder(
		{
			low: vibration?.fromHz,
			high: vibration?.toHz,
			mainKey: "vibration",
			highKey: "vibration.toHz",
			mainMsg: "fromHz must be <= toHz",
			highMsg: "To frequency must be >= from frequency",
		},
		errors,
	);
}

const OPTIONAL_NUMBERS = [
	["shockG", "Shock must be a number"],
	["airflowMs", "Airflow must be a number"],
];

function validateOptionalNumbers(draft, errors) {
	for (const [key, msg] of OPTIONAL_NUMBERS) {
		if (isPresent(draft[key]) && !isNumber(draft[key])) {
			errors[key] = msg;
		}
	}
}

export function validateEnvDraft(draft) {
	const errors = {};
	if (!draft || typeof draft !== "object") {
		return { ok: false, errors: { draft: "Draft must be an object" } };
	}
	validateBasicFields(draft, errors);
	validateRange(draft.ambientC, AMBIENT_CONFIG, errors);
	validateRange(draft.humidityPct, HUMIDITY_CONFIG, errors);
	validateVibration(draft.vibration, errors);
	validateOptionalNumbers(draft, errors);
	return {
		ok: Object.keys(errors).length === 0,
		errors,
	};
}
