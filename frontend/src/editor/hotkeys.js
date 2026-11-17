function parseHotkeys(text) {
	const entries = text
		.trim()
		.split("\n")
		.map((line) => line.trim().split(/\s+/))
		.filter(([action]) => Boolean(action));
	return Object.freeze(Object.fromEntries(entries));
}

const SCHEMATIC_HOTKEYS_TEXT = `
placeSymbol a
placePower p
placeWire w
placeBus b
placeNoConnect q
placeJunction j
placeLabel l
placeGlobalLabel ctrl+l
placeHierLabel h
placeText t
move m
drag g
rotate r
mirrorX x
mirrorY y
edit e
editValue v
editFootprint f
duplicate ctrl+d
copy ctrl+c
paste ctrl+v
cut ctrl+x
selectAll ctrl+a
delete delete
undo ctrl+z
redo ctrl+y
zoomFit home
zoomIn f1
zoomOut f2
cancel escape
save ctrl+s
`;

const PCB_HOTKEYS_TEXT = `
routeTrack x
routeDiffPair 6
tuneLength 7
addVia v
drag d
selectConnected u
flip f
move m
rotate r
edit e
duplicate ctrl+d
copy ctrl+c
paste ctrl+v
selectAll ctrl+a
delete delete
undo ctrl+z
redo ctrl+y
layerTop pageup
layerBottom pagedown
layerNext +
layerPrev -
refillZones b
unfillZones ctrl+b
zoomFit home
zoomIn f1
zoomOut f2
cancel escape
save ctrl+s
`;

export const SCHEMATIC_HOTKEYS = parseHotkeys(SCHEMATIC_HOTKEYS_TEXT);
export const PCB_HOTKEYS = parseHotkeys(PCB_HOTKEYS_TEXT);

const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta"]);
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function getModifierParts(event) {
	const parts = [];
	if (event.ctrlKey || event.metaKey) {
		parts.push("ctrl");
	}
	if (event.shiftKey) {
		parts.push("shift");
	}
	if (event.altKey) {
		parts.push("alt");
	}
	return parts;
}

export function eventToKeySpec(event) {
	if (!event?.key) {
		return "";
	}
	const lower = event.key.toLowerCase();
	if (MODIFIER_KEYS.has(lower)) {
		return "";
	}
	const key = event.key === " " ? "space" : lower;
	const parts = getModifierParts(event);
	parts.push(key);
	return parts.join("+");
}

export function isTypingTarget(target) {
	if (!target) {
		return false;
	}
	const tag = target.tagName ? target.tagName.toUpperCase() : "";
	if (TYPING_TAGS.has(tag)) {
		return true;
	}
	return Boolean(target.isContentEditable);
}

export function mergeBindings(defaults = {}, overrides = {}) {
	const merged = {};
	const safeOverrides = overrides || {};
	for (const [action, defaultKey] of Object.entries(defaults || {})) {
		const rawValue = safeOverrides[action] ?? defaultKey;
		merged[action] =
			typeof rawValue === "string" ? rawValue.toLowerCase() : rawValue;
	}
	return Object.freeze(merged);
}

function buildReverseMap(bindings) {
	const keyMap = new Map();
	for (const [action, spec] of Object.entries(bindings || {})) {
		if (typeof spec === "string") {
			keyMap.set(spec.toLowerCase(), action);
		}
	}
	return keyMap;
}

function resolveAction(keyMap, event) {
	if (!event || isTypingTarget(event.target)) {
		return null;
	}
	const spec = eventToKeySpec(event);
	return spec ? (keyMap.get(spec) ?? null) : null;
}

export function createHotkeyDispatcher(bindings = {}, handlers = {}) {
	const keyMap = buildReverseMap(bindings);

	return function dispatch(event) {
		const action = resolveAction(keyMap, event);
		const handler = action ? handlers?.[action] : undefined;
		if (typeof handler !== "function") {
			return false;
		}
		handler(event);
		if (typeof event.preventDefault === "function") {
			event.preventDefault();
		}
		return true;
	};
}

// Extra keys the schematic canvas accepts besides SCHEMATIC_HOTKEYS: "+" may
// need Shift (US layouts send "shift++"), "=" is the unshifted "+" key.
const SCHEMATIC_KEY_ALIASES = Object.freeze({
	"+": "zoomIn",
	"shift++": "zoomIn",
	"=": "zoomIn",
	"-": "zoomOut",
	backspace: "delete",
	"ctrl+shift+z": "redo",
});

const SCHEMATIC_KEY_MAP = new Map([
	...Object.entries(SCHEMATIC_KEY_ALIASES),
	...buildReverseMap(SCHEMATIC_HOTKEYS),
]);

export function resolveSchematicAction(event) {
	return resolveAction(SCHEMATIC_KEY_MAP, event);
}
