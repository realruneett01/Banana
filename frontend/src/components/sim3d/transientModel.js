export function formatTime(s) {
	if (typeof s !== "number" || Number.isNaN(s)) return "0 ms";
	const abs = Math.abs(s);
	if (abs < 1e-9) return "0 ms";
	if (abs < 1e-6) return `${(s * 1e9).toFixed(1)} ns`;
	if (abs < 1e-3) return `${(s * 1e6).toFixed(1)} µs`;
	if (abs < 1) return `${(s * 1e3).toFixed(1)} ms`;
	return `${s.toFixed(2)} s`;
}

function findTimeIndex(times, t) {
	if (times.length <= 2) return 0;
	let low = 0;
	let high = times.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (times[mid] <= t) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return Math.max(0, Math.min(high, times.length - 2));
}

function interpolateDict(dict, i, alpha) {
	const result = {};
	if (!dict) return result;
	for (const [key, arr] of Object.entries(dict)) {
		const v0 = arr?.[i] ?? 0;
		const v1 = arr?.[i + 1] ?? v0;
		result[key] = v0 + (v1 - v0) * alpha;
	}
	return result;
}

export function frameAt(series, t) {
	if (!series?.time || series.time.length === 0) {
		return { nodeVoltages: {}, partCurrents: {} };
	}
	const times = series.time;
	const clampedT = Math.max(times[0], Math.min(t, times[times.length - 1]));
	const i = findTimeIndex(times, clampedT);
	const t0 = times[i];
	const t1 = times[i + 1] ?? t0;
	const dt = t1 - t0;
	const alpha = dt > 0 ? (clampedT - t0) / dt : 0;
	return {
		nodeVoltages: interpolateDict(series.nodeVoltages, i, alpha),
		partCurrents: interpolateDict(series.partCurrents, i, alpha),
	};
}

export function playbackClock({ durationS = 0, speed = 1 } = {}) {
	let t = 0;
	let curSpeed = Math.max(0, Number(speed) || 0);
	const dur = Math.max(0, Number(durationS) || 0);
	const scale = dur > 0 ? 8 / dur : 1;

	return {
		scale,
		get t() {
			return t;
		},
		get duration() {
			return dur;
		},
		get speed() {
			return curSpeed;
		},
		set speed(s) {
			curSpeed = Math.max(0, Number(s) || 0);
		},
		setSpeed(s) {
			curSpeed = Math.max(0, Number(s) || 0);
		},
		reset() {
			t = 0;
			return t;
		},
		seek(targetT) {
			t = Math.min(dur, Math.max(0, Number(targetT) || 0));
			return t;
		},
		advance(dtWallS, speedOverride) {
			const s = speedOverride !== undefined ? speedOverride : curSpeed;
			const dtSim = dur > 0 ? (dtWallS * s) / scale : 0;
			t = Math.min(dur, Math.max(0, t + dtSim));
			return t;
		},
	};
}

function calculateMedian(values) {
	if (!values || values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) {
		return sorted[mid];
	}
	return (sorted[mid - 1] + sorted[mid]) / 2;
}

function isLedPart(part, partId) {
	const ref = String(part?.ref || part?.id || partId || "").toUpperCase();
	const sym = String(part?.symbol || "").toLowerCase();
	const val = String(part?.value || "").toLowerCase();
	const type = String(part?.type || "").toLowerCase();
	if (sym.includes("led") || val.includes("led") || type.includes("led")) {
		return true;
	}
	return ref.startsWith("LED") || ref.startsWith("D");
}

function resolvePartLabel(part, partId, isLed) {
	const ref = part?.ref || partId;
	if (isLed) {
		return ref.startsWith("LED") ? ref : `LED ${ref}`;
	}
	return ref;
}

function updateLedState({ cur, t, isOn, partId, label, events }) {
	if (!isOn && cur > 0.001) {
		events.push({
			t,
			kind: "turn_on",
			partId,
			text: `${label} turns on at ${formatTime(t)}`,
		});
		return true;
	}
	if (isOn && cur <= 0.001) {
		events.push({
			t,
			kind: "turn_off",
			partId,
			text: `${label} turns off at ${formatTime(t)}`,
		});
		return false;
	}
	return isOn;
}

function updateSpikeState({
	cur,
	t,
	isSpiking,
	spikeThreshold,
	partId,
	label,
	events,
}) {
	if (!isSpiking && cur > spikeThreshold) {
		events.push({
			t,
			kind: "spike",
			partId,
			text: `Current spike on ${label} at ${formatTime(t)}`,
		});
		return true;
	}
	if (isSpiking && cur <= spikeThreshold) {
		return false;
	}
	return isSpiking;
}

function detectPartEvents({ partId, currents, times, label, isLed }) {
	const events = [];
	const median = calculateMedian(currents);
	const spikeThreshold = median > 0 ? median * 3 : null;
	let isOn = false;
	let isSpiking = false;

	for (let k = 0; k < times.length; k++) {
		const cur = currents[k] ?? 0;
		const t = times[k];
		if (isLed) {
			isOn = updateLedState({ cur, t, isOn, partId, label, events });
		} else if (spikeThreshold !== null) {
			isSpiking = updateSpikeState({
				cur,
				t,
				isSpiking,
				spikeThreshold,
				partId,
				label,
				events,
			});
		}
	}
	return events;
}

export function detectEvents(series, ir) {
	if (!series?.time || !series?.partCurrents || series.time.length === 0) {
		return [];
	}
	const partMap = new Map((ir?.parts || []).map((p) => [p.id, p]));
	const allEvents = [];
	for (const [partId, rawCurrents] of Object.entries(series.partCurrents)) {
		const part = partMap.get(partId);
		const isLed = isLedPart(part, partId);
		const label = resolvePartLabel(part, partId, isLed);
		const currents = (rawCurrents || []).map((c) => Math.abs(c));
		const partEvents = detectPartEvents({
			partId,
			currents,
			times: series.time,
			label,
			isLed,
		});
		allEvents.push(...partEvents);
	}
	return allEvents.sort((a, b) => a.t - b.t);
}
