import { useEffect, useRef, useState } from "react";
import { getCleanLayerName } from "./utils/auditLogUtils.js";

const ACTION_DEFS = {
	CHANGED: [
		"rgba(245, 158, 11, 0.18)",
		"rgba(245, 158, 11, 0.45)",
		"#fbbf24",
		"CHANGED",
	],
	ADDED: [
		"rgba(16, 185, 129, 0.18)",
		"rgba(16, 185, 129, 0.45)",
		"#34d399",
		"ADDED",
	],
	DELETED: [
		"rgba(244, 63, 94, 0.18)",
		"rgba(244, 63, 94, 0.45)",
		"#fb7185",
		"DELETED",
	],
	DEFAULT: [
		"rgba(148, 163, 184, 0.18)",
		"rgba(148, 163, 184, 0.35)",
		"#cbd5e1",
		"MODIFIED",
	],
};

const ACTION_CONFIG = Object.freeze(
	Object.fromEntries(
		Object.entries(ACTION_DEFS).map(([key, [bg, border, color, label]]) => [
			key,
			{ bg, border, color, label },
		]),
	),
);

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

function CardTopRow({ item, idx, isSelected, hovered }) {
	const cleanLayer = getCleanLayerName(item.layer || item.time || "");
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "6px",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
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

function CardTitle({ item, isSelected }) {
	const title = cleanDisplayTitle(item);
	return (
		<div
			style={{
				fontSize: "12px",
				fontWeight: 600,
				color: isSelected ? "#ffffff" : "#f1f5f9",
				letterSpacing: "0.01em",
				wordBreak: "break-word",
				lineHeight: "1.35",
			}}
		>
			{title}
		</div>
	);
}

function CardDetail({ detail, isSelected }) {
	if (!detail) return null;
	return (
		<div
			style={{
				fontSize: "11px",
				color: isSelected ? "#cbd5e1" : "#94a3b8",
				lineHeight: "1.45",
				wordBreak: "break-word",
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
				fontSize: "10px",
				fontFamily: "monospace",
				color: "#64748b",
				display: "flex",
				alignItems: "center",
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

	const handleMouseEnter = () => {
		setHovered(true);
		onHover?.(item.diffIdx ?? idx);
	};

	const handleMouseLeave = () => {
		setHovered(false);
		onHover?.(null);
	};

	const handleKeyDown = (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onSelect?.(item, idx);
		}
	};

	return { hovered, handleMouseEnter, handleMouseLeave, handleKeyDown };
}

function ModificationCard({ item, idx, isSelected, onSelect, onHover }) {
	const cardRef = useRef(null);
	const { hovered, handleMouseEnter, handleMouseLeave, handleKeyDown } =
		useCardInteractions({ item, idx, onSelect, onHover });

	useCardAutoScroll(cardRef, isSelected);

	return (
		// biome-ignore lint/a11y/useSemanticElements: card holds block layout, which <button> cannot contain; role=button + Enter/Space handler is the ARIA pattern
		<div
			ref={cardRef}
			role="button"
			tabIndex={0}
			onClick={() => onSelect?.(item, idx)}
			onKeyDown={handleKeyDown}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
			style={getCardStyle(isSelected, hovered)}
		>
			<CardTopRow
				item={item}
				idx={idx}
				isSelected={isSelected}
				hovered={hovered}
			/>
			<CardTitle item={item} isSelected={isSelected} />
			<CardDetail detail={item.detail} isSelected={isSelected} />
			<CardCoords coords={item.targetCoords || item.baseCoords} />
		</div>
	);
}

function HeaderTitle() {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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

const COLLAPSE_REST = { color: "#94a3b8", background: "transparent" };
const COLLAPSE_HOVER = {
	color: "#fadb14",
	background: "rgba(250, 219, 20, 0.1)",
};
const COLLAPSE_BTN_STYLE = {
	...BASE_BUTTON_STYLE,
	border: "none",
	padding: "4px",
	transition: "color 0.15s, background 0.15s",
	...COLLAPSE_REST,
};

function CollapseButton({ onCollapse }) {
	if (!onCollapse) return null;
	return (
		<button
			type="button"
			onClick={onCollapse}
			title="Collapse audit sidebar"
			style={COLLAPSE_BTN_STYLE}
			{...makeHoverProps(COLLAPSE_HOVER, COLLAPSE_REST)}
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
		</button>
	);
}

function SidebarHeader({ count, onCollapse }) {
	return (
		<div
			style={{
				padding: "12px 14px",
				borderBottom: "1px solid #1e2438",
				background: "#121520",
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				flexShrink: 0,
			}}
		>
			<HeaderTitle />
			<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
				<HeaderBadge count={count} />
				<CollapseButton onCollapse={onCollapse} />
			</div>
		</div>
	);
}

const NAV_REST = { color: "#cbd5e1", borderColor: "#283250" };
const NAV_HOVER = { color: "#fadb14", borderColor: "#fadb14" };
const NAV_BUTTON_STYLE = {
	...BASE_BUTTON_STYLE,
	background: "#1a1f33",
	border: "1px solid #283250",
	padding: "2px 7px",
	fontSize: "11px",
	lineHeight: "1.2",
	...NAV_REST,
};

function NavButton({ onClick, title, children }) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			style={NAV_BUTTON_STYLE}
			{...makeHoverProps(NAV_HOVER, NAV_REST)}
		>
			{children}
		</button>
	);
}

const EXIT_FOCUS_REST = { background: "rgba(250, 219, 20, 0.15)" };
const EXIT_FOCUS_HOVER = { background: "rgba(250, 219, 20, 0.28)" };
const EXIT_FOCUS_STYLE = {
	...BASE_BUTTON_STYLE,
	border: "1px solid #fadb14",
	color: "#fadb14",
	padding: "2px 8px",
	fontSize: "11px",
	fontWeight: 600,
	marginLeft: "4px",
	...EXIT_FOCUS_REST,
};

function ExitFocusButton({ visible, onClearFocus }) {
	if (!visible || !onClearFocus) return null;
	return (
		<button
			type="button"
			onClick={onClearFocus}
			title="Exit focus mode and restore full view (Esc)"
			style={EXIT_FOCUS_STYLE}
			{...makeHoverProps(EXIT_FOCUS_HOVER, EXIT_FOCUS_REST)}
		>
			✕ Exit Focus
		</button>
	);
}

function getPreviousIndex(focusedIndex, total) {
	return focusedIndex <= 0 ? total - 1 : focusedIndex - 1;
}

function getNextIndex(focusedIndex, total) {
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
		<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
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
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "8px 12px",
	borderBottom: "1px solid #1e2438",
	fontSize: "11px",
	flexShrink: 0,
};

function FocusNavControls({ onPrev, onNext, isAnyFocused, onClearFocus }) {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
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
	const handlePrev = (e) => {
		const targetIdx = getPreviousIndex(focusedIndex, modifications.length);
		navigateFocus(e, { modifications, targetIdx, onSelectDiff });
	};
	const handleNext = (e) => {
		const targetIdx = getNextIndex(focusedIndex, modifications.length);
		navigateFocus(e, { modifications, targetIdx, onSelectDiff });
	};
	return { handlePrev, handleNext };
}

function FocusController({
	modifications,
	activeDiffIdx,
	onSelectDiff,
	onClearFocus,
}) {
	const focusedIndex = findFocusedIndex(modifications, activeDiffIdx);
	const isAnyFocused = focusedIndex !== -1;

	const { handlePrev, handleNext } = useFocusNavigation({
		modifications,
		focusedIndex,
		onSelectDiff,
	});

	if (modifications.length === 0) return null;

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
				onPrev={handlePrev}
				onNext={handleNext}
				isAnyFocused={isAnyFocused}
				onClearFocus={onClearFocus}
			/>
		</div>
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
