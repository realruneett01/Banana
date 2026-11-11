import { useEffect, useRef, useState } from "react";
import { getCleanLayerName } from "./utils/auditLogUtils.js";

function makeAction(rgb, color, label, borderAlpha = "0.45") {
	return {
		bg: `rgba(${rgb}, 0.18)`,
		border: `rgba(${rgb}, ${borderAlpha})`,
		color,
		label,
	};
}

const ACTION_CONFIG = Object.freeze({
	CHANGED: makeAction("245, 158, 11", "#fbbf24", "CHANGED"),
	ADDED: makeAction("16, 185, 129", "#34d399", "ADDED"),
	DELETED: makeAction("244, 63, 94", "#fb7185", "DELETED"),
	DEFAULT: makeAction("148, 163, 184", "#cbd5e1", "MODIFIED", "0.35"),
});

function getBadgeStyle(conf) {
	return {
		display: "inline-flex",
		alignItems: "center",
		fontSize: "10px",
		fontWeight: 700,
		letterSpacing: "0.06em",
		padding: "2px 7px",
		borderRadius: "4px",
		background: conf.bg,
		border: `1px solid ${conf.border}`,
		color: conf.color,
		textTransform: "uppercase",
		userSelect: "none",
		lineHeight: "1.2",
	};
}

function ActionBadge({ action }) {
	const normAction = (action || "").toUpperCase();
	const conf = ACTION_CONFIG[normAction] ?? ACTION_CONFIG.DEFAULT;
	return <span style={getBadgeStyle(conf)}>{conf.label}</span>;
}

function cleanDisplayTitle(item) {
	let raw = item.title || item.name || "";
	// Strip redundant leading action words since ActionBadge clearly shows it
	raw = raw.replace(/^(changed|added|deleted|modified)\s+/i, "");
	return raw || "Modification";
}

function matchesDiffIdx(itemDiffIdx, activeDiffIdx) {
	if (itemDiffIdx === undefined) {
		return false;
	}
	return String(activeDiffIdx) === String(itemDiffIdx);
}

function isDiffMatch(target, activeDiffIdx, index) {
	if (activeDiffIdx === null || activeDiffIdx === undefined) {
		return false;
	}
	if (activeDiffIdx === target.diffIdx || activeDiffIdx === index) {
		return true;
	}
	return matchesDiffIdx(target.diffIdx, activeDiffIdx);
}

function findFocusedIndex(modifications, activeDiffIdx) {
	return modifications.findIndex((m, i) => isDiffMatch(m, activeDiffIdx, i));
}

const CARD_PALETTE = {
	selected: {
		border: "1px solid #fadb14",
		background:
			"linear-gradient(135deg, rgba(250, 219, 20, 0.16) 0%, rgba(24, 29, 46, 0.98) 100%)",
		boxShadow:
			"0 0 14px rgba(250, 219, 20, 0.35), inset 0 0 8px rgba(250, 219, 20, 0.1)",
	},
	hovered: {
		border: "1px solid #3b4468",
		background: "#1c2238",
		boxShadow: "0 4px 10px rgba(0, 0, 0, 0.4)",
	},
	normal: {
		border: "1px solid #23283e",
		background: "rgba(22, 26, 42, 0.8)",
		boxShadow: "0 2px 6px rgba(0, 0, 0, 0.25)",
	},
};

function resolveCardTheme(isSelected, hovered) {
	if (isSelected) return CARD_PALETTE.selected;
	return hovered ? CARD_PALETTE.hovered : CARD_PALETTE.normal;
}

const CARD_LAYOUT = {
	padding: "10px 12px",
	borderRadius: "6px",
	cursor: "pointer",
	transition: "all 0.18s ease-in-out",
	display: "flex",
	flexDirection: "column",
	gap: "6px",
	position: "relative",
};

function getCardStyle(isSelected, hovered) {
	return {
		...CARD_LAYOUT,
		...resolveCardTheme(isSelected, hovered),
	};
}

const MONO_TAG_BASE = {
	fontFamily: "monospace",
	borderRadius: "4px",
	letterSpacing: "0.02em",
};

const LAYER_CHIP_STYLE = {
	...MONO_TAG_BASE,
	fontSize: "10px",
	padding: "1px 6px",
	background: "#181d2f",
	border: "1px solid #28304c",
	color: "#94a3b8",
};

function LayerChip({ cleanLayer }) {
	if (!cleanLayer || cleanLayer === "Unknown") {
		return null;
	}
	return <span style={LAYER_CHIP_STYLE}>{cleanLayer}</span>;
}

function IndicatorDot({ size, color, shadow = false }) {
	return (
		<span
			style={{
				width: size,
				height: size,
				borderRadius: "50%",
				background: color,
				boxShadow: shadow ? `0 0 ${size}px ${color}` : undefined,
				display: "inline-block",
			}}
		/>
	);
}

const FOCUSED_BADGE_STYLE = {
	display: "inline-flex",
	alignItems: "center",
	gap: "4px",
	fontSize: "9px",
	fontWeight: 800,
	letterSpacing: "0.05em",
	padding: "2px 6px",
	borderRadius: "4px",
	background: "#fadb14",
	color: "#0f1015",
};

function FocusedBadge() {
	return (
		<span style={FOCUSED_BADGE_STYLE}>
			<IndicatorDot size={5} color="#0f1015" />
			FOCUSED
		</span>
	);
}

function CardIndexTag({ idx, hovered }) {
	return (
		<span
			style={{
				fontSize: "10px",
				color: hovered ? "#fadb14" : "#64748b",
				transition: "color 0.15s",
			}}
		>
			#{idx + 1}
		</span>
	);
}

const FLEX_ROW_CENTER = {
	display: "flex",
	alignItems: "center",
};

const FLEX_ROW_BETWEEN = {
	...FLEX_ROW_CENTER,
	justifyContent: "space-between",
};

function CardTopRow({ item, idx, isSelected, hovered }) {
	const cleanLayer = getCleanLayerName(item.layer || item.time || "");
	return (
		<div style={{ ...FLEX_ROW_BETWEEN, gap: "6px" }}>
			<div style={{ ...FLEX_ROW_CENTER, gap: "6px" }}>
				<ActionBadge action={item.action || item.type} />
				<LayerChip cleanLayer={cleanLayer} />
			</div>
			{isSelected ? (
				<FocusedBadge />
			) : (
				<CardIndexTag idx={idx} hovered={hovered} />
			)}
		</div>
	);
}

const CARD_TEXT_BASE = {
	wordBreak: "break-word",
};

function CardTitle({ item, isSelected }) {
	return (
		<div
			style={{
				...CARD_TEXT_BASE,
				fontSize: "12px",
				fontWeight: 600,
				color: isSelected ? "#ffffff" : "#f1f5f9",
				letterSpacing: "0.01em",
				lineHeight: "1.35",
			}}
		>
			{cleanDisplayTitle(item)}
		</div>
	);
}

function CardDetail({ detail, isSelected }) {
	if (!detail) return null;
	return (
		<div
			style={{
				...CARD_TEXT_BASE,
				fontSize: "11px",
				color: isSelected ? "#cbd5e1" : "#94a3b8",
				lineHeight: "1.45",
			}}
		>
			{detail}
		</div>
	);
}

function CardCoords({ coords }) {
	if (!coords) return null;
	const { x, y } = coords;
	return (
		<div
			style={{
				...FLEX_ROW_CENTER,
				fontSize: "10px",
				fontFamily: "monospace",
				color: "#64748b",
				gap: "4px",
				marginTop: "2px",
			}}
		>
			<span>📍</span>
			<span>
				({x.toFixed(2)}, {y.toFixed(2)}) mm
			</span>
		</div>
	);
}

function useCardAutoScroll(cardRef, isSelected) {
	useEffect(() => {
		if (isSelected && cardRef.current) {
			cardRef.current.scrollIntoView({
				behavior: "smooth",
				block: "nearest",
			});
		}
	}, [isSelected, cardRef]);
}

function useCardInteractions({ item, idx, onSelect, onHover }) {
	const [hovered, setHovered] = useState(false);

	const updateHover = (state) => {
		setHovered(state);
		onHover?.(state ? (item.diffIdx ?? idx) : null);
	};

	const onKeyDown = (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onSelect?.(item, idx);
		}
	};

	return {
		hovered,
		onMouseEnter: () => updateHover(true),
		onMouseLeave: () => updateHover(false),
		onKeyDown,
	};
}

function ModificationCard({ item, idx, isSelected, onSelect, onHover }) {
	const cardRef = useRef(null);
	const { hovered, onMouseEnter, onMouseLeave, onKeyDown } =
		useCardInteractions({ item, idx, onSelect, onHover });
	useCardAutoScroll(cardRef, isSelected);
	const rowProps = { item, idx, isSelected, hovered };

	return (
		// biome-ignore lint/a11y/useSemanticElements: card holds block layout, which <button> cannot contain; role=button + Enter/Space handler is the ARIA pattern
		<div
			ref={cardRef}
			role="button"
			tabIndex={0}
			onClick={() => onSelect?.(item, idx)}
			onKeyDown={onKeyDown}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
			style={getCardStyle(isSelected, hovered)}
		>
			<CardTopRow {...rowProps} />
			<CardTitle item={item} isSelected={isSelected} />
			<CardDetail detail={item.detail} isSelected={isSelected} />
			<CardCoords coords={item.targetCoords || item.baseCoords} />
		</div>
	);
}

function HeaderTitle() {
	return (
		<div style={{ ...FLEX_ROW_CENTER, gap: "8px" }}>
			<IndicatorDot size={8} color="#10b981" shadow />
			<h3
				style={{
					margin: 0,
					fontSize: "12px",
					fontWeight: 700,
					textTransform: "uppercase",
					letterSpacing: "0.06em",
					color: "#e2e8f0",
				}}
			>
				Audit Modifications
			</h3>
		</div>
	);
}

const HEADER_BADGE_STYLE = {
	...MONO_TAG_BASE,
	fontSize: "11px",
	background: "#1a1f33",
	border: "1px solid #283250",
	color: "#94a3b8",
	padding: "2px 8px",
	borderRadius: "12px",
};

function HeaderBadge({ count }) {
	const label = count === 1 ? "change" : "changes";
	return (
		<span style={HEADER_BADGE_STYLE}>
			{count} {label}
		</span>
	);
}

const BASE_BUTTON_STYLE = {
	cursor: "pointer",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	borderRadius: "4px",
};

function makeHoverProps(hoverStyle, restStyle) {
	return {
		onMouseEnter: (e) => Object.assign(e.currentTarget.style, hoverStyle),
		onMouseLeave: (e) => Object.assign(e.currentTarget.style, restStyle),
	};
}

const BTN_CONFIG = {
	collapse: {
		base: {
			border: "none",
			padding: "4px",
			transition: "color 0.15s, background 0.15s",
		},
		rest: { color: "#94a3b8", background: "transparent" },
		hover: { color: "#fadb14", background: "rgba(250, 219, 20, 0.1)" },
	},
	nav: {
		base: {
			background: "#1a1f33",
			border: "1px solid #283250",
			padding: "2px 7px",
			fontSize: "11px",
			lineHeight: "1.2",
		},
		rest: { color: "#cbd5e1", borderColor: "#283250" },
		hover: { color: "#fadb14", borderColor: "#fadb14" },
	},
	exit: {
		base: {
			border: "1px solid #fadb14",
			color: "#fadb14",
			padding: "2px 8px",
			fontSize: "11px",
			fontWeight: 600,
			marginLeft: "4px",
		},
		rest: { background: "rgba(250, 219, 20, 0.15)" },
		hover: { background: "rgba(250, 219, 20, 0.28)" },
	},
};

function HoverButton({ variant = "nav", onClick, title, children }) {
	const cfg = BTN_CONFIG[variant];
	const style = { ...BASE_BUTTON_STYLE, ...cfg.base, ...cfg.rest };
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			style={style}
			{...makeHoverProps(cfg.hover, cfg.rest)}
		>
			{children}
		</button>
	);
}

function CollapseButton({ onCollapse }) {
	if (!onCollapse) return null;
	return (
		<HoverButton
			variant="collapse"
			onClick={onCollapse}
			title="Collapse audit sidebar"
		>
			<svg
				width="15"
				height="15"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<title>Collapse audit sidebar</title>
				<polyline points="9 18 15 12 9 6" />
			</svg>
		</HoverButton>
	);
}

function SidebarHeader({ count, onCollapse }) {
	return (
		<div
			style={{
				...FLEX_ROW_BETWEEN,
				padding: "12px 14px",
				borderBottom: "1px solid #1e2438",
				background: "#121520",
				flexShrink: 0,
			}}
		>
			<HeaderTitle />
			<div style={{ ...FLEX_ROW_CENTER, gap: "8px" }}>
				<HeaderBadge count={count} />
				<CollapseButton onCollapse={onCollapse} />
			</div>
		</div>
	);
}

function NavButton({ onClick, title, children }) {
	return (
		<HoverButton variant="nav" onClick={onClick} title={title}>
			{children}
		</HoverButton>
	);
}

function ExitFocusButton({ visible, onClearFocus }) {
	if (!visible || !onClearFocus) return null;
	return (
		<HoverButton
			variant="exit"
			onClick={onClearFocus}
			title="Exit focus mode and restore full view (Esc)"
		>
			✕ Exit Focus
		</HoverButton>
	);
}

function stepFocusIndex(focusedIndex, total, direction) {
	if (direction < 0) {
		return focusedIndex <= 0 ? total - 1 : focusedIndex - 1;
	}
	return focusedIndex < 0 || focusedIndex >= total - 1 ? 0 : focusedIndex + 1;
}

function navigateFocus(e, options) {
	e.stopPropagation();
	const { modifications, targetIdx, onSelectDiff } = options;
	if (modifications.length === 0) return;
	const targetItem = modifications[targetIdx];
	onSelectDiff?.(targetItem, targetItem.diffIdx ?? targetIdx);
}

function ActiveFocusTag({ current, total }) {
	return (
		<>
			<IndicatorDot size={6} color="#fadb14" shadow />
			<span style={{ color: "#fadb14", fontWeight: 600 }}>
				Focus: {current} of {total}
			</span>
		</>
	);
}

function FocusStatus({ isAnyFocused, focusedIndex, totalCount }) {
	return (
		<div style={{ ...FLEX_ROW_CENTER, gap: "6px" }}>
			{isAnyFocused ? (
				<ActiveFocusTag current={focusedIndex + 1} total={totalCount} />
			) : (
				<span style={{ color: "#94a3b8" }}>
					Click an item to zoom & focus on PCB
				</span>
			)}
		</div>
	);
}

function getFocusBarBg(isAnyFocused) {
	return isAnyFocused ? "rgba(250, 219, 20, 0.08)" : "#141724";
}

const FOCUS_BAR_BASE_STYLE = {
	...FLEX_ROW_BETWEEN,
	padding: "8px 12px",
	borderBottom: "1px solid #1e2438",
	fontSize: "11px",
	flexShrink: 0,
};

function FocusNavControls({ onPrev, onNext, isAnyFocused, onClearFocus }) {
	return (
		<div style={{ ...FLEX_ROW_CENTER, gap: "4px" }}>
			<NavButton onClick={onPrev} title="Previous modification (←)">
				◀
			</NavButton>
			<NavButton onClick={onNext} title="Next modification (→)">
				▶
			</NavButton>
			<ExitFocusButton visible={isAnyFocused} onClearFocus={onClearFocus} />
		</div>
	);
}

function useFocusNavigation({ modifications, focusedIndex, onSelectDiff }) {
	const step = (e, direction) => {
		const targetIdx = stepFocusIndex(
			focusedIndex,
			modifications.length,
			direction,
		);
		navigateFocus(e, { modifications, targetIdx, onSelectDiff });
	};
	return {
		handlePrev: (e) => step(e, -1),
		handleNext: (e) => step(e, 1),
	};
}

function FocusBarInner({ modifications, focusedIndex, nav, onClearFocus }) {
	const isAnyFocused = focusedIndex !== -1;
	return (
		<div
			style={{
				...FOCUS_BAR_BASE_STYLE,
				background: getFocusBarBg(isAnyFocused),
			}}
		>
			<FocusStatus
				isAnyFocused={isAnyFocused}
				focusedIndex={focusedIndex}
				totalCount={modifications.length}
			/>
			<FocusNavControls
				onPrev={nav.handlePrev}
				onNext={nav.handleNext}
				isAnyFocused={isAnyFocused}
				onClearFocus={onClearFocus}
			/>
		</div>
	);
}

function FocusController({
	modifications,
	activeDiffIdx,
	onSelectDiff,
	onClearFocus,
}) {
	const focusedIndex = findFocusedIndex(modifications, activeDiffIdx);
	const nav = useFocusNavigation({ modifications, focusedIndex, onSelectDiff });

	if (modifications.length === 0) return null;

	return (
		<FocusBarInner
			modifications={modifications}
			focusedIndex={focusedIndex}
			nav={nav}
			onClearFocus={onClearFocus}
		/>
	);
}

function EmptyModifications() {
	return (
		<div
			style={{
				textAlign: "center",
				fontSize: "12px",
				color: "#64748b",
				padding: "32px 16px",
				lineHeight: "1.6",
			}}
		>
			No semantic modifications detected between these revisions.
		</div>
	);
}

const MOD_LIST_STYLE = {
	flex: 1,
	overflowY: "auto",
	padding: "10px 12px",
	display: "flex",
	flexDirection: "column",
	gap: "8px",
};

function ModificationList({
	modifications,
	focusedIndex,
	onSelectDiff,
	onHoverDiff,
}) {
	if (modifications.length === 0) {
		return <EmptyModifications />;
	}
	return (
		<div style={MOD_LIST_STYLE}>
			{modifications.map((item, idx) => (
				<ModificationCard
					key={item.diffIdx ?? idx}
					item={item}
					idx={idx}
					isSelected={focusedIndex === idx}
					onSelect={onSelectDiff}
					onHover={onHoverDiff}
				/>
			))}
		</div>
	);
}

const SIDEBAR_STYLE = {
	width: "100%",
	height: "100%",
	background: "#0f121d",
	display: "flex",
	flexDirection: "column",
	userSelect: "none",
	overflow: "hidden",
};

export const AuditSidebar = ({
	modifications = [],
	onSelectDiff,
	activeDiffIdx,
	onHoverDiff,
	onCollapse,
	onClearFocus,
}) => {
	const focusedIndex = findFocusedIndex(modifications, activeDiffIdx);

	return (
		<aside style={SIDEBAR_STYLE}>
			<SidebarHeader count={modifications.length} onCollapse={onCollapse} />
			<FocusController
				modifications={modifications}
				activeDiffIdx={activeDiffIdx}
				onSelectDiff={onSelectDiff}
				onClearFocus={onClearFocus}
			/>
			<ModificationList
				modifications={modifications}
				focusedIndex={focusedIndex}
				onSelectDiff={onSelectDiff}
				onHoverDiff={onHoverDiff}
			/>
		</aside>
	);
};

export default AuditSidebar;
