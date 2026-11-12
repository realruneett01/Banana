export const SCHEMATIC_THEME = Object.freeze({
	background: "#f5f4ef",
	grid: "#b5b5b5",
	cursor: "#0f0f0f",
	wire: "#009600",
	bus: "#000084",
	junction: "#009600",
	busJunction: "#000084",
	noConnect: "#000084",
	symbolBody: "#840000",
	symbolFill: "#ffffc2",
	pin: "#840000",
	pinName: "#006464",
	pinNumber: "#a90000",
	reference: "#006464",
	value: "#006464",
	field: "#840084",
	label: "#0f0f0f",
	globalLabel: "#840000",
	hierLabel: "#725600",
	netName: "#848484",
	sheet: "#840000",
	sheetFill: "#ffffff",
	sheetName: "#006464",
	sheetFile: "#725600",
	note: "#0000c2",
	selection: "#ff9900",
	highlight: "#ff00ff",
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
	viaHole: "#e3b72e",
	padThrough: "#e3b72e",
	padHole: "#000000",
	selection: "#ff9900",
	highlight: "#ff00ff",
	drcError: "rgba(215,91,107,0.8)",
	drcWarning: "rgba(255,208,66,0.8)",
	layers: Object.freeze({
		"F.Cu": "#c83434",
		"B.Cu": "#4d7fc4",
		"In1.Cu": "#7fc87f",
		"In2.Cu": "#ce7d2c",
		"In3.Cu": "#4fcbcb",
		"In4.Cu": "#db628b",
		"F.SilkS": "#f2eda1",
		"B.SilkS": "#e8b2a7",
		"F.Mask": "rgba(216,100,255,0.4)",
		"B.Mask": "rgba(2,255,238,0.4)",
		"F.Paste": "rgba(180,160,154,0.9)",
		"B.Paste": "rgba(0,194,194,0.9)",
		"F.Adhes": "#844480",
		"B.Adhes": "#0000f0",
		"F.CrtYd": "#ff26e2",
		"B.CrtYd": "#26e9ff",
		"F.Fab": "#afafaf",
		"B.Fab": "#585d84",
		"Edge.Cuts": "#d0d2cd",
		Margin: "#ff26e2",
		"Dwgs.User": "#c2c2c2",
		"Cmts.User": "#5994dc",
		"Eco1.User": "#b4dbd2",
		"Eco2.User": "#d8c852",
	}),
});

export function getSchematicColor(theme, key) {
	return theme?.[key] ?? SCHEMATIC_THEME[key] ?? "#ff00ff";
}

export function getLayerColor(theme, layer) {
	const layers = theme?.layers;
	if (layers?.[layer]) {
		return layers[layer];
	}
	const innerMatch =
		typeof layer === "string" ? layer.match(/^In(\d+)\.Cu$/) : null;
	if (innerMatch) {
		const n = Number(innerMatch[1]);
		if (n >= 5 && n <= 30) {
			const index = ((n - 1) % 4) + 1;
			return layers?.[`In${index}.Cu`] ?? "#94a3b8";
		}
	}
	if (typeof layer === "string" && /^User\.[1-9]$/.test(layer)) {
		return layers?.["Dwgs.User"] ?? "#94a3b8";
	}
	return "#94a3b8";
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
