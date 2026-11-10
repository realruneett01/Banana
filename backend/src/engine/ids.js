import { randomUUID } from "node:crypto";

const ALLOWED_KINDS = new Set([
	"part",
	"net",
	"pin",
	"trace",
	"via",
	"zone",
	"sheet",
	"issue",
	"sim",
	"env",
	"tool",
]);

const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseKind(value) {
	if (typeof value !== "string") {
		return null;
	}
	const sepIndex = value.indexOf("_");
	if (sepIndex <= 0) {
		return null;
	}
	const kind = value.slice(0, sepIndex);
	if (!ALLOWED_KINDS.has(kind)) {
		return null;
	}
	const uuid = value.slice(sepIndex + 1);
	if (!UUID_REGEX.test(uuid)) {
		return null;
	}
	return kind;
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
