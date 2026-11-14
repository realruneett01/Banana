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

export function pinPairSeverity(a, b) {
	if (a === "no_connect" || b === "no_connect") {
		return a === b ? "ok" : "error";
	}
	if (a === "unspecified" || b === "unspecified") return "warning";
	return MATRIX.get(`${a}|${b}`) ?? "ok";
}

const isUnspecified = (p) => p.type === "unspecified";

// Unspecified pins warn against anything. Like kicad-cli, each one joins the
// net's cluster by a single warning (a star spanning tree): one per
// unspecified pin, or k-1 when every pin on the net is unspecified.
function unspecifiedIssues(pins) {
	const anchor = pins.find((p) => !isUnspecified(p)) ?? pins[0];
	const joining = pins.filter((p) => isUnspecified(p) && p !== anchor);
	return joining.map((p) => ({
		severity: "warning",
		message: `pin type conflict: unspecified vs ${anchor.type}`,
		pins: [p, anchor],
	}));
}

// Same-named outputs of one part (parallel SW pads) act as one pin.
function isParallelOutput(p, q) {
	const bothOutputs = p.type === "output" && q.type === "output";
	return bothOutputs && p.ref === q.ref && Boolean(p.name) && p.name === q.name;
}

// Edge order: parallel pads merge first, then errors win over warnings.
const EDGE_RANK = { parallel: 0, error: 1, warning: 2 };

function conflictEdges(typed) {
	const edges = [];
	typed.forEach((p, i) => {
		typed.slice(i + 1).forEach((q, k) => {
			const severity = pinPairSeverity(p.type, q.type);
			const kind = isParallelOutput(p, q) ? "parallel" : severity;
			if (kind !== "ok") edges.push({ i, j: i + 1 + k, kind });
		});
	});
	return edges.sort((a, b) => EDGE_RANK[a.kind] - EDGE_RANK[b.kind]);
}

function rootOf(parent, i) {
	let r = i;
	while (parent[r] !== r) r = parent[r];
	return r;
}

// kicad-cli reports n-1 violations per cluster of conflicting pins, not
// every pair, so keep only the edges of a spanning forest (union-find).
function pairIssues(pins) {
	const typed = pins.filter((p) => !isUnspecified(p));
	const parent = typed.map((_, i) => i);
	const issues = [];
	for (const { i, j, kind } of conflictEdges(typed)) {
		const [a, b] = [rootOf(parent, i), rootOf(parent, j)];
		if (a === b) continue;
		parent[b] = a;
		if (kind === "parallel") continue;
		const [p, q] = [typed[i], typed[j]];
		const message = `pin type conflict: ${p.type} vs ${q.type}`;
		issues.push({ severity: kind, message, pins: [p, q] });
	}
	return issues;
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
	return [...pairIssues(pins), ...unspecifiedIssues(pins), ...drive];
}
