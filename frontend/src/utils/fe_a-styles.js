// Shared inline-style building blocks for the workspace panels.
export const FLEX_COLUMN = Object.freeze({
	display: "flex",
	flexDirection: "column",
});

export const FLEX_CENTER = Object.freeze({
	display: "flex",
	alignItems: "center",
});

export const FLEX_CENTERED = Object.freeze({
	...FLEX_CENTER,
	justifyContent: "center",
});

export const FILL_BOX = Object.freeze({ width: "100%", height: "100%" });

export const ELLIPSIS = Object.freeze({
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
});

export function column(gap, extra) {
	return { ...FLEX_COLUMN, gap, ...extra };
}

export function centerRow(gap, extra) {
	return { ...FLEX_CENTER, gap, ...extra };
}

export function inlineBadge(gap, extra) {
	return { ...FLEX_CENTER, display: "inline-flex", gap, ...extra };
}
