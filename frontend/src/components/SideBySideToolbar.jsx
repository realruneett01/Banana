import { SwapOutlined } from "@ant-design/icons";
import { Switch, Typography } from "antd";
import { DIFF_CONFIG } from "../sideBySideStyles.js";

const { Text } = Typography;

function makeFlexRow(gap, justify) {
	const style = { display: "flex", alignItems: "center" };
	if (gap) style.gap = gap;
	if (justify) style.justifyContent = justify;
	return style;
}

function makePill(bg, border, color, gap = "6px") {
	return {
		display: "inline-flex",
		alignItems: "center",
		gap,
		padding: "2px 8px",
		borderRadius: "4px",
		background: bg,
		border: `1px solid ${border}`,
		color,
		fontSize: "11px",
		fontFamily: "monospace",
	};
}

const CONTAINER_STYLE = {
	...makeFlexRow(undefined, "space-between"),
	padding: "6px 14px",
	background: "#0e0f18",
	borderBottom: "1px solid #232738",
	flexShrink: 0,
};

const SECTION_STYLE = makeFlexRow("8px");

const SYNC_SECTION_STYLES = {
	swapIcon: { color: "#fadb14" },
	hint: { color: "#a6adbb", fontSize: "12px" },
};

const BUTTON_STYLES = {
	focus: {
		background: "rgba(250, 219, 20, 0.15)",
		border: "1px solid #fadb14",
		fontWeight: 600,
		display: "inline-flex",
		alignItems: "center",
		gap: "4px",
	},
	reset: {
		background: "transparent",
		border: "1px solid #333",
	},
};

function getButtonStyle(kind) {
	return {
		borderRadius: 4,
		padding: "2px 10px",
		fontSize: "11px",
		cursor: "pointer",
		color: "#fadb14",
		...BUTTON_STYLES[kind],
	};
}

const SYNC_VIEW_TABLE = {
	true: { hint: "(Linked Views)", color: "#faad14", switchBg: "#faad14" },
	false: { hint: "(Independent Views)", color: "#6b7280", switchBg: "#3f3f46" },
};

function getSyncMode(synced) {
	const entry = SYNC_VIEW_TABLE[Boolean(synced)];
	return {
		hint: entry.hint,
		labelStyle: {
			fontSize: "11px",
			fontWeight: 600,
			marginLeft: "12px",
			userSelect: "none",
			color: entry.color,
		},
		switchStyle: { background: entry.switchBg },
	};
}

const TRACE_STYLES = {
	container: makePill("#161823", "#2e334d", "#94a3b8"),
	label: { color: "#fadb14", fontWeight: 600 },
	select: {
		background: "transparent",
		border: "none",
		color: "#f1f5f9",
		fontSize: "11px",
		fontFamily: "monospace",
		cursor: "pointer",
		outline: "none",
	},
	option: { background: "#1e2030", color: "#e2e8f0" },
};

function SyncSection({ synced, setSynced }) {
	const mode = getSyncMode(synced);

	return (
		<div style={SECTION_STYLE}>
			<SwapOutlined style={SYNC_SECTION_STYLES.swapIcon} />
			<Text style={SYNC_SECTION_STYLES.hint}>
				Scroll to zoom · Drag to pan {mode.hint}
			</Text>
			<span style={mode.labelStyle}>Sync Views</span>
			<Switch
				size="small"
				checked={synced}
				onChange={setSynced}
				style={mode.switchStyle}
			/>
		</div>
	);
}

function TraceWidthSelector({ selectedTraceWidth, setSelectedTraceWidth }) {
	return (
		<div style={TRACE_STYLES.container}>
			<span style={TRACE_STYLES.label}>Trace:</span>
			<select
				value={selectedTraceWidth}
				onChange={(e) => setSelectedTraceWidth(e.target.value)}
				style={TRACE_STYLES.select}
			>
				{DIFF_CONFIG.TRACE_WIDTH_PRESETS.map((p) => (
					<option key={p.value} value={p.value} style={TRACE_STYLES.option}>
						{p.label}
					</option>
				))}
			</select>
		</div>
	);
}

function ExitFocusButton({ onReset }) {
	return (
		<button
			type="button"
			onClick={onReset}
			style={getButtonStyle("focus")}
			title="Exit focused modification and restore full view (Esc)"
		>
			✕ Exit Focus (Esc)
		</button>
	);
}

function ResetViewButton({ onReset }) {
	return (
		<button type="button" onClick={onReset} style={getButtonStyle("reset")}>
			Reset View
		</button>
	);
}

function ActionControls({
	selectedTraceWidth,
	setSelectedTraceWidth,
	activeAuditIdx,
	onReset,
}) {
	return (
		<div style={SECTION_STYLE}>
			<TraceWidthSelector
				selectedTraceWidth={selectedTraceWidth}
				setSelectedTraceWidth={setSelectedTraceWidth}
			/>
			{activeAuditIdx !== null && <ExitFocusButton onReset={onReset} />}
			<ResetViewButton onReset={onReset} />
		</div>
	);
}

export function SideBySideToolbar({
	synced,
	setSynced,
	selectedTraceWidth,
	setSelectedTraceWidth,
	activeAuditIdx,
	onReset,
}) {
	return (
		<div style={CONTAINER_STYLE}>
			<SyncSection synced={synced} setSynced={setSynced} />
			<ActionControls
				selectedTraceWidth={selectedTraceWidth}
				setSelectedTraceWidth={setSelectedTraceWidth}
				activeAuditIdx={activeAuditIdx}
				onReset={onReset}
			/>
		</div>
	);
}
