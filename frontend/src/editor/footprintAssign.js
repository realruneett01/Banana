import { API_BASE_URL } from "./fabExport.js";

export { API_BASE_URL };

const FILTER_KEYS = [
	"ki_fp_filters",
	"Footprint Filter",
	"footprint_filter",
	"footprintFilters",
	"ki_fp_filters",
];

function findFilterValue(part) {
	const props = part.props ?? {};
	for (const key of FILTER_KEYS) {
		const val = props[key] ?? part[key];
		if (val) return val;
	}
	return null;
}

function getFilterField(part) {
	const raw = findFilterValue(part);
	if (!raw) return "";
	const token = Array.isArray(raw)
		? raw[0]
		: String(raw)
				.trim()
				.split(/[\s,]+/)[0];
	return token ? token.replace(/[*?]+/g, "").trim() : "";
}

function getPinCount(part) {
	if (Array.isArray(part.pins) && part.pins.length > 0) {
		return part.pins.length;
	}
	const text = `${part.value || ""} ${part.symbol || ""}`;
	const match = text.match(/(?:pin|header|conn|soic|dip)[^\d]*(\d+)/i);
	return match ? Number(match[1]) : 0;
}

function formatConnectorQuery(part) {
	const count = getPinCount(part) || 2;
	const text = `${part.value || ""} ${part.symbol || ""}`;
	const match = text.match(/1x0*(\d+)/i);
	const n = match ? Number(match[1]) : count;
	const pad = n < 10 ? String(n).padStart(2, "0") : String(n);
	return `PinHeader_1x${pad}`;
}

function formatIcQuery(part) {
	const count = getPinCount(part) || 8;
	const text = `${part.value || ""} ${part.symbol || ""}`.toLowerCase();
	const prefix = text.includes("dip") ? "DIP" : "SOIC";
	return `${prefix}-${count}`;
}

const PASSIVE_RULES = [
	{ prefix: "LED", sym: "led", query: "LED_0805" },
	{ prefix: "R", sym: "resistor", exact: ":r", query: "R_0805" },
	{ prefix: "C", sym: "capacitor", exact: ":c", query: "C_0805" },
	{ prefix: "D", sym: "diode", exact: ":d", query: "D_SOD-123" },
];

function matchesPassiveRule(rule, ref, sym) {
	if (ref.startsWith(rule.prefix)) return true;
	if (sym.includes(rule.sym)) return true;
	return rule.exact ? sym.endsWith(rule.exact) : false;
}

function matchPassiveQuery(ref, sym) {
	const match = PASSIVE_RULES.find((r) => matchesPassiveRule(r, ref, sym));
	return match ? match.query : "";
}

const CONNECTOR_PREFIXES = ["J", "P"];

function isConnectorPart(ref, sym) {
	if (CONNECTOR_PREFIXES.some((p) => ref.startsWith(p))) return true;
	return sym.includes("conn") || sym.includes("connector");
}

function isIcPart(ref, sym, pinCount) {
	if (ref.startsWith("U") || sym.includes("ic")) return true;
	return pinCount > 2;
}

function normalizeField(val) {
	return typeof val === "string" ? val.trim() : "";
}

function matchActiveQuery(ref, sym, part) {
	if (isConnectorPart(ref, sym)) {
		return formatConnectorQuery(part);
	}
	if (isIcPart(ref, sym, getPinCount(part))) {
		return formatIcQuery(part);
	}
	return normalizeField(part.value);
}

function resolvePartQuery(ref, sym, val, part) {
	if (val.includes("led")) {
		return "LED_0805";
	}
	const passive = matchPassiveQuery(ref, sym);
	if (passive) {
		return passive;
	}
	return matchActiveQuery(ref, sym, part);
}

export function suggestFootprintQuery(part) {
	if (!part || typeof part !== "object") return "";
	const filter = getFilterField(part);
	if (filter) return filter;

	const ref = normalizeField(part.ref).toUpperCase();
	const sym = normalizeField(part.symbol).toLowerCase();
	const val = normalizeField(part.value).toLowerCase();

	return resolvePartQuery(ref, sym, val, part);
}

function toAssignmentList(assignments) {
	if (!assignments) return [];
	if (Array.isArray(assignments)) {
		return assignments.filter((a) => a && typeof a.partId === "string");
	}
	if (assignments instanceof Map) {
		return Array.from(assignments.entries(), ([partId, footprint]) => ({
			partId,
			footprint,
		}));
	}
	return Object.entries(assignments).map(([partId, footprint]) => ({
		partId,
		footprint,
	}));
}

export function assignmentsToCommand(assignments) {
	const list = toAssignmentList(assignments);
	const commands = list
		.filter((item) => item.partId && typeof item.footprint === "string")
		.map(({ partId, footprint }) => ({
			type: "setPartField",
			partId,
			field: "footprint",
			value: footprint,
		}));
	return { type: "batch", commands };
}

export async function searchFootprints(query, options = {}) {
	const { fetchImpl = fetch, baseUrl = API_BASE_URL, limit = 50 } = options;
	const trimmed = String(query ?? "").trim();
	if (!trimmed) {
		return [];
	}
	const host = (baseUrl ?? API_BASE_URL).replace(/\/+$/, "");
	const qs = new URLSearchParams({ q: trimmed, limit: String(limit) });
	const res = await fetchImpl(`${host}/api/library/footprints?${qs}`);
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(body?.error || `Search failed with status ${res.status}`);
	}
	const data = await res.json();
	return Array.isArray(data?.footprints) ? data.footprints : [];
}
