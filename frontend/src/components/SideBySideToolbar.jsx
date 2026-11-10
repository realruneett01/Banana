import { SwapOutlined } from "@ant-design/icons";
import { Switch, Typography } from "antd";
import { DIFF_CONFIG } from "../sideBySideStyles.js";

const { Text } = Typography;

const TOOLBAR_STYLES = {
	container: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		padding: "6px 14px",
		background: "#0e0f18",
		borderBottom: "1px solid #232738",
		flexShrink: 0,
	},
	section: {
		display: "flex",
		alignItems: "center",
		gap: "8px",
	},
	swapIcon: {
		color: "#fadb14",
	},
	hint: {
		color: "#a6adbb",
		fontSize: "12px",
	},
	traceContainer: {
		background: "#161823",
		border: "1px solid #2e334d",
		color: "#94a3b8",
		fontSize: "11px",
		padding: "2px 8px",
		borderRadius: "4px",
		fontFamily: "monospace",
		display: "inline-flex",
		alignItems: "center",
		gap: "6px",
	},
	traceLabel: {
		color: "#fadb14",
		fontWeight: 600,
	},
	traceSelect: {
		background: "transparent",
		border: "none",
		color: "#f1f5f9",
		fontSize: "11px",
		fontFamily: "monospace",
		cursor: "pointer",
		outline: "none",
	},
	traceOption: {
		background: "#1e2030",
		color: "#e2e8f0",
	},
	focusBtn: {
		borderRadius: 4,
		padding: "2px 10px",
		fontSize: "11px",
		cursor: "pointer",
		background: "rgba(250, 219, 20, 0.15)",
		border: "1px solid #fadb14",
		color: "#fadb14",
		fontWeight: 600,
		display: "inline-flex",
		alignItems: "center",
		gap: "4px",
	},
	resetBtn: {
		borderRadius: 4,
		padding: "2px 10px",
		fontSize: "11px",
		cursor: "pointer",
		background: "transparent",
		border: "1px solid #333",
		color: "#fadb14",
	},
};

const SYNC_MODES = {
	true: {
		hint: "(Linked Views)",
		labelStyle: {
			fontSize: "11px",
			fontWeight: 600,
			marginLeft: "12px",
			userSelect: "none",
			color: "#faad14",
		},
		switchStyle: { background: "#faad14" },
	},
	false: {
		hint: "(Independent Views)",
		labelStyle: {
			fontSize: "11px",
			fontWeight: 600,
			marginLeft: "12px",
			userSelect: "none",
			color: "#6b7280",
		},
		switchStyle: { background: "#3f3f46" },
	},
};

function SyncSection({ synced, setSynced }) {
	const mode = SYNC_MODES[Boolean(synced)];

	return (
		<div style={TOOLBAR_STYLES.section}>
			<SwapOutlined style={TOOLBAR_STYLES.swapIcon} />
			<Text style={TOOLBAR_STYLES.hint}>
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
		<div style={TOOLBAR_STYLES.traceContainer}>
			<span style={TOOLBAR_STYLES.traceLabel}>Trace:</span>
			<select
				value={selectedTraceWidth}
				onChange={(e) => setSelectedTraceWidth(e.target.value)}
				style={TOOLBAR_STYLES.traceSelect}
			>
				{DIFF_CONFIG.TRACE_WIDTH_PRESETS.map((p) => (
					<option
						key={p.value}
						value={p.value}
						style={TOOLBAR_STYLES.traceOption}
					>
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
			style={TOOLBAR_STYLES.focusBtn}
			title="Exit focused modification and restore full view (Esc)"
		>
			✕ Exit Focus (Esc)
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
		<div style={TOOLBAR_STYLES.section}>
			<TraceWidthSelector
				selectedTraceWidth={selectedTraceWidth}
				setSelectedTraceWidth={setSelectedTraceWidth}
			/>
			{activeAuditIdx !== null && <ExitFocusButton onReset={onReset} />}
			<button type="button" onClick={onReset} style={TOOLBAR_STYLES.resetBtn}>
				Reset View
			</button>
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
		<div style={TOOLBAR_STYLES.container}>
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
