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

// kicad-cli's default pin-conflict matrix, as recorded in
// test/unit/fixtures/erc-pin-matrix-kicad.json, as each type's conflicting
// partners. The map stores both orders; unlisted pairs are "ok".
const ERROR_PARTNERS = {
	output: ["output", "power_out", ...OPEN_DRAIN_TYPES],
	power_out: ["power_out", "tri_state", ...OPEN_DRAIN_TYPES],
};
const WARNING_PARTNERS = {
	tri_state: ["output", "power_in", ...OPEN_DRAIN_TYPES],
	bidirectional: ["power_out", "open_emitter"],
	unspecified: PIN_TYPES.filter((t) => t !== "free" && t !== "no_connect"),
};

const pairEntries = (partners, severity) =>
	Object.entries(partners).flatMap(([a, list]) =>
		list.flatMap((b) => [
			[`${a}|${b}`, severity],
			[`${b}|${a}`, severity],
		]),
	);

const MATRIX = new Map([
	...pairEntries(ERROR_PARTNERS, "error"),
	...pairEntries(WARNING_PARTNERS, "warning"),
]);

export function pinPairSeverity(a, b) {
	if (a === "no_connect" || b === "no_connect") {
		return a === b ? "ok" : "error";
	}
	return MATRIX.get(`${a}|${b}`) ?? "ok";
}

// Observed in kicad-cli: each pin reports at most one pin_to_pin violation,
// against a conflicting pin of the same or a later tier (same types keep net
// order), so a pin conflicting only with earlier pins reports nothing.
// Types within one tier never conflict with each other.
const REPORT_TIERS = [
	["no_connect"],
	["unspecified"],
	OPEN_DRAIN_TYPES,
	["tri_state"],
	["bidirectional", "input", "passive", "free", "power_in"],
	["output"],
	["power_out"],
];
const reportRank = (p) => REPORT_TIERS.findIndex((t) => t.includes(p.type));
const SEVERITY_RANK = { error: 0, warning: 1 };

// Same-named outputs of one part (parallel SW pads) act as one pin.
function isParallelOutput(p, q) {
	const bothOutputs = p.type === "output" && q.type === "output";
	return bothOutputs && p.ref === q.ref && Boolean(p.name) && p.name === q.name;
}

function reportOrder(pins) {
	const merged = pins.filter(
		(p, i) => !pins.slice(0, i).some((q) => isParallelOutput(q, p)),
	);
	return merged.sort((a, b) => reportRank(a) - reportRank(b));
}

// The pin's one violation, against its first conflicting partner (kicad-cli
// takes the nearest one, which need not be the most severe).
function pinIssue(p, later) {
	const partners = later
		.map((q) => ({ q, severity: pinPairSeverity(p.type, q.type) }))
		.filter((c) => c.severity !== "ok");
	if (partners.length === 0) return null;
	const { q, severity } = partners[0];
	const message = `pin type conflict: ${p.type} vs ${q.type}`;
	return { severity, message, pins: [p, q] };
}

function pairIssues(pins) {
	const ordered = reportOrder(pins);
	return ordered
		.map((p, i) => pinIssue(p, ordered.slice(i + 1)))
		.filter(Boolean)
		.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

function driveIssues(pins) {
	const issues = [];
	if (pins.length >= 1 && pins.every((p) => p.type === "input")) {
		const message = "net has only inputs (not driven)";
		issues.push({ severity: "error", message, pins: [...pins] });
	}
	// Like KiCad, only a power_out pin drives power_in (not output or bidi).
	const powerIn = pins.filter((p) => p.type === "power_in");
	if (powerIn.length > 0 && !pins.some((p) => p.type === "power_out")) {
		const message = "power_in not driven";
		issues.push({ severity: "error", message, pins: powerIn });
	}
	return issues;
}

// `driven`: the net has a driver outside `pins` (power port, PWR_FLAG or an
// off-sheet link), so the not-driven checks cannot fire.
export function checkNet(pins, { driven = false } = {}) {
	const drive = driven ? [] : driveIssues(pins);
	return [...pairIssues(pins), ...drive];
}
