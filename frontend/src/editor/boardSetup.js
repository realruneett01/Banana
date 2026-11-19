export const DEFAULT_NET_CLASS = Object.freeze({
	name: "Default",
	clearance: 0.2,
	trackWidth: 0.25,
	viaSize: 0.6,
	viaDrill: 0.3,
	diffPairWidth: 0.2,
	diffPairGap: 0.25,
	nets: Object.freeze([]),
});

export const DEFAULT_DESIGN_RULES = Object.freeze({
	minClearance: 0.2,
	minTrackWidth: 0.25,
	minViaSize: 0.6,
	minViaDrill: 0.3,
	minDiffPairWidth: 0.2,
	minDiffPairGap: 0.25,
});

export const DEFAULT_TRACK_WIDTHS = Object.freeze([0.25, 0.5, 1.0]);

export const DEFAULT_VIA_SIZES = Object.freeze([
	Object.freeze({ size: 0.6, drill: 0.3 }),
	Object.freeze({ size: 0.8, drill: 0.4 }),
]);

export const DEFAULT_SETUP = Object.freeze({
	thickness: 1.6,
	copperLayers: 2,
	clearance: 0.2,
	track: 0.25,
	via: 0.6,
	viaDrill: 0.3,
	diffPairWidth: 0.2,
	diffPairGap: 0.25,
	designRules: DEFAULT_DESIGN_RULES,
	netClasses: Object.freeze([DEFAULT_NET_CLASS]),
	trackWidths: DEFAULT_TRACK_WIDTHS,
	viaSizes: DEFAULT_VIA_SIZES,
});

const RULE_SPECS = [
	{ key: "minClearance", fallbackKey: "clearance", def: 0.2 },
	{ key: "minTrackWidth", fallbackKey: "track", def: 0.25 },
	{ key: "minViaSize", fallbackKey: "via", def: 0.6 },
	{ key: "minViaDrill", fallbackKey: "viaDrill", def: 0.3 },
	{ key: "minDiffPairWidth", fallbackKey: "diffPairWidth", def: 0.2 },
	{ key: "minDiffPairGap", fallbackKey: "diffPairGap", def: 0.25 },
];

const NET_CLASS_FIELDS = [
	{ key: "clearance", altKey: null, def: 0.2 },
	{ key: "trackWidth", altKey: "track", def: 0.25 },
	{ key: "viaSize", altKey: "via", def: 0.6 },
	{ key: "viaDrill", altKey: null, def: 0.3 },
	{ key: "diffPairWidth", altKey: null, def: 0.2 },
	{ key: "diffPairGap", altKey: null, def: 0.25 },
];

const POSITIVE_RULE_CHECKS = [
	["minClearance", "Minimum clearance must be greater than 0 mm"],
	["minTrackWidth", "Minimum track width must be greater than 0 mm"],
	["minViaSize", "Minimum via size must be greater than 0 mm"],
	["minViaDrill", "Minimum via drill must be greater than 0 mm"],
];

const CLASS_MIN_CHECKS = [
	[
		"clearance",
		"minClearance",
		"Clearance must be at least the minimum clearance",
	],
	[
		"trackWidth",
		"minTrackWidth",
		"Track width must be at least the minimum track width",
	],
	["viaSize", "minViaSize", "Via size must be at least the minimum via size"],
	[
		"viaDrill",
		"minViaDrill",
		"Via drill must be at least the minimum via drill",
	],
];

const STANDARD_PRESETS = [
	{ mm: 0.25, label: "Signal 0.25 mm", hint: "~0.5 A current capacity" },
	{ mm: 0.5, label: "Power 0.5 mm", hint: "~1.2 A current capacity" },
	{ mm: 1.0, label: "High current 1.0 mm", hint: "~2.0 A current capacity" },
];

function numVal(val, fallback) {
	if (val == null || val === "") return fallback;
	const n = Number(val);
	return Number.isFinite(n) ? n : fallback;
}

function readField(item, key, altKey) {
	if (item[key] != null) return item[key];
	if (altKey && item[altKey] != null) return item[altKey];
	return undefined;
}

function mergeDesignRules(raw, rules) {
	const r = rules || {};
	const base = raw || {};
	const res = {};
	for (const { key, fallbackKey, def } of RULE_SPECS) {
		const val = r[key] != null ? r[key] : base[fallbackKey];
		res[key] = numVal(val, def);
	}
	return res;
}

function mergeNetClass(c) {
	const item = c || {};
	const res = {
		name: String(item.name || "Default"),
		nets: Array.isArray(item.nets) ? [...item.nets] : [],
	};
	for (const { key, altKey, def } of NET_CLASS_FIELDS) {
		res[key] = numVal(readField(item, key, altKey), def);
	}
	return res;
}

function mergeNetClasses(userClasses) {
	if (!Array.isArray(userClasses) || userClasses.length === 0) {
		return [{ ...DEFAULT_NET_CLASS, nets: [] }];
	}
	const merged = userClasses.map(mergeNetClass);
	const hasDefault = merged.some((c) => c.name === "Default");
	if (!hasDefault) {
		merged.unshift({ ...DEFAULT_NET_CLASS, nets: [] });
	}
	return merged;
}

function parseTrackWidthItem(w) {
	if (typeof w === "number") return w;
	const val = w != null && typeof w === "object" ? w.mm : w;
	const n = Number(val);
	return Number.isFinite(n) && n > 0 ? n : 0.25;
}

function mergeTrackWidths(raw) {
	if (!Array.isArray(raw) || raw.length === 0) {
		return [...DEFAULT_TRACK_WIDTHS];
	}
	return raw.map(parseTrackWidthItem);
}

function parseViaSizeItem(v) {
	const item = v || {};
	return {
		size: numVal(readField(item, "size", "sizeMm"), 0.6),
		drill: numVal(readField(item, "drill", "drillMm"), 0.3),
	};
}

function mergeViaSizes(raw) {
	if (!Array.isArray(raw) || raw.length === 0) {
		return DEFAULT_VIA_SIZES.map((v) => ({ ...v }));
	}
	return raw.map(parseViaSizeItem);
}

export function getBoardSetup(board) {
	const raw = board?.setup ?? {};
	const rules = mergeDesignRules(raw, raw.designRules);
	const netClasses = mergeNetClasses(raw.netClasses);
	const defClass =
		netClasses.find((c) => c.name === "Default") || DEFAULT_NET_CLASS;

	return {
		thickness: numVal(raw.thickness, 1.6),
		copperLayers: numVal(raw.copperLayers, 2),
		clearance: numVal(raw.clearance, defClass.clearance),
		track: numVal(raw.track, defClass.trackWidth),
		via: numVal(raw.via, defClass.viaSize),
		viaDrill: numVal(raw.viaDrill, defClass.viaDrill),
		diffPairWidth: numVal(raw.diffPairWidth, defClass.diffPairWidth),
		diffPairGap: numVal(raw.diffPairGap, defClass.diffPairGap),
		designRules: rules,
		netClasses,
		trackWidths: mergeTrackWidths(raw.trackWidths),
		viaSizes: mergeViaSizes(raw.viaSizes),
	};
}

export function withBoardSetup(board, patch) {
	const base = getBoardSetup(board);
	const nextPatch = patch || {};
	const merged = {
		...base,
		...nextPatch,
		designRules: {
			...base.designRules,
			...(nextPatch.designRules || {}),
		},
	};
	return {
		...(board || {}),
		setup: getBoardSetup({ setup: merged }),
	};
}

function checkStackup(s, problems) {
	if (s.thickness <= 0) {
		problems.push("Board thickness must be greater than 0 mm");
	}
	if (s.copperLayers < 1) {
		problems.push("Copper layer count must be at least 1");
	}
}

function checkPositiveRules(rules, problems) {
	for (const [key, msg] of POSITIVE_RULE_CHECKS) {
		if (rules[key] <= 0) problems.push(msg);
	}
}

function checkDesignRuleLimits(rules, problems) {
	checkPositiveRules(rules, problems);
	if (rules.minViaDrill >= rules.minViaSize) {
		problems.push("Minimum via drill must be smaller than minimum via size");
	}
}

function checkClassDimensions(c, r, problems) {
	const pfx = c.name === "Default" ? "" : `Net class "${c.name}": `;
	for (const [prop, minProp, msg] of CLASS_MIN_CHECKS) {
		if (c[prop] < r[minProp]) {
			problems.push(`${pfx}${msg}`);
		}
	}
	if (c.viaDrill >= c.viaSize) {
		problems.push(`${pfx}Via drill must be smaller than via size`);
	}
}

function checkPredefinedTracks(trackWidths, minTrackWidth, problems) {
	const widths = Array.isArray(trackWidths) ? trackWidths : [];
	for (const w of widths) {
		if (w < minTrackWidth) {
			problems.push(
				`Predefined track width (${w} mm) must be at least the minimum track width`,
			);
		}
	}
}

function checkOneVia(v, r, problems) {
	if (v.size < r.minViaSize) {
		problems.push(
			`Predefined via size (${v.size} mm) must be at least the minimum via size`,
		);
	}
	if (v.drill < r.minViaDrill) {
		problems.push(
			`Predefined via drill (${v.drill} mm) must be at least the minimum via drill`,
		);
	}
	if (v.drill >= v.size) {
		problems.push(
			`Predefined via drill (${v.drill} mm) must be smaller than via size (${v.size} mm)`,
		);
	}
}

function checkPredefinedVias(viaSizes, rules, problems) {
	const sizes = Array.isArray(viaSizes) ? viaSizes : [];
	for (const v of sizes) {
		checkOneVia(v, rules, problems);
	}
}

export function validateSetup(setup) {
	const s = getBoardSetup({ setup });
	const r = s.designRules;
	const problems = [];

	checkStackup(s, problems);
	checkDesignRuleLimits(r, problems);
	for (const c of s.netClasses) {
		checkClassDimensions(c, r, problems);
	}
	checkPredefinedTracks(s.trackWidths, r.minTrackWidth, problems);
	checkPredefinedVias(s.viaSizes, r, problems);

	return problems;
}

function classHasNet(netClass, target) {
	if (netClass.name === "Default") return false;
	if (!Array.isArray(netClass.nets)) return false;
	return netClass.nets.includes(target);
}

export function netClassForNet(setup, netName) {
	const s = getBoardSetup({ setup });
	const classes = s.netClasses || [];
	const defaultClass =
		classes.find((c) => c.name === "Default") || DEFAULT_NET_CLASS;
	if (typeof netName !== "string" || !netName.trim()) {
		return defaultClass;
	}
	const target = netName.trim();
	const match = classes.find((c) => classHasNet(c, target));
	return match || defaultClass;
}

function findStandardPreset(mm) {
	return STANDARD_PRESETS.find((p) => Math.abs(p.mm - mm) < 1e-4);
}

function estimateCapacityHint(mm) {
	const standard = findStandardPreset(mm);
	if (standard) return standard.hint;
	const amps = Math.max(0.1, Math.round(mm * 20) / 10);
	return `~${amps.toFixed(1)} A current capacity`;
}

function labelForWidth(mm) {
	const standard = findStandardPreset(mm);
	return standard ? standard.label : `${mm} mm`;
}

function isCustomPreset(item) {
	if (!item || typeof item !== "object") return false;
	return Boolean(item.label && item.mm);
}

function parseMm(item) {
	if (typeof item === "number") return item;
	const n = Number(item);
	return Number.isFinite(n) && n > 0 ? n : 0.25;
}

function formatPreset(item) {
	if (isCustomPreset(item)) {
		const mmVal = Number(item.mm);
		const hintVal = item.hint ? String(item.hint) : estimateCapacityHint(mmVal);
		return Object.freeze({
			label: String(item.label),
			mm: mmVal,
			hint: hintVal,
		});
	}
	const mm = parseMm(item);
	return Object.freeze({
		label: labelForWidth(mm),
		mm,
		hint: estimateCapacityHint(mm),
	});
}

export function trackWidthsFromSetup(setup) {
	const s = getBoardSetup({ setup });
	const list = s.trackWidths || DEFAULT_TRACK_WIDTHS;
	return Object.freeze(list.map(formatPreset));
}
