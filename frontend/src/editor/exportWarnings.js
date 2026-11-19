/**
 * Collapse export warnings into display lines: duplicates are counted,
 * the list is capped at `limit` lines plus a "...and N more" tail.
 * Returns null when there is nothing to show.
 */
export function summarizeWarnings(warnings, limit = 5) {
	if (!warnings?.length) return null;
	const counts = new Map();
	for (const w of warnings) counts.set(w, (counts.get(w) ?? 0) + 1);
	const unique = [...counts].map(([text, n]) =>
		n > 1 ? `${text} (x${n})` : text,
	);
	const lines = unique.slice(0, limit);
	if (unique.length > limit) {
		lines.push(`...and ${unique.length - limit} more`);
	}
	return { total: warnings.length, lines };
}
