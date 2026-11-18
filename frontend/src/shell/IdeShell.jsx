import { useCallback, useRef, useState } from "react";
import { ResizeHandle } from "./SplitPane.jsx";

// --- Pure IDE Shell helpers ---
function parseNum(val, fallback = 0) {
	const num = typeof val === "number" ? val : Number.parseFloat(val);
	return Number.isFinite(num) ? num : fallback;
}

export function clampSize(size, min, max) {
	const lower = min ?? -Infinity;
	const upper = max ?? Infinity;
	if (lower > upper) return lower;
	const num = parseNum(size, min ?? 0);
	return Math.min(Math.max(num, lower), upper);
}

export function gridColumns({
	sidebarOpen = true,
	auxOpen = false,
	sizes = {},
} = {}) {
	const act = sizes?.activityBar ?? 48;
	const cols = [`${act}px`];
	if (sidebarOpen) {
		cols.push(`${clampSize(sizes?.sidebar ?? 260, 180, 480)}px`);
	}
	cols.push("1fr");
	if (auxOpen) {
		cols.push(`${clampSize(sizes?.aux ?? 320, 240, 560)}px`);
	}
	return cols.join(" ");
}
// --- End Pure IDE Shell helpers ---

const STORAGE_KEY = "bn-ide-shell-sizes";
const DEFAULT_SIZES = Object.freeze({
	sidebar: 260,
	aux: 320,
	bottom: 200,
});

const BORDER_SUBTLE =
	"1px solid var(--bn-border-subtle, rgba(255, 255, 255, 0.08))";

const SHELL_CONTAINER_STYLE = Object.freeze({
	width: "100vw",
	height: "100vh",
	overflow: "hidden",
	display: "flex",
	flexDirection: "column",
	boxSizing: "border-box",
});

const TOP_BAR_STYLE = Object.freeze({
	height: "var(--bn-tab-h, 32px)",
	minHeight: "32px",
	maxHeight: "32px",
	overflow: "hidden",
	display: "flex",
	alignItems: "center",
	backgroundColor: "var(--bn-bg-surface, #12151c)",
	borderBottom: BORDER_SUBTLE,
});

const STATUS_BAR_STYLE = Object.freeze({
	height: "var(--bn-status-bar-h, 22px)",
	minHeight: "22px",
	maxHeight: "22px",
	overflow: "hidden",
	display: "flex",
	alignItems: "center",
	backgroundColor: "var(--bn-bg-app, #181818)",
	borderTop: BORDER_SUBTLE,
	fontSize: "var(--bn-type-status, 11px)",
});

const ACTIVITY_BAR_STYLE = Object.freeze({
	width: "var(--bn-activity-bar-w, 48px)",
	overflow: "auto",
	backgroundColor: "var(--bn-bg-app, #181818)",
	borderRight: BORDER_SUBTLE,
});

const SIDE_PANEL_STYLE = Object.freeze({
	overflow: "hidden",
	display: "flex",
	position: "relative",
	backgroundColor: "var(--bn-bg-surface, #12151c)",
});

const BOTTOM_SECTION_STYLE = Object.freeze({
	overflow: "auto",
	backgroundColor: "var(--bn-bg-surface, #12151c)",
	borderTop: BORDER_SUBTLE,
});

const MAIN_STYLE = Object.freeze({
	display: "flex",
	flexDirection: "column",
	height: "100%",
	overflow: "hidden",
	minWidth: 0,
});

const EDITOR_STYLE = Object.freeze({
	flex: 1,
	minHeight: 0,
	overflow: "auto",
	backgroundColor: "var(--bn-bg-editor, #1e1e1e)",
});

const GRID_CONTAINER_STYLE = Object.freeze({
	flex: 1,
	minHeight: 0,
	display: "grid",
	overflow: "hidden",
});

function getStoredSizes() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

function persistSizes(sizes) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
		return true;
	} catch {
		return false;
	}
}

function usePaneSizes() {
	const [sizes, setSizes] = useState(() => {
		const stored = getStoredSizes();
		return {
			sidebar: clampSize(stored.sidebar ?? DEFAULT_SIZES.sidebar, 180, 480),
			aux: clampSize(stored.aux ?? DEFAULT_SIZES.aux, 240, 560),
			bottom: clampSize(stored.bottom ?? DEFAULT_SIZES.bottom, 120, undefined),
		};
	});

	const updateSize = useCallback((key, val) => {
		setSizes((prev) => {
			const next = { ...prev, [key]: val };
			persistSizes(next);
			return next;
		});
	}, []);

	return [sizes, updateSize];
}

function TopBarRow({ topBar }) {
	if (!topBar) return null;
	return <header style={TOP_BAR_STYLE}>{topBar}</header>;
}

function StatusBarRow({ statusBar }) {
	return <footer style={STATUS_BAR_STYLE}>{statusBar}</footer>;
}

function SidePanel({ children, onResize, onReset, isAux = false }) {
	const handle = (
		<ResizeHandle
			direction="horizontal"
			onResize={onResize}
			onReset={onReset}
			isInverse={isAux}
		/>
	);
	return (
		<aside
			style={{
				...SIDE_PANEL_STYLE,
				[isAux ? "borderLeft" : "borderRight"]: BORDER_SUBTLE,
			}}
		>
			{isAux && handle}
			<div style={{ flex: 1, overflow: "auto" }}>{children}</div>
			{!isAux && handle}
		</aside>
	);
}

function BottomPanel({ bottom, bottomSize, onResize, onReset }) {
	return (
		<>
			<ResizeHandle
				direction="vertical"
				onResize={onResize}
				onReset={onReset}
				isInverse={true}
			/>
			<section style={{ ...BOTTOM_SECTION_STYLE, height: `${bottomSize}px` }}>
				{bottom}
			</section>
		</>
	);
}

function MainColumn({ editor, bottom, mainRef }) {
	return (
		<main ref={mainRef} style={MAIN_STYLE}>
			<section style={EDITOR_STYLE}>{editor}</section>
			{bottom}
		</main>
	);
}

function MiddleGrid({ columns, activityBar, sidebar, main, aux }) {
	return (
		<div style={{ ...GRID_CONTAINER_STYLE, gridTemplateColumns: columns }}>
			<nav style={ACTIVITY_BAR_STYLE}>{activityBar}</nav>
			{sidebar}
			{main}
			{aux}
		</div>
	);
}

function useResizeHandlers({ sizes, updateSize, mainRef }) {
	const onResizeSidebar = (delta) => {
		updateSize("sidebar", clampSize(sizes.sidebar + delta, 180, 480));
	};
	const onResizeAux = (delta) => {
		updateSize("aux", clampSize(sizes.aux + delta, 240, 560));
	};
	const onResizeBottom = (delta) => {
		const h = mainRef.current?.getBoundingClientRect().height ?? 800;
		updateSize(
			"bottom",
			clampSize(sizes.bottom + delta, 120, Math.floor(h * 0.6)),
		);
	};
	return { onResizeSidebar, onResizeAux, onResizeBottom };
}

function usePanels({ props, sizes, updateSize, mainRef }) {
	const resizers = useResizeHandlers({ sizes, updateSize, mainRef });
	const sidebar = (props.sidebarOpen ?? true) && (
		<SidePanel
			onResize={resizers.onResizeSidebar}
			onReset={() => updateSize("sidebar", 260)}
		>
			{props.sidebar}
		</SidePanel>
	);
	const aux = Boolean(props.auxOpen) && (
		<SidePanel
			isAux={true}
			onResize={resizers.onResizeAux}
			onReset={() => updateSize("aux", 320)}
		>
			{props.aux}
		</SidePanel>
	);
	const bottom = Boolean(props.bottomOpen) && (
		<BottomPanel
			bottom={props.bottom}
			bottomSize={sizes.bottom}
			onResize={resizers.onResizeBottom}
			onReset={() => updateSize("bottom", 200)}
		/>
	);
	return { sidebar, aux, bottom };
}

export function IdeShell(props) {
	const { topBar, activityBar, editor, statusBar } = props;
	const [sizes, updateSize] = usePaneSizes();
	const mainRef = useRef(null);
	const panels = usePanels({ props, sizes, updateSize, mainRef });
	const columns = gridColumns({
		sidebarOpen: props.sidebarOpen ?? true,
		auxOpen: props.auxOpen ?? false,
		sizes,
	});

	return (
		<div style={SHELL_CONTAINER_STYLE}>
			<TopBarRow topBar={topBar} />
			<MiddleGrid
				columns={columns}
				activityBar={activityBar}
				sidebar={panels.sidebar}
				main={
					<MainColumn
						editor={editor}
						bottom={panels.bottom}
						mainRef={mainRef}
					/>
				}
				aux={panels.aux}
			/>
			<StatusBarRow statusBar={statusBar} />
		</div>
	);
}

export default IdeShell;
