// KiCad-style ERC pin types, grouped by how the rules treat them.
const DRIVER_TYPES = ["output", "bidirectional", "power_out"];
const OPEN_DRAIN_TYPES = ["open_collector", "open_emitter"];
const PASSIVE_TYPES = ["passive", "free", "unspecified"];

export const PIN_TYPES = [
	"input",
	...DRIVER_TYPES.slice(0, 2),
	"tri_state",
	...PASSIVE_TYPES,
	"power_in",
	DRIVER_TYPES[2],
	...OPEN_DRAIN_TYPES,
	"no_connect",
];

// Base rules; the matrix stores both orders so lookups are symmetric.
const RULES = [
	["output", "output", "error"],
	["output", "power_out", "error"],
	["power_out", "power_out", "error"],
	["output", "open_collector", "error"],
	["output", "open_emitter", "error"],
	["tri_state", "output", "warning"],
];

const MATRIX = new Map(
	RULES.flatMap(([a, b, s]) => [
		[`${a}|${b}`, s],
		[`${b}|${a}`, s],
	]),
);

const DRIVERS = new Set(DRIVER_TYPES);

export function pinPairSeverity(a, b) {
	if (a === "no_connect" || b === "no_connect") {
		return a === b ? "ok" : "error";
	}
	if (a === "unspecified" || b === "unspecified") return "warning";
	return MATRIX.get(`${a}|${b}`) ?? "ok";
}

function pairIssues(pins) {
	const issues = [];
	pins.forEach((p, i) => {
		for (const q of pins.slice(i + 1)) {
			const severity = pinPairSeverity(p.type, q.type);
			if (severity === "ok") continue;
			const message = `pin type conflict: ${p.type} vs ${q.type}`;
			issues.push({ severity, message, pins: [p, q] });
		}
	});
	return issues;
}

function driveIssues(pins) {
	const issues = [];
	if (pins.length >= 1 && pins.every((p) => p.type === "input")) {
		const message = "net has only inputs (not driven)";
		issues.push({ severity: "error", message, pins: [...pins] });
	}
	const powerIn = pins.filter((p) => p.type === "power_in");
	if (powerIn.length > 0 && !pins.some((p) => DRIVERS.has(p.type))) {
		const message = "power_in not driven";
		issues.push({ severity: "error", message, pins: powerIn });
	}
	return issues;
}

export function checkNet(pins) {
	return [...pairIssues(pins), ...driveIssues(pins)];
}
