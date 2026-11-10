import { useEffect, useRef, useState } from "react";
import { getCleanLayerName } from "./utils/auditLogUtils.js";

const ACTION_CONFIG = Object.freeze({
	CHANGED: {
		bg: "rgba(245, 158, 11, 0.18)",
		border: "rgba(245, 158, 11, 0.45)",
		color: "#fbbf24",
		label: "CHANGED",
	},
	ADDED: {
		bg: "rgba(16, 185, 129, 0.18)",
		border: "rgba(16, 185, 129, 0.45)",
		color: "#34d399",
		label: "ADDED",
	},
	DELETED: {
		bg: "rgba(244, 63, 94, 0.18)",
		border: "rgba(244, 63, 94, 0.45)",
		color: "#fb7185",
		label: "DELETED",
	},
	DEFAULT: {
		bg: "rgba(148, 163, 184, 0.18)",
		border: "rgba(148, 163, 184, 0.35)",
		color: "#cbd5e1",
		label: "MODIFIED",
	},
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

function getCardBorder(isSelected, hovered) {
	if (isSelected) return "1px solid #fadb14";
	return hovered ? "1px solid #3b4468" : "1px solid #23283e";
}

function getCardBackground(isSelected, hovered) {
	if (isSelected) {
		return "linear-gradient(135deg, rgba(250, 219, 20, 0.16) 0%, rgba(24, 29, 46, 0.98) 100%)";
	}
	return hovered ? "#1c2238" : "rgba(22, 26, 42, 0.8)";
}

function getCardShadow(isSelected, hovered) {
	if (isSelected) {
		return "0 0 14px rgba(250, 219, 20, 0.35), inset 0 0 8px rgba(250, 219, 20, 0.1)";
	}
	return hovered
		? "0 4px 10px rgba(0, 0, 0, 0.4)"
		: "0 2px 6px rgba(0, 0, 0, 0.25)";
}

function getCardStyle(isSelected, hovered) {
	return {
		padding: "10px 12px",
		borderRadius: "6px",
		border: getCardBorder(isSelected, hovered),
		background: getCardBackground(isSelected, hovered),
		boxShadow: getCardShadow(isSelected, hovered),
		cursor: "pointer",
		transition: "all 0.18s ease-in-out",
		display: "flex",
		flexDirection: "column",
		gap: "6px",
		position: "relative",
	};
}

const LAYER_CHIP_STYLE = {
	fontSize: "10px",
	fontFamily: "monospace",
	padding: "1px 6px",
	borderRadius: "4px",
	background: "#181d2f",
	border: "1px solid #28304c",
	color: "#94a3b8",
	letterSpacing: "0.02em",
};

function LayerChip({ cleanLayer }) {
	if (!cleanLayer || cleanLayer === "Unknown") {
		return null;
	}
	return <span style={LAYER_CHIP_STYLE}>{cleanLayer}</span>;
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

const FOCUSED_DOT_STYLE = {
	width: 5,
	height: 5,
	borderRadius: "50%",
	background: "#0f1015",
	display: "inline-block",
};

function FocusedBadge() {
	return (
		<span style={FOCUSED_BADGE_STYLE}>
			<span style={FOCUSED_DOT_STYLE} />
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
				({coords.x.toFixed(2)}, {coords.y.toFixed(2)}) mm
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

function ModificationCard({ item, idx, isSelected, onSelect, onHover }) {
	const cardRef = useRef(null);
	const [hovered, setHovered] = useState(false);

	useCardAutoScroll(cardRef, isSelected);

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
			<span
				style={{
					width: 8,
					height: 8,
					borderRadius: "50%",
					background: "#10b981",
					boxShadow: "0 0 8px #10b981",
					display: "inline-block",
				}}
			/>
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

function HeaderBadge({ count }) {
	const label = count === 1 ? "change" : "changes";
	return (
		<span
			style={{
				fontSize: "11px",
				fontFamily: "monospace",
				background: "#1a1f33",
				border: "1px solid #283250",
				color: "#94a3b8",
				padding: "2px 8px",
				borderRadius: "12px",
			}}
		>
			{count} {label}
		</span>
	);
}

const COLLAPSE_BTN_STYLE = {
	background: "transparent",
	border: "none",
	color: "#94a3b8",
	cursor: "pointer",
	padding: "4px",
	borderRadius: "4px",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	transition: "color 0.15s, background 0.15s",
};

function handleCollapseEnter(e) {
	e.currentTarget.style.color = "#fadb14";
	e.currentTarget.style.background = "rgba(250, 219, 20, 0.1)";
}

function handleCollapseLeave(e) {
	e.currentTarget.style.color = "#94a3b8";
	e.currentTarget.style.background = "transparent";
}

function CollapseButton({ onCollapse }) {
	if (!onCollapse) return null;
	return (
		<button
			type="button"
			onClick={onCollapse}
			title="Collapse audit sidebar"
			style={COLLAPSE_BTN_STYLE}
			onMouseEnter={handleCollapseEnter}
			onMouseLeave={handleCollapseLeave}
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

const NAV_BUTTON_STYLE = {
	background: "#1a1f33",
	border: "1px solid #283250",
	color: "#cbd5e1",
	borderRadius: "4px",
	padding: "2px 7px",
	fontSize: "11px",
	cursor: "pointer",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	lineHeight: "1.2",
};

function handleNavMouseEnter(e) {
	e.currentTarget.style.color = "#fadb14";
	e.currentTarget.style.borderColor = "#fadb14";
}

function handleNavMouseLeave(e) {
	e.currentTarget.style.color = "#cbd5e1";
	e.currentTarget.style.borderColor = "#283250";
}

function NavButton({ onClick, title, children }) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			style={NAV_BUTTON_STYLE}
			onMouseEnter={handleNavMouseEnter}
			onMouseLeave={handleNavMouseLeave}
		>
			{children}
		</button>
	);
}

const EXIT_FOCUS_STYLE = {
	background: "rgba(250, 219, 20, 0.15)",
	border: "1px solid #fadb14",
	color: "#fadb14",
	borderRadius: "4px",
	padding: "2px 8px",
	fontSize: "11px",
	fontWeight: 600,
	cursor: "pointer",
	marginLeft: "4px",
};

function handleExitFocusEnter(e) {
	e.currentTarget.style.background = "rgba(250, 219, 20, 0.28)";
}

function handleExitFocusLeave(e) {
	e.currentTarget.style.background = "rgba(250, 219, 20, 0.15)";
}

function ExitFocusButton({ visible, onClearFocus }) {
	if (!visible || !onClearFocus) return null;
	return (
		<button
			type="button"
			onClick={onClearFocus}
			title="Exit focus mode and restore full view (Esc)"
			style={EXIT_FOCUS_STYLE}
			onMouseEnter={handleExitFocusEnter}
			onMouseLeave={handleExitFocusLeave}
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
			<span
				style={{
					width: 6,
					height: 6,
					borderRadius: "50%",
					background: "#fadb14",
					boxShadow: "0 0 6px #fadb14",
					display: "inline-block",
				}}
			/>
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

function FocusController({
	modifications,
	activeDiffIdx,
	onSelectDiff,
	onClearFocus,
}) {
	const focusedIndex = findFocusedIndex(modifications, activeDiffIdx);
	const isAnyFocused = focusedIndex !== -1;

	if (modifications.length === 0) return null;

	const handlePrev = (e) => {
		const targetIdx = getPreviousIndex(focusedIndex, modifications.length);
		navigateFocus(e, { modifications, targetIdx, onSelectDiff });
	};
	const handleNext = (e) => {
		const targetIdx = getNextIndex(focusedIndex, modifications.length);
		navigateFocus(e, { modifications, targetIdx, onSelectDiff });
	};

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
