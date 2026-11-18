import {
	BAR_CONTAINER_BASE_STYLE,
	BASE_INTERACTIVE_STYLE,
	BarButton,
	BarIcon,
	resolveAriaLabel,
} from "./barButton.jsx";

export function segmentToneColor(tone) {
	if (!tone || typeof tone !== "string") {
		return "var(--bn-text-secondary, #8a91a3)";
	}
	const toneMap = {
		warning: "var(--bn-color-warning, #faad14)",
		error: "var(--bn-color-error, #f0606a)",
		success: "var(--bn-color-success, #3dd68c)",
	};
	return toneMap[tone.toLowerCase()] || "var(--bn-text-secondary, #8a91a3)";
}

function resolveSegmentColor(segment, isFirstLeft) {
	if (segment.tone && segment.tone !== "default") {
		return segmentToneColor(segment.tone);
	}
	if (isFirstLeft) {
		return "var(--bn-color-brand, #f5c542)";
	}
	return segmentToneColor(segment.tone);
}

function resolveSegmentBackground(isFirstLeft) {
	if (isFirstLeft) {
		return "var(--bn-accent-soft, rgba(245, 197, 66, 0.2))";
	}
	return "transparent";
}

const STATUS_SEGMENT_STYLE = {
	...BASE_INTERACTIVE_STYLE,
	display: "inline-flex",
	alignItems: "center",
	gap: 4,
	height: "100%",
	padding: "0 8px",
	fontSize: "var(--bn-type-status, 11px)",
	lineHeight: "var(--bn-status-bar-h, 22px)",
};

function getSegmentStyle(segment, isFirstLeft, isClickable) {
	return {
		...STATUS_SEGMENT_STYLE,
		background: resolveSegmentBackground(isFirstLeft),
		color: resolveSegmentColor(segment, isFirstLeft),
		cursor: isClickable ? "pointer" : "default",
	};
}

function getSegmentClassName(isClickable, isFirstLeft) {
	let cls = "bn-status-segment";
	if (isClickable) cls += " bn-status-btn";
	if (isFirstLeft) cls += " is-brand-tinted";
	return cls;
}

// Clickable segments render as <button with aria-label and onClick via BarButton
function StatusSegment({ segment, isFirstLeft }) {
	if (!segment) return null;
	const isClickable = typeof segment.onClick === "function";
	const style = getSegmentStyle(segment, isFirstLeft, isClickable);
	const className = getSegmentClassName(isClickable, isFirstLeft);

	return (
		<BarButton
			as={isClickable ? "button" : "span"}
			className={className}
			style={style}
			aria-label={resolveAriaLabel(segment)}
			tooltip={segment.tooltip}
			tooltipPlacement="top"
			onClick={segment.onClick}
		>
			<BarIcon icon={segment.icon} size={12} />
			{segment.text && <span>{segment.text}</span>}
		</BarButton>
	);
}

function renderSegment(segment, index, isLeft) {
	const id = segment.id || (isLeft ? `l-${index}` : `r-${index}`);
	return (
		<StatusSegment
			key={id}
			segment={segment}
			isFirstLeft={isLeft && index === 0}
		/>
	);
}

function StatusGroup({ items, isLeft }) {
	const className = isLeft ? "bn-status-group-left" : "bn-status-group-right";
	return (
		<div
			className={className}
			style={{ display: "flex", alignItems: "center", height: "100%" }}
		>
			{items.map((seg, idx) => renderSegment(seg, idx, isLeft))}
		</div>
	);
}

const BAR_FOOTER_STYLE = {
	...BAR_CONTAINER_BASE_STYLE,
	height: "var(--bn-status-bar-h, 22px)",
	minHeight: "var(--bn-status-bar-h, 22px)",
	width: "100%",
	borderTop: "1px solid var(--bn-border-subtle, #232836)",
	fontSize: "var(--bn-type-status, 11px)",
	lineHeight: "var(--bn-status-bar-h, 22px)",
	overflow: "hidden",
};

export function StatusBar({ left = [], right = [] }) {
	return (
		<footer
			className="bn-status-bar"
			role="status"
			aria-label="Status Bar"
			style={BAR_FOOTER_STYLE}
		>
			<StatusGroup items={left} isLeft={true} />
			<StatusGroup items={right} isLeft={false} />
		</footer>
	);
}

export default StatusBar;
