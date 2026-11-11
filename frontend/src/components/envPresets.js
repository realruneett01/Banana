export const ENV_PRESETS = [
	{
		key: "office",
		label: "Office",
		description: "Consumer indoor 0-40 C, 10-80 %RH, 0 m",
		env: {
			name: "Office",
			ambientC: { min: 0, max: 40 },
			humidityPct: { min: 10, max: 80 },
			altitudeM: 0,
		},
	},
	{
		key: "automotive",
		label: "Automotive",
		description:
			"AEC-Q100 grade 1: -40 to 125 C, 5-95 %RH, vibration 0.04 g2/Hz 10-2000 Hz, shock 50 g",
		env: {
			name: "Automotive",
			ambientC: { min: -40, max: 125 },
			humidityPct: { min: 5, max: 95 },
			altitudeM: 0,
			vibration: { psdG2Hz: 0.04, fromHz: 10, toHz: 2000 },
			shockG: 50,
		},
	},
	{
		key: "industrial",
		label: "Industrial",
		description: "-40 to 85 C, 5-95 %RH, vibration 0.01 g2/Hz 10-500 Hz",
		env: {
			name: "Industrial",
			ambientC: { min: -40, max: 85 },
			humidityPct: { min: 5, max: 95 },
			altitudeM: 0,
			vibration: { psdG2Hz: 0.01, fromHz: 10, toHz: 500 },
		},
	},
	{
		key: "outdoor",
		label: "Outdoor",
		description: "-30 to 70 C, 0-100 %RH, 2000 m",
		env: {
			name: "Outdoor",
			ambientC: { min: -30, max: 70 },
			humidityPct: { min: 0, max: 100 },
			altitudeM: 2000,
		},
	},
	{
		key: "aerospace",
		label: "Aerospace",
		description:
			"-55 to 125 C, 0-100 %RH, 12000 m, vibration 0.1 g2/Hz 20-2000 Hz, shock 100 g",
		env: {
			name: "Aerospace",
			ambientC: { min: -55, max: 125 },
			humidityPct: { min: 0, max: 100 },
			altitudeM: 12000,
			vibration: { psdG2Hz: 0.1, fromHz: 20, toHz: 2000 },
			shockG: 100,
		},
	},
	{
		key: "data-center",
		label: "Data Center",
		description: "18-35 C, 20-80 %RH, airflow 2 m/s",
		env: {
			name: "Data Center",
			ambientC: { min: 18, max: 35 },
			humidityPct: { min: 20, max: 80 },
			altitudeM: 0,
			airflowMs: 2,
		},
	},
];

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

function checkRange(range, label, errKey, errors) {
	if (!isNumber(range?.min) || !isNumber(range?.max)) {
		return;
	}
	if (range.min > range.max) {
		errors[errKey] = `${label} min must be <= max`;
		errors[`${errKey}.max`] = `${label} max must be >= min`;
	}
}

function validateBasicFields(draft, errors) {
	if (!isNonEmptyString(draft.name)) {
		errors.name = "Name is required";
	}
	if (!isNumber(draft.altitudeM)) {
		errors.altitudeM = "Altitude is required";
	}
}

function validateAmbient(ambientC, errors) {
	if (!ambientC || typeof ambientC !== "object") {
		errors["ambientC.min"] = "Min ambient temperature is required";
		errors["ambientC.max"] = "Max ambient temperature is required";
		return;
	}
	if (!isNumber(ambientC.min)) {
		errors["ambientC.min"] = "Min ambient temperature is required";
	}
	if (!isNumber(ambientC.max)) {
		errors["ambientC.max"] = "Max ambient temperature is required";
	}
	checkRange(ambientC, "Ambient", "ambientC", errors);
}

function validateHumidity(humidityPct, errors) {
	if (!humidityPct || typeof humidityPct !== "object") {
		errors["humidityPct.min"] = "Min humidity is required";
		errors["humidityPct.max"] = "Max humidity is required";
		return;
	}
	if (!isNumber(humidityPct.min)) {
		errors["humidityPct.min"] = "Min humidity is required";
	} else if (!isWithin100(humidityPct.min)) {
		errors["humidityPct.min"] = "Min humidity must be between 0 and 100%";
	}
	if (!isNumber(humidityPct.max)) {
		errors["humidityPct.max"] = "Max humidity is required";
	} else if (!isWithin100(humidityPct.max)) {
		errors["humidityPct.max"] = "Max humidity must be between 0 and 100%";
	}
	checkRange(humidityPct, "Humidity", "humidityPct", errors);
}

function checkFreqRange(vibration, errors) {
	if (!isNumber(vibration?.fromHz) || !isNumber(vibration?.toHz)) {
		return;
	}
	if (vibration.fromHz > vibration.toHz) {
		errors.vibration = "fromHz must be <= toHz";
		errors["vibration.toHz"] = "To frequency must be >= from frequency";
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

function validateVibration(vibration, errors) {
	if (!hasVibrationData(vibration)) {
		return;
	}
	if (!isNumber(vibration.psdG2Hz)) {
		errors["vibration.psdG2Hz"] = "Vibration PSD (g²/Hz) is required";
	}
	if (!isNumber(vibration.fromHz)) {
		errors["vibration.fromHz"] = "From frequency (Hz) is required";
	}
	if (!isNumber(vibration.toHz)) {
		errors["vibration.toHz"] = "To frequency (Hz) is required";
	}
	checkFreqRange(vibration, errors);
}

function validateOptionalNumbers(draft, errors) {
	if (isPresent(draft.shockG) && !isNumber(draft.shockG)) {
		errors.shockG = "Shock must be a number";
	}
	if (isPresent(draft.airflowMs) && !isNumber(draft.airflowMs)) {
		errors.airflowMs = "Airflow must be a number";
	}
}

export function validateEnvDraft(draft) {
	const errors = {};
	if (!draft || typeof draft !== "object") {
		return { ok: false, errors: { draft: "Draft must be an object" } };
	}
	validateBasicFields(draft, errors);
	validateAmbient(draft.ambientC, errors);
	validateHumidity(draft.humidityPct, errors);
	validateVibration(draft.vibration, errors);
	validateOptionalNumbers(draft, errors);
	return {
		ok: Object.keys(errors).length === 0,
		errors,
	};
}
