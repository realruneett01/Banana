import { SwapOutlined } from "@ant-design/icons";
import { Switch, Typography } from "antd";
import { DIFF_CONFIG } from "../sideBySideStyles.js";

const { Text } = Typography;

const TOOLBAR_CONTAINER_STYLE = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "6px 14px",
	background: "#0e0f18",
	borderBottom: "1px solid #232738",
	flexShrink: 0,
};

const SECTION_STYLE = {
	display: "flex",
	alignItems: "center",
	gap: "8px",
};

const SWAP_ICON_STYLE = {
	color: "#fadb14",
};

const HINT_STYLE = {
	color: "#a6adbb",
	fontSize: "12px",
};

const SYNC_LABEL_BASE = {
	fontSize: "11px",
	fontWeight: 600,
	marginLeft: "12px",
	userSelect: "none",
};

const SYNC_LABEL_STYLES = {
	active: { ...SYNC_LABEL_BASE, color: "#faad14" },
	inactive: { ...SYNC_LABEL_BASE, color: "#6b7280" },
};

const SWITCH_STYLES = {
	active: { background: "#faad14" },
	inactive: { background: "#3f3f46" },
};

const TRACE_CONTAINER_STYLE = {
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
};

const TRACE_LABEL_STYLE = {
	color: "#fadb14",
	fontWeight: 600,
};

const TRACE_SELECT_STYLE = {
	background: "transparent",
	border: "none",
	color: "#f1f5f9",
	fontSize: "11px",
	fontFamily: "monospace",
	cursor: "pointer",
	outline: "none",
};

const TRACE_OPTION_STYLE = {
	background: "#1e2030",
	color: "#e2e8f0",
};

const BTN_BASE_STYLE = {
	borderRadius: 4,
	padding: "2px 10px",
	fontSize: "11px",
	cursor: "pointer",
};

const FOCUS_BTN_STYLE = {
	...BTN_BASE_STYLE,
	background: "rgba(250, 219, 20, 0.15)",
	border: "1px solid #fadb14",
	color: "#fadb14",
	fontWeight: 600,
	display: "inline-flex",
	alignItems: "center",
	gap: "4px",
};

const RESET_BTN_STYLE = {
	...BTN_BASE_STYLE,
	background: "transparent",
	border: "1px solid #333",
	color: "#fadb14",
};

function SyncSection({ synced, setSynced }) {
	const hint = synced ? "(Linked Views)" : "(Independent Views)";
	const labelStyle = synced
		? SYNC_LABEL_STYLES.active
		: SYNC_LABEL_STYLES.inactive;
	const switchStyle = synced ? SWITCH_STYLES.active : SWITCH_STYLES.inactive;

	return (
		<div style={SECTION_STYLE}>
			<SwapOutlined style={SWAP_ICON_STYLE} />
			<Text style={HINT_STYLE}>Scroll to zoom · Drag to pan {hint}</Text>
			<span style={labelStyle}>Sync Views</span>
			<Switch
				size="small"
				checked={synced}
				onChange={setSynced}
				style={switchStyle}
			/>
		</div>
	);
}

function TraceWidthSelector({ selectedTraceWidth, setSelectedTraceWidth }) {
	return (
		<div style={TRACE_CONTAINER_STYLE}>
			<span style={TRACE_LABEL_STYLE}>Trace:</span>
			<select
				value={selectedTraceWidth}
				onChange={(e) => setSelectedTraceWidth(e.target.value)}
				style={TRACE_SELECT_STYLE}
			>
				{DIFF_CONFIG.TRACE_WIDTH_PRESETS.map((p) => (
					<option key={p.value} value={p.value} style={TRACE_OPTION_STYLE}>
						{p.label}
					</option>
				))}
			</select>
		</div>
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
			{activeAuditIdx !== null && (
				<button
					type="button"
					onClick={onReset}
					style={FOCUS_BTN_STYLE}
					title="Exit focused modification and restore full view (Esc)"
				>
					✕ Exit Focus (Esc)
				</button>
			)}
			<button type="button" onClick={onReset} style={RESET_BTN_STYLE}>
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
		<div style={TOOLBAR_CONTAINER_STYLE}>
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
