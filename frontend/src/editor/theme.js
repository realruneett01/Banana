// KiCad default palette colours shared by several items.
const GREEN = "#009600";
const NAVY = "#000084";
const MAROON = "#840000";
const TEAL = "#006464";
const OCHRE = "#725600";
const GOLD = "#e3b72e";
const PINK = "#ff26e2";
const FALLBACK_LAYER = "#94a3b8";

/** Selection and highlight colours common to the schematic and PCB editors. */
const SELECTION_COLOURS = Object.freeze({
	selection: "#ff9900",
	highlight: "#ff00ff",
});

/** Inner copper colours; KiCad cycles them for In5.Cu and up. */
const INNER_COPPER = ["#7fc87f", "#ce7d2c", "#4fcbcb", "#db628b"];

/** Front/back layer pairs as [suffix, front colour, back colour], in KiCad order. */
const SIDED_TECH_LAYERS = [
	["SilkS", "#f2eda1", "#e8b2a7"],
	["Mask", "rgba(216,100,255,0.4)", "rgba(2,255,238,0.4)"],
	["Paste", "rgba(180,160,154,0.9)", "rgba(0,194,194,0.9)"],
	["Adhes", "#844480", "#0000f0"],
	["CrtYd", PINK, "#26e9ff"],
	["Fab", "#afafaf", "#585d84"],
];

function sidedLayers(pairs) {
	return Object.fromEntries(
		pairs.flatMap(([suffix, front, back]) => [
			[`F.${suffix}`, front],
			[`B.${suffix}`, back],
		]),
	);
}

function innerCopperLayers() {
	return Object.fromEntries(
		INNER_COPPER.map((colour, i) => [`In${i + 1}.Cu`, colour]),
	);
}

/** Schematic colours grouped the way KiCad's colour settings group them. */
const SCHEMATIC_WIRING = {
	wire: GREEN,
	bus: NAVY,
	junction: GREEN,
	busJunction: NAVY,
	noConnect: NAVY,
};
const SCHEMATIC_SYMBOLS = {
	symbolBody: MAROON,
	symbolFill: "#ffffc2",
	pin: MAROON,
	pinName: TEAL,
	pinNumber: "#a90000",
};
const SCHEMATIC_FIELDS = { reference: TEAL, value: TEAL, field: "#840084" };
const SCHEMATIC_LABELS = {
	label: "#0f0f0f",
	globalLabel: MAROON,
	hierLabel: OCHRE,
	netName: "#848484",
};
const SCHEMATIC_SHEETS = {
	sheet: MAROON,
	sheetFill: "#ffffff",
	sheetName: TEAL,
	sheetFile: OCHRE,
};

export const SCHEMATIC_THEME = Object.freeze({
	background: "#f5f4ef",
	grid: "#b5b5b5",
	cursor: "#0f0f0f",
	...SCHEMATIC_WIRING,
	...SCHEMATIC_SYMBOLS,
	...SCHEMATIC_FIELDS,
	...SCHEMATIC_LABELS,
	...SCHEMATIC_SHEETS,
	note: "#0000c2",
	...SELECTION_COLOURS,
	ercError: "rgba(255,0,0,0.8)",
	ercWarning: "rgba(0,0,255,0.8)",
});

export const SCHEMATIC_THEME_DARK = Object.freeze({
	...SCHEMATIC_THEME,
	background: "#1e1e1e",
	grid: "#4a4a4a",
	cursor: "#e6e6e6",
	label: "#e6e6e6",
	symbolFill: "rgba(0,0,0,0)",
	sheetFill: "rgba(0,0,0,0)",
});

export const PCB_THEME = Object.freeze({
	background: "#001023",
	grid: "#848484",
	cursor: "#ffffff",
	ratsnest: "rgba(0,248,255,0.35)",
	via: "#ececec",
	viaHole: GOLD,
	padThrough: GOLD,
	padHole: "#000000",
	...SELECTION_COLOURS,
	drcError: "rgba(215,91,107,0.8)",
	drcWarning: "rgba(255,208,66,0.8)",
	layers: Object.freeze({
		...sidedLayers([["Cu", "#c83434", "#4d7fc4"]]),
		...innerCopperLayers(),
		...sidedLayers(SIDED_TECH_LAYERS),
		"Edge.Cuts": "#d0d2cd",
		Margin: PINK,
		"Dwgs.User": "#c2c2c2",
		"Cmts.User": "#5994dc",
		"Eco1.User": "#b4dbd2",
		"Eco2.User": "#d8c852",
	}),
});

export function getSchematicColor(theme, key) {
	return theme?.[key] ?? SCHEMATIC_THEME[key] ?? "#ff00ff";
}

/** Colour for In5.Cu..In30.Cu, which reuse In1..In4 cyclically; null if not one. */
function cycledInnerColor(layers, layer) {
	const innerMatch = layer.match(/^In(\d+)\.Cu$/);
	const n = innerMatch ? Number(innerMatch[1]) : 0;
	if (n < 5 || n > 30) {
		return null;
	}
	const index = ((n - 1) % INNER_COPPER.length) + 1;
	return layers?.[`In${index}.Cu`] ?? FALLBACK_LAYER;
}

export function getLayerColor(theme, layer) {
	const layers = theme?.layers;
	if (layers?.[layer]) {
		return layers[layer];
	}
	if (typeof layer !== "string") {
		return FALLBACK_LAYER;
	}
	const inner = cycledInnerColor(layers, layer);
	if (inner) {
		return inner;
	}
	if (/^User\.[1-9]$/.test(layer)) {
		return layers?.["Dwgs.User"] ?? FALLBACK_LAYER;
	}
	return FALLBACK_LAYER;
}

export function withOverrides(theme, overrides = {}) {
	const merged = { ...theme, ...overrides };
	if (theme?.layers || overrides?.layers) {
		merged.layers = Object.freeze({
			...theme?.layers,
			...overrides?.layers,
		});
	}
	return Object.freeze(merged);
}
