import { API_BASE_URL } from "./fabExport.js";

export { API_BASE_URL };

async function postChecksRequest(endpoint, payload, options = {}) {
	const { fetchImpl = fetch, baseUrl = API_BASE_URL } = options;
	const host = (baseUrl ?? API_BASE_URL).replace(/\/+$/, "");
	const res = await fetchImpl(`${host}${endpoint}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(body?.error || `Check failed with status ${res.status}`);
	}
	return await res.json();
}

export async function runDrc({
	pcbText,
	pcb,
	name = "board",
	unconnected = true,
	fetchImpl = fetch,
	baseUrl = API_BASE_URL,
} = {}) {
	return postChecksRequest(
		"/api/checks/drc",
		{ pcb: pcbText ?? pcb, name, unconnected: Boolean(unconnected) },
		{ fetchImpl, baseUrl },
	);
}

export async function runErc({
	schText,
	sch,
	name = "schematic",
	fetchImpl = fetch,
	baseUrl = API_BASE_URL,
} = {}) {
	return postChecksRequest(
		"/api/checks/erc",
		{ sch: schText ?? sch, name },
		{ fetchImpl, baseUrl },
	);
}

const SEVERITY_ORDER = ["error", "warning", "info"];

function getSeverityRank(sev = "") {
	const idx = SEVERITY_ORDER.indexOf(String(sev).toLowerCase());
	return idx === -1 ? SEVERITY_ORDER.length : idx;
}

function bucketBy(items, keyFn) {
	const map = new Map();
	for (const item of items) {
		const key = keyFn(item);
		if (!map.has(key)) {
			map.set(key, []);
		}
		map.get(key).push(item);
	}
	return map;
}

function groupByType(violations) {
	const map = bucketBy(violations, (v) => String(v?.type || "other"));
	const sortedTypes = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
	return sortedTypes.map((type) => {
		const list = map.get(type);
		return {
			type,
			count: list.length,
			violations: list,
			items: list,
		};
	});
}

function groupBySeverity(violations) {
	const map = bucketBy(violations, (v) =>
		String(v?.severity || "error").toLowerCase(),
	);
	const sorted = Array.from(map.keys()).sort(
		(a, b) => getSeverityRank(a) - getSeverityRank(b),
	);
	return { map, sorted };
}

export function countViolations(violations) {
	const counts = { error: 0, warning: 0 };
	if (!Array.isArray(violations)) return counts;
	for (const v of violations) {
		const sev = String(v?.severity || "").toLowerCase();
		if (sev === "error") counts.error += 1;
		else if (sev === "warning") counts.warning += 1;
	}
	return counts;
}

export function groupViolations(violations) {
	if (!Array.isArray(violations)) return [];
	const { map, sorted } = groupBySeverity(violations);
	return sorted.map((severity) => {
		const list = map.get(severity);
		return {
			severity,
			count: list.length,
			types: groupByType(list),
			violations: list,
			items: list,
		};
	});
}
