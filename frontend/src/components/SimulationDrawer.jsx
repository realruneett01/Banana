import { CloseOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Empty, Select, Spin, Tabs, Tag } from "antd";
import { useMemo } from "react";
import { API_BASE_URL } from "../config.js";
import { createSimApi } from "../simApi.js";
import CompareRunsPanel from "./CompareRunsPanel.jsx";
import EnvironmentEditor from "./EnvironmentEditor.jsx";
import IssuesPanel from "./IssuesPanel.jsx";
import { useRunCommits } from "./runCommits.js";
import { useSimulation } from "./useSimulation.js";

// --- Pure panel chrome helpers ---
export function panelChrome({ inline = false, title, onClose } = {}) {
	const isInline = Boolean(inline);
	return {
		isInline,
		wrapper: isInline ? "inline" : "drawer",
		showHeader: Boolean(title || (isInline && onClose)),
		showClose: Boolean(onClose),
		headerHeight: isInline ? 30 : undefined,
	};
}
// --- End pure panel chrome helpers ---

const TEXT_COLOR = "#e2e8f0";
const PANEL_BORDER = "1px solid #1e2438";

const flexColumn = (gap, extra) =>
	Object.freeze({ display: "flex", flexDirection: "column", gap, ...extra });

const flexRowCentered = (extra) =>
	Object.freeze({
		display: "flex",
		alignItems: "center",
		gap: "8px",
		...extra,
	});

const buttonStyle = (background, borderColor, color, fontWeight) =>
	Object.freeze({ background, borderColor, color, fontWeight });

const DRAWER_STYLES = Object.freeze({
	header: {
		background: "#121520",
		borderBottom: PANEL_BORDER,
		padding: "12px 16px",
		color: TEXT_COLOR,
	},
	body: flexColumn("14px", {
		background: "#0f121d",
		padding: "14px",
		color: TEXT_COLOR,
		overflowY: "auto",
	}),
});

const INLINE_CONTAINER_STYLE = Object.freeze({
	height: "100%",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	background: "#0f121d",
});

const INLINE_HEADER_STYLE = Object.freeze({
	height: "30px",
	minHeight: "30px",
	maxHeight: "30px",
	boxSizing: "border-box",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "0 10px",
	background: "#121520",
	borderBottom: PANEL_BORDER,
	color: TEXT_COLOR,
});

const INLINE_TITLE_STYLE = Object.freeze({
	fontSize: "12px",
	fontWeight: 700,
	color: TEXT_COLOR,
	lineHeight: "30px",
});

const INLINE_BODY_STYLE = flexColumn("14px", {
	flex: 1,
	minHeight: 0,
	background: "#0f121d",
	padding: "14px",
	color: TEXT_COLOR,
	overflowY: "auto",
});

const CARD_STYLE = flexColumn("10px", {
	background: "rgba(22, 26, 42, 0.8)",
	border: "1px solid #23283e",
	borderRadius: "8px",
	padding: "12px",
});

const ROW_STYLE = flexRowCentered({ flexWrap: "wrap" });

const TITLE_STYLE = flexRowCentered({
	fontSize: "12px",
	fontWeight: 700,
	textTransform: "uppercase",
	letterSpacing: "0.06em",
	color: TEXT_COLOR,
});

const STATUS_DOT_STYLE = Object.freeze({
	width: 8,
	height: 8,
	borderRadius: "50%",
	background: "#10b981",
	boxShadow: "0 0 8px #10b981",
	display: "inline-block",
});

const REASON_STYLE = Object.freeze({
	fontSize: "11px",
	color: "#fbbf24",
	background: "#1c1917",
	border: "1px solid #78350f",
	borderRadius: "4px",
	padding: "4px 8px",
});

const PRIMARY_BTN_STYLE = buttonStyle("#fadb14", "#fadb14", "#0f1015", 700);

const SECONDARY_BTN_STYLE = buttonStyle("#1a1f33", "#283250", "#cbd5e1", 600);

const PANEL_WRAPPER_STYLE = flexColumn(undefined, {
	height: "360px",
	border: PANEL_BORDER,
	borderRadius: "8px",
	overflow: "hidden",
	flexShrink: 0,
});

const RUN_TAB_STYLE = flexColumn("14px");

function createEnvId() {
	return `env_${crypto.randomUUID()}`;
}

function computeDuration(run) {
	if (!run?.startedAt || !run?.finishedAt) return null;
	const diffMs = new Date(run.finishedAt) - new Date(run.startedAt);
	if (Number.isNaN(diffMs) || diffMs < 0) return null;
	return diffMs < 1000 ? `${diffMs}ms` : `${(diffMs / 1000).toFixed(2)}s`;
}

function toOption(item) {
	if (typeof item === "object" && item !== null) {
		const val = item.id ?? item.value ?? item.key;
		return { value: val, label: item.label ?? item.name ?? val };
	}
	return { value: String(item), label: String(item) };
}

function getSimReason(status, commit, env, kind) {
	if (status === "running") return "Simulation is running";
	if (!commit) return "Commit required to run simulation";
	if (!env?.id) return "Save an environment above to enable simulation";
	if (!kind) return "Select a simulation kind";
	return "";
}

function getErcReason(status, commit) {
	if (status === "running") return "Check is running";
	if (!commit) return "Commit required to run ERC";
	return "";
}

function KindPicker({ kinds, kind, onChange, disabled }) {
	const options = kinds.map(toOption);
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
			<label
				htmlFor="sim-kind-select"
				style={{ fontSize: "11px", color: "#94a3b8" }}
			>
				Simulation Kind
			</label>
			<Select
				id="sim-kind-select"
				aria-label="Simulation kind"
				value={kind || undefined}
				onChange={onChange}
				options={options}
				placeholder="Select kind..."
				disabled={disabled}
				style={{ width: "100%" }}
			/>
		</div>
	);
}

function RunningStatus({ onCancel }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: "8px",
				marginLeft: "auto",
			}}
		>
			<Spin size="small" aria-label="Loading simulation" />
			<Button
				danger
				size="small"
				onClick={onCancel}
				aria-label="Cancel simulation"
			>
				Cancel
			</Button>
		</div>
	);
}

function RunSimButton({ onClick, reason }) {
	return (
		<Button
			type="primary"
			onClick={onClick}
			disabled={Boolean(reason)}
			title={reason || "Run simulation"}
			aria-label="Run simulation"
			style={PRIMARY_BTN_STYLE}
		>
			Run simulation
		</Button>
	);
}

function RunErcButton({ onClick, reason }) {
	return (
		<Button
			onClick={onClick}
			disabled={Boolean(reason)}
			title={reason || "Run ERC"}
			aria-label="Run ERC"
			style={SECONDARY_BTN_STYLE}
		>
			Run ERC
		</Button>
	);
}

function ControlActions({
	onRunSim,
	onRunErc,
	onCancel,
	status,
	simReason,
	ercReason,
}) {
	return (
		<div style={ROW_STYLE}>
			<RunSimButton onClick={onRunSim} reason={simReason} />
			<RunErcButton onClick={onRunErc} reason={ercReason} />
			{status === "running" ? <RunningStatus onCancel={onCancel} /> : null}
		</div>
	);
}

function ReasonNotice({ simReason, ercReason }) {
	const reason = simReason || ercReason;
	if (!reason) return null;
	return (
		<div style={REASON_STYLE} role="status" aria-live="polite">
			⚠️ {reason}
		</div>
	);
}

function SimulationControls({ sim, simReason, ercReason }) {
	return (
		<section style={CARD_STYLE} aria-label="Simulation Controls">
			<KindPicker
				kinds={sim.kinds}
				kind={sim.kind}
				onChange={sim.setKind}
				disabled={sim.status === "running"}
			/>
			<ControlActions
				onRunSim={sim.runSelected}
				onRunErc={sim.runErc}
				onCancel={sim.cancel}
				status={sim.status}
				simReason={simReason}
				ercReason={ercReason}
			/>
			{sim.status !== "running" ? (
				<ReasonNotice simReason={simReason} ercReason={ercReason} />
			) : null}
		</section>
	);
}

function RunSummary({ run }) {
	if (!run) return null;
	const duration = computeDuration(run);
	const tagColor = run.status === "failed" ? "red" : "green";
	return (
		<section style={CARD_STYLE} aria-label="Run summary">
			<div style={TITLE_STYLE}>
				<span style={STATUS_DOT_STYLE} />
				<span>Run Summary</span>
			</div>
			<div style={ROW_STYLE}>
				<span>
					Kind: <strong>{run.kind}</strong>
				</span>
				<span>
					Status: <Tag color={tagColor}>{run.status}</Tag>
				</span>
				{duration ? (
					<span>
						Duration: <strong>{duration}</strong>
					</span>
				) : null}
			</div>
		</section>
	);
}

function ErrorAlert({ error }) {
	if (!error) return null;
	return <Alert type="error" message={error} showIcon closable role="alert" />;
}

function DrawerBody({ sim, commit, onSelectItem }) {
	const simReason = getSimReason(sim.status, commit, sim.env, sim.kind);
	const ercReason = getErcReason(sim.status, commit);
	return (
		<>
			<div style={PANEL_WRAPPER_STYLE}>
				<EnvironmentEditor
					value={sim.env}
					onSave={sim.setEnv}
					newId={createEnvId}
				/>
			</div>
			<SimulationControls
				sim={sim}
				simReason={simReason}
				ercReason={ercReason}
			/>
			<ErrorAlert error={sim.error} />
			<RunSummary run={sim.run} />
			<div style={PANEL_WRAPPER_STYLE}>
				<IssuesPanel
					issues={sim.issues}
					onSelectItem={onSelectItem}
					onChangeStatus={sim.setIssueStatus}
				/>
			</div>
		</>
	);
}

function CompareTab({ api, envId, kind, onSelectItem, commits }) {
	if (!Array.isArray(commits) || commits.length < 2) {
		return (
			<Empty description="Run the simulation on at least two commits to compare them" />
		);
	}
	return (
		<CompareRunsPanel
			api={api}
			envId={envId}
			kind={kind}
			onSelectItem={onSelectItem}
			commits={commits}
		/>
	);
}

function buildTabItems({ sim, commit, commits, onSelectItem, api }) {
	return [
		{
			key: "run",
			label: "Run",
			children: (
				<div style={RUN_TAB_STYLE}>
					<DrawerBody sim={sim} commit={commit} onSelectItem={onSelectItem} />
				</div>
			),
		},
		{
			key: "compare",
			label: "Compare commits",
			children: (
				<CompareTab
					api={api}
					envId={sim.env?.id}
					kind={sim.kind}
					onSelectItem={onSelectItem}
					commits={commits}
				/>
			),
		},
	];
}

function resolveCommits(commits, fallback) {
	if (Array.isArray(commits) && commits.length > 0) {
		return commits;
	}
	return fallback;
}

function SimulationContent({ items }) {
	return <Tabs defaultActiveKey="run" items={items} />;
}

function SimInlineHeader({ onClose }) {
	return (
		<div style={INLINE_HEADER_STYLE}>
			<span style={INLINE_TITLE_STYLE}>Simulate</span>
			{onClose && (
				<Button
					type="text"
					size="small"
					icon={<CloseOutlined />}
					onClick={onClose}
					style={{ color: "#a6adbb" }}
					aria-label="Close"
				/>
			)}
		</div>
	);
}

function SimulationInlineView({ items, onClose, chrome }) {
	return (
		<div style={INLINE_CONTAINER_STYLE}>
			{chrome.showHeader && <SimInlineHeader onClose={onClose} />}
			<div style={INLINE_BODY_STYLE}>
				<SimulationContent items={items} />
			</div>
		</div>
	);
}

function SimulationDrawerView({ items, open, onClose }) {
	return (
		<Drawer
			title="Simulate"
			placement="right"
			size={520}
			open={open}
			onClose={onClose}
			styles={DRAWER_STYLES}
			className="bn-drawer"
		>
			<SimulationContent items={items} />
		</Drawer>
	);
}

export default function SimulationDrawer({
	open,
	onClose,
	ir,
	commit,
	commits,
	onSelectItem,
	api: apiProp,
	inline = false,
}) {
	const api = useMemo(
		() => apiProp ?? createSimApi({ baseUrl: API_BASE_URL }),
		[apiProp],
	);
	const sim = useSimulation({ api, ir, commit });
	const isOpen = inline || open;
	const fetched = useRunCommits({ api, open: isOpen });
	const activeCommits = resolveCommits(commits, fetched);
	const items = buildTabItems({
		sim,
		commit,
		commits: activeCommits,
		onSelectItem,
		api,
	});
	const chrome = panelChrome({ inline, title: "Simulate", onClose });

	if (chrome.isInline) {
		return (
			<SimulationInlineView items={items} onClose={onClose} chrome={chrome} />
		);
	}

	return <SimulationDrawerView items={items} open={open} onClose={onClose} />;
}
