import {
	UndoOutlined,
	ZoomInOutlined,
	ZoomOutOutlined,
} from "@ant-design/icons";
import { Typography } from "antd";

const { Text } = Typography;

function getToolbarMode(isSlider) {
	if (isSlider) {
		return {
			color: "#fadb14",
			title: "Overlay Slider Diff",
			hint: "· Drag canvas to pan · Scroll to zoom · Drag yellow line to wipe",
		};
	}
	return {
		color: "#10b981",
		title: "Color Delta Map",
		hint: "· Red = Base | Green = Target · Drag to pan · Scroll to zoom",
	};
}

const ZOOM_CONFIGS = [
	["out", "Zoom Out (Scroll Down)", ZoomOutOutlined],
	[
		"percent",
		"Click to reset to 100%",
		null,
		{
			color: "#fadb14",
			fontFamily: "monospace",
			minWidth: "50px",
			textAlign: "center",
		},
	],
	["in", "Zoom In (Scroll Up)", ZoomInOutlined],
	[
		"center",
		"Reset to Center (Double-click canvas)",
		UndoOutlined,
		{ padding: "3px 10px", marginLeft: "4px" },
		" Reset",
	],
];

const makeBorder = (border, radius) => ({ border, borderRadius: radius });

function getToolbarContainerStyle() {
	return Object.assign(
		{ display: "flex", alignItems: "center", justifyContent: "space-between" },
		{
			padding: "6px 14px",
			background: "#0e1017",
			borderBottom: "1px solid #1e2230",
		},
		{ zIndex: 20, flexShrink: 0, userSelect: "none" },
	);
}

function getButtonBaseStyle(extra) {
	return Object.assign(
		{ background: "#1e2230", color: "#cbd5e1", cursor: "pointer" },
		makeBorder("1px solid #333a4d", "4px"),
		{ padding: "3px 8px", fontSize: "11px" },
		{ display: "flex", alignItems: "center", gap: "4px" },
		extra,
	);
}

function getDividerStyle() {
	return {
		width: "2px",
		height: "100%",
		backgroundColor: "#fadb14",
		boxShadow: "0 0 8px rgba(250, 219, 20, 0.9)",
		pointerEvents: "none",
	};
}

function getKnobStyle() {
	return Object.assign(
		{ position: "absolute", top: "50%", transform: "translateY(-50%)" },
		{ width: "24px", height: "24px" },
		makeBorder("2px solid #fadb14", "50%"),
		{ backgroundColor: "#161821", color: "#fadb14", fontSize: "11px" },
		{
			boxShadow: "0 0 10px rgba(0,0,0,0.5), 0 0 8px rgba(250, 219, 20, 0.6)",
		},
		{ display: "flex", alignItems: "center", justifyContent: "center" },
		{ cursor: "ew-resize", userSelect: "none" },
	);
}

function ZoomButton({ onClick, title, style, children }) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			style={getButtonBaseStyle(style)}
		>
			{children}
		</button>
	);
}

function ToolbarModeIndicator({ isSlider }) {
	const mode = getToolbarMode(isSlider);
	return (
		<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
			<span
				style={{
					width: "8px",
					height: "8px",
					borderRadius: "50%",
					backgroundColor: mode.color,
					boxShadow: `0 0 6px ${mode.color}`,
				}}
			/>
			<Text style={{ color: "#cbd5e1", fontSize: "12px", fontWeight: 500 }}>
				{mode.title}
			</Text>
			<Text style={{ color: "#64748b", fontSize: "11px", marginLeft: "6px" }}>
				{mode.hint}
			</Text>
		</div>
	);
}

function ZoomControls({ currentZoomPercent, onZoomIn, onZoomOut, onReset }) {
	const actions = {
		out: onZoomOut,
		percent: onReset,
		in: onZoomIn,
		center: onReset,
	};

	return (
		<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
			{ZOOM_CONFIGS.map(([id, title, Icon, style, label]) => (
				<ZoomButton key={id} onClick={actions[id]} title={title} style={style}>
					{Icon && <Icon />}
					{id === "percent" ? `${currentZoomPercent}%` : label}
				</ZoomButton>
			))}
		</div>
	);
}

export function CanvasTopToolbar({
	isSlider,
	currentZoomPercent,
	onZoomIn,
	onZoomOut,
	onReset,
}) {
	return (
		<div style={getToolbarContainerStyle()}>
			<ToolbarModeIndicator isSlider={isSlider} />
			<ZoomControls
				currentZoomPercent={currentZoomPercent}
				onZoomIn={onZoomIn}
				onZoomOut={onZoomOut}
				onReset={onReset}
			/>
		</div>
	);
}

export function SliderSplitHandle({ sliderValue }) {
	return (
		<div
			className="diff-slider-handle"
			style={{
				position: "absolute",
				top: 0,
				bottom: 0,
				left: `${sliderValue}%`,
				width: "14px",
				marginLeft: "-7px",
				cursor: "ew-resize",
				zIndex: 30,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<div style={getDividerStyle()} />
			<div style={getKnobStyle()}>↔</div>
		</div>
	);
}
