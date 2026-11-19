import { useRef, useState } from "react";

// --- Pure tabs helpers ---
export function nextTabId(tabs, activeId, step = 1) {
	if (!Array.isArray(tabs) || tabs.length === 0) {
		return null;
	}
	const len = tabs.length;
	const currIdx = tabs.findIndex((t) => t?.id === activeId);
	if (currIdx === -1) {
		return tabs[0]?.id ?? null;
	}
	const targetIdx = (((currIdx + step) % len) + len) % len;
	return tabs[targetIdx]?.id ?? null;
}
// --- End pure tabs helpers ---

function IconBase({ stroke = "currentColor", children }) {
	return (
		<svg
			viewBox="0 0 16 16"
			width="14"
			height="14"
			fill="none"
			stroke={stroke}
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

const KIND_ICONS = {
	schematic: (
		<IconBase stroke="#4ec9b0">
			<path d="M1 8h3l2-4 3 8 2-4h4" />
			<circle cx="1" cy="8" r="1" fill="#4ec9b0" />
			<circle cx="15" cy="8" r="1" fill="#4ec9b0" />
		</IconBase>
	),
	pcb: (
		<IconBase stroke="#5b9dff">
			<rect x="2" y="2" width="12" height="12" rx="2" />
			<circle cx="5" cy="5" r="1" fill="#5b9dff" />
			<circle cx="11" cy="11" r="1" fill="#5b9dff" />
			<path d="M5 5l3 3h3" />
		</IconBase>
	),
	"3d": (
		<IconBase stroke="#c586c0">
			<path d="M8 1l6 3.5v7L8 15l-6-3.5v-7L8 1z" />
			<path d="M8 1v14M8 8l6-3.5M8 8l-6-3.5" />
		</IconBase>
	),
	holo: (
		<IconBase stroke="#f5c542">
			<path d="M8 1l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z" />
		</IconBase>
	),
	diff: (
		<IconBase stroke="#3dd68c">
			<circle cx="4" cy="4" r="2" />
			<circle cx="12" cy="12" r="2" />
			<path d="M4 6v4a2 2 0 002 2h4" />
		</IconBase>
	),
	fields: (
		<IconBase stroke="#e5c07b">
			<rect x="2" y="2" width="12" height="12" rx="1" />
			<path d="M2 7h12M7 2v12" />
		</IconBase>
	),
	footprints: (
		<IconBase stroke="#f0606a">
			<rect x="4" y="4" width="8" height="8" rx="1" />
			<path d="M1 5h3M1 8h3M1 11h3M12 5h3M12 8h3M12 11h3" />
		</IconBase>
	),
	welcome: (
		<IconBase stroke="#56b6c2">
			<path d="M2 7l6-5 6 5v7a1 1 0 01-1 1H3a1 1 0 01-1-1V7z" />
			<path d="M6 15V9h4v6" />
		</IconBase>
	),
	settings: (
		<IconBase stroke="#8a91a3">
			<circle cx="8" cy="8" r="2.5" />
			<path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
		</IconBase>
	),
	default: (
		<IconBase>
			<path d="M3 2h7l3 3v9H3V2z" />
			<path d="M10 2v3h3" />
		</IconBase>
	),
};

const STRIP_STYLE = {
	display: "flex",
	flexDirection: "row",
	alignItems: "stretch",
	height: "var(--bn-tab-h, 30px)",
	background: "var(--bn-bg-surface, #12151c)",
	borderBottom: "1px solid var(--bn-border-subtle, #232836)",
	overflowX: "auto",
	overflowY: "hidden",
	userSelect: "none",
	boxSizing: "border-box",
	whiteSpace: "nowrap",
	outline: "none",
	scrollbarWidth: "none",
};

const BASE_TAB_STYLE = {
	display: "inline-flex",
	alignItems: "center",
	gap: "6px",
	height: "100%",
	padding: "0 10px",
	minWidth: "80px",
	maxWidth: "200px",
	fontSize: "var(--bn-type-body, 12px)",
	cursor: "pointer",
	boxSizing: "border-box",
	borderRight: "1px solid var(--bn-border-subtle, #232836)",
	flexShrink: 0,
	outline: "none",
};

const TAB_TITLE_STYLE = {
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
	flex: 1,
};

function TabKindIcon({ kind }) {
	const icon = KIND_ICONS[kind] || KIND_ICONS.default;
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: 14,
				height: 14,
				flexShrink: 0,
			}}
		>
			{icon}
		</span>
	);
}

function CloseIcon() {
	return (
		<svg
			viewBox="0 0 16 16"
			width="10"
			height="10"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			aria-hidden="true"
		>
			<path d="M4 4l8 8M12 4l-8 8" />
		</svg>
	);
}

function getCloseBtnStyle(showClose) {
	return {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		width: 16,
		height: 16,
		padding: 0,
		border: "none",
		borderRadius: 2,
		background: "transparent",
		color: "inherit",
		cursor: "pointer",
		opacity: showClose ? 0.75 : 0,
		pointerEvents: showClose ? "auto" : "none",
		flexShrink: 0,
	};
}

function getTabStyle(isActive, hovered) {
	const bg = isActive
		? "var(--bn-bg-editor, #1e1e1e)"
		: hovered
			? "var(--bn-bg-elevated, #1f2430)"
			: "transparent";
	const color =
		isActive || hovered
			? "var(--bn-text-primary, #e6e8ee)"
			: "var(--bn-text-secondary, #8a91a3)";
	const borderTop = isActive
		? "2px solid var(--bn-color-brand, #f5c542)"
		: "2px solid transparent";

	return {
		...BASE_TAB_STYLE,
		background: bg,
		color,
		borderTop,
	};
}

function handleTabMouseDown(e, id, onClose) {
	if (e.button === 1) {
		e.preventDefault();
		onClose?.(id);
	}
}

function handleCloseClick(e, id, onClose) {
	e.stopPropagation();
	onClose?.(id);
}

function handleDragStart(e, id) {
	e.dataTransfer.setData("text/plain", id);
	e.dataTransfer.effectAllowed = "move";
}

function handleDragOver(e) {
	e.preventDefault();
	e.dataTransfer.dropEffect = "move";
}

function handleDrop(e, targetIndex, onMove) {
	e.preventDefault();
	const sourceId = e.dataTransfer.getData("text/plain");
	if (sourceId && onMove) {
		onMove(sourceId, targetIndex);
	}
}

function EditorTabItem(props) {
	const { tab, index, activeTabId, onActivate, onClose, onMove } = props;
	const [hovered, setHovered] = useState(false);
	const isActive = tab.id === activeTabId;
	const showClose = isActive || hovered;
	const itemStyle = getTabStyle(isActive, hovered);

	const handleTabKeyDown = (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onActivate?.(tab.id);
		}
	};

	return (
		<div
			role="tab"
			tabIndex={isActive ? 0 : -1}
			aria-selected={isActive}
			title={tab.title}
			style={itemStyle}
			draggable={true}
			onClick={() => onActivate?.(tab.id)}
			onKeyDown={handleTabKeyDown}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onMouseDown={(e) => handleTabMouseDown(e, tab.id, onClose)}
			onDragStart={(e) => handleDragStart(e, tab.id)}
			onDragOver={handleDragOver}
			onDrop={(e) => handleDrop(e, index, onMove)}
		>
			<TabKindIcon kind={tab.kind} />
			<span style={TAB_TITLE_STYLE}>{tab.title}</span>
			<button
				type="button"
				aria-label={`Close ${tab.title}`}
				style={getCloseBtnStyle(showClose)}
				onClick={(e) => handleCloseClick(e, tab.id, onClose)}
			>
				<CloseIcon />
			</button>
		</div>
	);
}

function navigateTab(e, ctx) {
	e.preventDefault();
	const step = e.shiftKey ? -1 : 1;
	const nextId = nextTabId(ctx.tabs, ctx.activeTabId, step);
	if (nextId) {
		ctx.onActivate?.(nextId);
	}
}

function closeActiveTab(e, ctx) {
	e.preventDefault();
	if (ctx.activeTabId) {
		ctx.onClose?.(ctx.activeTabId);
	}
}

function handleStripKeyDown(e, ctx) {
	if (!e.ctrlKey && !e.metaKey) {
		return;
	}
	if (e.key === "Tab") {
		navigateTab(e, ctx);
		return;
	}
	if (e.key.toLowerCase() === "w" && !e.shiftKey) {
		closeActiveTab(e, ctx);
	}
}

export function EditorTabs(props) {
	const { tabs = [], activeTabId, onActivate, onClose, onMove } = props;
	const stripRef = useRef(null);

	const handleWheel = (e) => {
		if (e.deltaY && stripRef.current) {
			stripRef.current.scrollLeft += e.deltaY;
		}
	};

	const onKeyDown = (e) => {
		handleStripKeyDown(e, { tabs, activeTabId, onActivate, onClose });
	};

	return (
		<div
			ref={stripRef}
			role="tablist"
			tabIndex={0}
			style={STRIP_STYLE}
			onWheel={handleWheel}
			onKeyDown={onKeyDown}
		>
			{tabs.map((tab, index) => (
				<EditorTabItem
					key={tab.id}
					tab={tab}
					index={index}
					activeTabId={activeTabId}
					onActivate={onActivate}
					onClose={onClose}
					onMove={onMove}
				/>
			))}
		</div>
	);
}

export default EditorTabs;
