const SEVERITY_ORDER = ["error", "warning", "info"];

function sortItems(items) {
	return [...items].sort((a, b) =>
		(a?.message ?? "").localeCompare(b?.message ?? ""),
	);
}

function collectGroup(issues, severity) {
	const items = issues.filter(
		(issue) => (issue?.severity ?? "").toLowerCase() === severity,
	);
	if (items.length === 0) return null;
	return {
		severity,
		items: sortItems(items),
	};
}

export function groupIssues(issues) {
	if (!Array.isArray(issues)) return [];
	const groups = [];
	for (const sev of SEVERITY_ORDER) {
		const group = collectGroup(issues, sev);
		if (group) groups.push(group);
	}
	return groups;
}

function matchesStatus(issue, status) {
	if (!status || status === "all") return true;
	return (issue?.status ?? "open") === status;
}

function matchesSource(issue, source) {
	if (!source || source.toLowerCase() === "all") return true;
	return (issue?.source ?? "").toLowerCase() === source.toLowerCase();
}

export function filterIssues(issues, { status = "open", source } = {}) {
	if (!Array.isArray(issues)) return [];
	return issues.filter(
		(issue) =>
			Boolean(issue) &&
			matchesStatus(issue, status) &&
			matchesSource(issue, source),
	);
}

export function issueSummary(issues) {
	const counts = { error: 0, warning: 0, info: 0 };
	if (!Array.isArray(issues)) return counts;
	for (const issue of issues) {
		const sev = (issue?.severity ?? "").toLowerCase();
		if (Object.hasOwn(counts, sev)) {
			counts[sev]++;
		}
	}
	return counts;
}

function hasValue(val) {
	return val !== undefined && val !== null;
}

export function formatMeasured(issue) {
	if (!issue || typeof issue !== "object") return "";
	const { measured, limit, unit } = issue;
	if (!hasValue(measured) || !hasValue(limit)) return "";
	const u = unit ? ` ${unit}` : "";
	return `${measured}${u} > ${limit}${u}`;
}
