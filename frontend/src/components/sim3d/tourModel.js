export const SEVERITY_ORDER = Object.freeze([
	"short_nets",
	"overvoltage",
	"reverse_polarity",
	"missing_ground",
	"part_short",
	"open_trace",
	"part_open",
	"value_drift",
]);

export const DEFAULT_FAULT_PROMPTS = Object.freeze({
	short_nets: {
		title: "Short Circuit",
		intro:
			"Two connections touch accidentally, giving power an unintended shortcut.",
		question:
			"Will components overheat or blow a fuse when current bypasses the load?",
	},
	overvoltage: {
		title: "Overvoltage",
		intro:
			"The power source supplies higher voltage than the circuit was designed for.",
		question: "Can components withstand a voltage surge without burning out?",
	},
	reverse_polarity: {
		title: "Reverse Polarity",
		intro:
			"Power is connected backwards, reversing positive and negative connections.",
		question: "Will reverse current destroy sensitive or polarized components?",
	},
	missing_ground: {
		title: "Missing Ground",
		intro:
			"The circuit loses its ground reference, leaving signals without a return path.",
		question: "Does the circuit lose reference and float into malfunction?",
	},
	part_short: {
		title: "Component Short Circuit",
		intro: "A component breaks down internally and behaves like a solid wire.",
		question:
			"Does the shorted component pass dangerous current to neighboring parts?",
	},
	open_trace: {
		title: "Open Trace",
		intro:
			"A copper trace or solder joint is cracked, breaking the path like a cut wire.",
		question:
			"Does power fail to reach downstream parts when the track breaks?",
	},
	part_open: {
		title: "Component Open Circuit",
		intro:
			"A component burns out or disconnects internally, leaving an open gap.",
		question: "Does current stop flowing when this component fails open?",
	},
	value_drift: {
		title: "Value Drift",
		intro:
			"A component's electrical value drifts far outside nominal tolerance.",
		question:
			"Does component aging or heat drift push the circuit out of tolerance?",
	},
});

function buildHealthyStep() {
	return {
		id: "healthy",
		fault: null,
		title: "Healthy Circuit",
		intro:
			"First, let's test how your circuit runs normally without any faults.",
		question:
			"Does current flow safely through all components under normal conditions?",
	};
}

function severityIndex(kind) {
	const idx = SEVERITY_ORDER.indexOf(kind);
	return idx >= 0 ? idx : SEVERITY_ORDER.length;
}

function sortFaultsBySeverity(faults) {
	return [...faults].sort(
		(a, b) => severityIndex(a?.kind) - severityIndex(b?.kind),
	);
}

function buildFaultStep(fault, index) {
	const fallback = DEFAULT_FAULT_PROMPTS[fault?.kind] || {
		title: fault?.kind || "Circuit Fault",
		intro: "A simulated circuit fault is injected into your board.",
		question: "How does the circuit behave when this fault occurs?",
	};
	return {
		id: fault?.id || `step-fault-${index}`,
		fault,
		title: fault?.info?.label || fallback.title,
		intro: fault?.info?.plainEnglish || fallback.intro,
		question: fallback.question,
	};
}

export function buildTour(faults) {
	const safeFaults = Array.isArray(faults) ? faults : [];
	const sorted = sortFaultsBySeverity(safeFaults);
	const steps = [buildHealthyStep()];
	for (let i = 0; i < sorted.length; i++) {
		steps.push(buildFaultStep(sorted[i], i));
	}
	return steps;
}

function extractCurrents(result) {
	if (!result) return {};
	if (result.partCurrents && typeof result.partCurrents === "object") {
		return result.partCurrents;
	}
	return typeof result === "object" ? result : {};
}

function getPartRating(ratings, partId) {
	if (!ratings || typeof ratings !== "object") return null;
	const val = ratings[partId];
	if (typeof val === "number") return val;
	if (typeof val?.maxCurrentA === "number") return val.maxCurrentA;
	if (typeof val?.maxCurrent === "number") return val.maxCurrent;
	return null;
}

function isCurrentDamaging(iHealthy, iFaulty, rating) {
	if (rating !== null && iFaulty > rating) return true;
	if (iHealthy > 1e-6 && iFaulty > 2 * iHealthy) return true;
	return false;
}

function checkDamage(hCurrents, fCurrents, ratings) {
	for (const [id, fVal] of Object.entries(fCurrents)) {
		const iFaulty = Math.abs(Number(fVal) || 0);
		const iHealthy = Math.abs(Number(hCurrents[id]) || 0);
		const rating = getPartRating(ratings, id);
		if (isCurrentDamaging(iHealthy, iFaulty, rating)) {
			return { damaged: true, partId: id, current: iFaulty };
		}
	}
	return { damaged: false };
}

function findKeyLoad(hCurrents, explicitKey) {
	if (explicitKey && hCurrents[explicitKey] !== undefined) return explicitKey;
	const entries = Object.entries(hCurrents);
	const match = entries.find(([id]) => /load|led|out/i.test(id));
	if (match) return match[0];
	const loads = entries.filter(([id]) => !/^(v|bat|bt|src)/i.test(id));
	if (loads.length === 0) return entries[0]?.[0] ?? null;
	loads.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
	return loads[0][0];
}

function checkStopped(hCurrents, fCurrents, keyLoad) {
	if (!keyLoad) return false;
	const iHealthy = Math.abs(Number(hCurrents[keyLoad]) || 0);
	if (iHealthy <= 1e-6) return false;
	const iFaulty = Math.abs(Number(fCurrents[keyLoad]) || 0);
	return iFaulty < 0.1 * iHealthy;
}

function parseRatingsAndOptions(ratingsOrOptions) {
	if (!ratingsOrOptions) return { ratings: null, keyLoad: null };
	if (typeof ratingsOrOptions === "string") {
		return { ratings: null, keyLoad: ratingsOrOptions };
	}
	if (ratingsOrOptions.ratings || ratingsOrOptions.keyLoad) {
		return {
			ratings: ratingsOrOptions.ratings || null,
			keyLoad: ratingsOrOptions.keyLoad || null,
		};
	}
	return { ratings: ratingsOrOptions, keyLoad: null };
}

export function stepVerdict(healthy, faulty, ratingsOrOptions) {
	if (!faulty) {
		return {
			verdict: "stops working",
			text: "The circuit stopped working: no current could be measured.",
		};
	}
	const { ratings, keyLoad: optKeyLoad } =
		parseRatingsAndOptions(ratingsOrOptions);
	const hCurrents = extractCurrents(healthy);
	const fCurrents = extractCurrents(faulty);
	const damage = checkDamage(hCurrents, fCurrents, ratings);
	if (damage.damaged) {
		return {
			verdict: "gets damaged",
			text: `Component ${damage.partId} exceeds safe limits and gets damaged.`,
		};
	}
	const keyLoad = findKeyLoad(hCurrents, optKeyLoad);
	if (checkStopped(hCurrents, fCurrents, keyLoad)) {
		return {
			verdict: "stops working",
			text: `Circuit stopped working: current to ${keyLoad} dropped below 10% of normal.`,
		};
	}
	return {
		verdict: "survives",
		text: "The circuit survived safely within normal operational limits.",
	};
}

function extractVerdict(item) {
	if (typeof item === "string") return item;
	return item?.verdict || "stops working";
}

function isProblemItem(item) {
	if (typeof item === "string") return true;
	return item?.id !== "healthy" && item?.fault !== null;
}

function selectTips(verdictList) {
	const hasDamage = verdictList.includes("gets damaged");
	const hasStopped = verdictList.includes("stops working");
	const tips = [];
	if (hasDamage) {
		tips.push(
			"Add current-limiting resistors or fuses to protect components from dangerous overcurrent.",
		);
	}
	if (hasStopped) {
		tips.push(
			"Add reverse-polarity protection diodes and check ground return paths to prevent shutdown.",
		);
	}
	if (!hasDamage && !hasStopped && verdictList.length > 0) {
		tips.push(
			"Great job! Your circuit survived all simulated fault tests without component damage.",
		);
	}
	if (tips.length === 0) {
		tips.push(
			"Always verify component voltage and power ratings before fabricating your PCB.",
		);
	}
	return tips;
}

export function tourSummary(verdicts) {
	const list = Array.isArray(verdicts) ? verdicts : [];
	const problems = list.filter(isProblemItem);
	const verdictStrings = problems.map(extractVerdict);
	const handled = verdictStrings.filter((v) => v === "survives").length;
	const total = verdictStrings.length;
	return {
		score: `${handled} of ${total} problems your board handles`,
		tips: selectTips(verdictStrings),
	};
}
