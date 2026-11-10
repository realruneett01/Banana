import {
	UndoOutlined,
	ZoomInOutlined,
	ZoomOutOutlined,
} from "@ant-design/icons";
import { Typography } from "antd";

const { Text } = Typography;

const BUTTON_BASE_STYLE = {
	background: "#1e2230",
	border: "1px solid #333a4d",
	color: "#cbd5e1",
	borderRadius: "4px",
	padding: "3px 8px",
	fontSize: "11px",
	cursor: "pointer",
	display: "flex",
	alignItems: "center",
	gap: "4px",
};

const PERCENT_BUTTON_STYLE = {
	color: "#fadb14",
	fontFamily: "monospace",
	minWidth: "50px",
	textAlign: "center",
};

const CENTER_RESET_STYLE = {
	padding: "3px 10px",
	marginLeft: "4px",
};

const TOOLBAR_CONTAINER_STYLE = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "6px 14px",
	background: "#0e1017",
	borderBottom: "1px solid #1e2230",
	zIndex: 20,
	flexShrink: 0,
	userSelect: "none",
};

const MODE_CONTAINER_STYLE = {
	display: "flex",
	alignItems: "center",
	gap: "8px",
};

const MODE_TITLE_STYLE = {
	color: "#cbd5e1",
	fontSize: "12px",
	fontWeight: 500,
};

const MODE_HINT_STYLE = {
	color: "#64748b",
	fontSize: "11px",
	marginLeft: "6px",
};

const ZOOM_CONTROLS_STYLE = {
	display: "flex",
	alignItems: "center",
	gap: "6px",
};

const SLIDER_DIVIDER_STYLE = {
	width: "2px",
	height: "100%",
	backgroundColor: "#fadb14",
	boxShadow: "0 0 8px rgba(250, 219, 20, 0.9)",
	pointerEvents: "none",
};

const SLIDER_KNOB_STYLE = {
	position: "absolute",
	top: "50%",
	transform: "translateY(-50%)",
	width: "24px",
	height: "24px",
	borderRadius: "50%",
	backgroundColor: "#161821",
	border: "2px solid #fadb14",
	boxShadow: "0 0 10px rgba(0,0,0,0.5), 0 0 8px rgba(250, 219, 20, 0.6)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	color: "#fadb14",
	fontSize: "11px",
	cursor: "ew-resize",
	userSelect: "none",
};

const TOOLBAR_MODES = {
	slider: {
		color: "#fadb14",
		title: "Overlay Slider Diff",
		hint: "· Drag canvas to pan · Scroll to zoom · Drag yellow line to wipe",
	},
	delta: {
		color: "#10b981",
		title: "Color Delta Map",
		hint: "· Red = Base | Green = Target · Drag to pan · Scroll to zoom",
	},
};

function getModeDotStyle(accentColor) {
	return {
		width: "8px",
		height: "8px",
		borderRadius: "50%",
		backgroundColor: accentColor,
		boxShadow: `0 0 6px ${accentColor}`,
	};
}

function getSliderHandleStyle(sliderValue) {
	return {
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
	};
}

function ZoomButton({ onClick, title, children, style = {} }) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			style={{ ...BUTTON_BASE_STYLE, ...style }}
		>
			{children}
		</button>
	);
}

function PercentResetButton({ percent, onReset }) {
	return (
		<ZoomButton
			onClick={onReset}
			title="Click to reset to 100%"
			style={PERCENT_BUTTON_STYLE}
		>
			{percent}%
		</ZoomButton>
	);
}

function CenterResetButton({ onReset }) {
	return (
		<ZoomButton
			onClick={onReset}
			title="Reset to Center (Double-click canvas)"
			style={CENTER_RESET_STYLE}
		>
			<UndoOutlined /> Reset
		</ZoomButton>
	);
}

function ModeIndicatorDot({ color }) {
	return <span style={getModeDotStyle(color)} />;
}

function ModeIndicatorText({ title, hint }) {
	return (
		<>
			<Text style={MODE_TITLE_STYLE}>{title}</Text>
			<Text style={MODE_HINT_STYLE}>{hint}</Text>
		</>
	);
}

function ToolbarModeIndicator({ isSlider }) {
	const mode = isSlider ? TOOLBAR_MODES.slider : TOOLBAR_MODES.delta;
	return (
		<div style={MODE_CONTAINER_STYLE}>
			<ModeIndicatorDot color={mode.color} />
			<ModeIndicatorText title={mode.title} hint={mode.hint} />
		</div>
	);
}

function ZoomControls({ currentZoomPercent, onZoomIn, onZoomOut, onReset }) {
	return (
		<div style={ZOOM_CONTROLS_STYLE}>
			<ZoomButton onClick={onZoomOut} title="Zoom Out (Scroll Down)">
				<ZoomOutOutlined />
			</ZoomButton>
			<PercentResetButton percent={currentZoomPercent} onReset={onReset} />
			<ZoomButton onClick={onZoomIn} title="Zoom In (Scroll Up)">
				<ZoomInOutlined />
			</ZoomButton>
			<CenterResetButton onReset={onReset} />
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
		<div style={TOOLBAR_CONTAINER_STYLE}>
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

function SliderDivider() {
	return <div style={SLIDER_DIVIDER_STYLE} />;
}

function SliderKnob() {
	return <div style={SLIDER_KNOB_STYLE}>↔</div>;
}

export function SliderSplitHandle({ sliderValue }) {
	return (
		<div
			className="diff-slider-handle"
			style={getSliderHandleStyle(sliderValue)}
		>
			<SliderDivider />
			<SliderKnob />
		</div>
	);
}
