export function issueKey(issue) {
	const kind = issue?.kind ?? issue?.code ?? issue?.metric ?? "";
	const itemIds = Array.isArray(issue?.itemIds)
		? [...issue.itemIds].sort().join(",")
		: "";
	return `${kind}:${itemIds}`;
}

function formatSummary(fixedCount, stillOpenCount, addedCount) {
	const word = fixedCount === 1 ? "problem" : "problems";
	return `${fixedCount} ${word} fixed, ${stillOpenCount} still open, ${addedCount} new`;
}

export function diffIssues(before, after) {
	const prev = Array.isArray(before) ? before : [];
	const next = Array.isArray(after) ? after : [];

	const prevKeys = new Set(prev.map(issueKey));
	const nextKeys = new Set(next.map(issueKey));

	const fixed = prev.filter((issue) => !nextKeys.has(issueKey(issue)));
	const stillOpen = next.filter((issue) => prevKeys.has(issueKey(issue)));
	const added = next.filter((issue) => !prevKeys.has(issueKey(issue)));

	return {
		fixed,
		stillOpen,
		added,
		summary: formatSummary(fixed.length, stillOpen.length, added.length),
	};
}
