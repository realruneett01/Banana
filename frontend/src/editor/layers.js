function buildNonCopperLayers() {
	const frontBack = (names) => names.flatMap((n) => [`F.${n}`, `B.${n}`]);
	const numbered = Array.from({ length: 9 }, (_, i) => `User.${i + 1}`);
	return [
		...frontBack(["Adhes", "Paste", "SilkS", "Mask"]),
		"Dwgs.User",
		"Cmts.User",
		"Eco1.User",
		"Eco2.User",
		"Edge.Cuts",
		"Margin",
		...frontBack(["CrtYd", "Fab"]),
		...numbered,
	];
}

export const NON_COPPER_LAYERS = Object.freeze(buildNonCopperLayers());

function isValidCopperCount(count) {
	if (!Number.isInteger(count)) return false;
	if (count === 1) return true;
	if (count < 2 || count > 32) return false;
	return count % 2 === 0;
}

export function copperLayers(count) {
	if (!isValidCopperCount(count)) {
		throw new RangeError(`Invalid copper layer count: ${count}`);
	}
	if (count === 1) return Object.freeze(["F.Cu"]);
	const inners = Array.from({ length: count - 2 }, (_, i) => `In${i + 1}.Cu`);
	return Object.freeze(["F.Cu", ...inners, "B.Cu"]);
}

export function layerKind(name) {
	if (typeof name !== "string") return "tech";
	if (name.endsWith(".Cu")) return "copper";
	if (name === "Edge.Cuts") return "edge";
	if (name.endsWith(".User") || /^User\.[1-9]$/.test(name)) return "user";
	return "tech";
}

export function flipLayer(name) {
	if (typeof name !== "string") return name;
	if (name.startsWith("F.")) return `B.${name.slice(2)}`;
	if (name.startsWith("B.")) return `F.${name.slice(2)}`;
	return name;
}

export function createLayerState({ copperCount = 2 } = {}) {
	const copper = copperLayers(copperCount);
	const all = Object.freeze([...copper, ...NON_COPPER_LAYERS]);
	return Object.freeze({
		copper,
		all,
		active: "F.Cu",
		hidden: Object.freeze([]),
		highContrast: false,
	});
}

export function setActive(state, layer) {
	if (!state.all.includes(layer) || state.active === layer) return state;
	return Object.freeze({ ...state, active: layer });
}

export function isVisible(state, layer) {
	return state.all.includes(layer) && !state.hidden.includes(layer);
}

export function setVisible(state, layer, visible) {
	if (!state.all.includes(layer)) return state;
	const isCurrentlyHidden = state.hidden.includes(layer);
	if (visible && !isCurrentlyHidden) return state;
	if (!visible && isCurrentlyHidden) return state;
	const hidden = Object.freeze(
		visible
			? state.hidden.filter((l) => l !== layer)
			: state.all.filter((l) => l === layer || state.hidden.includes(l)),
	);
	return Object.freeze({ ...state, hidden });
}

export function toggleVisible(state, layer) {
	const currentlyVisible = isVisible(state, layer);
	return setVisible(state, layer, !currentlyVisible);
}

export function showOnly(state, layers) {
	const visibleSet = new Set(Array.isArray(layers) ? layers : [layers]);
	const hidden = Object.freeze(state.all.filter((l) => !visibleSet.has(l)));
	return Object.freeze({ ...state, hidden });
}

export function stepCopper(state, dir) {
	const currentIdx = state.copper.indexOf(state.active);
	if (currentIdx === -1) {
		return setActive(state, "F.Cu");
	}
	const len = state.copper.length;
	const nextIdx = (((currentIdx + dir) % len) + len) % len;
	return setActive(state, state.copper[nextIdx]);
}

export function jumpCopper(state, which) {
	if (which === "top") return setActive(state, "F.Cu");
	if (which === "bottom") {
		return setActive(state, state.copper[state.copper.length - 1]);
	}
	return state;
}

export function drawOrder(state) {
	const isVis = (l) => !state.hidden.includes(l);
	const isBack = (l) => l.startsWith("B.");
	const back = NON_COPPER_LAYERS.filter((l) => isBack(l) && isVis(l));
	const copper = [...state.copper].reverse().filter(isVis);
	const front = NON_COPPER_LAYERS.filter((l) => !isBack(l) && isVis(l));
	const combined = [...back, ...copper, ...front];
	if (!combined.includes(state.active)) {
		return Object.freeze(combined);
	}
	return Object.freeze([
		...combined.filter((l) => l !== state.active),
		state.active,
	]);
}
