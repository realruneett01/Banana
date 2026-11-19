function sanitizePrefix(rawPrefix) {
	const sanitized = (rawPrefix || "U").replace(/[?#]+$/, "");
	return sanitized || "U";
}

function escapeRegex(pattern) {
	return pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractUsedRefNumbers(parts, regex) {
	const numbers = new Set();
	for (const p of parts ?? []) {
		const match = p?.ref?.match(regex);
		if (match) {
			numbers.add(Number(match[1]));
		}
	}
	return numbers;
}

function findLowestAvailableIndex(usedSet) {
	let num = 1;
	while (usedSet.has(num)) {
		num++;
	}
	return num;
}

export function nextRef(parts, rawPrefix) {
	const prefix = sanitizePrefix(rawPrefix);
	const escaped = escapeRegex(prefix);
	const regex = new RegExp(`^${escaped}(\\d+)$`, "i");
	const usedNumbers = extractUsedRefNumbers(parts, regex);
	const nextNum = findLowestAvailableIndex(usedNumbers);
	return `${prefix}${nextNum}`;
}

export function buildPlacedPart(item = {}, parts = [], at = {}) {
	const prefix = item?.ref || item?.prefix || "U";
	const ref = nextRef(parts, prefix);
	const value = item?.value || "";
	const symbol = item?.symbol || "";
	const footprint = item?.footprint || "";
	const x = at?.x ?? 0;
	const y = at?.y ?? 0;
	const side = at?.side === "B" ? "B" : "F";

	return {
		ref,
		value,
		symbol,
		footprint,
		placement: { x, y, rot: 0, side },
	};
}
