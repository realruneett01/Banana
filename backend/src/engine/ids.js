import { randomUUID } from "node:crypto";

const KINDS = "part net pin trace via zone sheet issue sim env tool".split(" ");

const ALLOWED_KINDS = new Set(KINDS);

const ID_PATTERN = new RegExp(
	`^(${KINDS.join("|")})_([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$`,
);

function parseKind(value) {
	if (typeof value !== "string") {
		return null;
	}
	const match = ID_PATTERN.exec(value);
	return match ? match[1] : null;
}

export function newId(kind) {
	if (!ALLOWED_KINDS.has(kind)) {
		return null;
	}
	return `${kind}_${randomUUID()}`;
}

export function isId(value, kind) {
	const parsedKind = parseKind(value);
	if (parsedKind === null) {
		return false;
	}
	if (kind !== undefined) {
		return parsedKind === kind;
	}
	return true;
}

export function kindOf(id) {
	return parseKind(id);
}
