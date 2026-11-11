import { Alert, Button, Select, Spin, Tag } from "antd";
import { useMemo, useState } from "react";

const panelStyles = Object.freeze({
	panel: {
		display: "flex",
		flexDirection: "column",
		width: "100%",
		height: "100%",
		background: "#0f121d",
		color: "#e2e8f0",
		userSelect: "none",
		overflow: "hidden",
	},
	header: {
		display: "flex",
		flexDirection: "column",
		padding: "12px 14px",
		borderBottom: "1px solid #1e2438",
		background: "#121520",
		gap: "10px",
		flexShrink: 0,
	},
	controlsRow: {
		display: "flex",
		alignItems: "flex-end",
		gap: "10px",
		flexWrap: "wrap",
	},
	selectorGroup: {
		display: "flex",
		flexDirection: "column",
		gap: "4px",
		flex: 1,
		minWidth: "120px",
	},
	label: {
		fontSize: "11px",
		fontWeight: 700,
		textTransform: "uppercase",
		letterSpacing: "0.06em",
		color: "#94a3b8",
	},
	select: {
		width: "100%",
	},
	compareButton: {
		flexShrink: 0,
	},
	body: {
		display: "flex",
		flexDirection: "column",
		flex: 1,
		overflowY: "auto",
		padding: "12px 14px",
		gap: "14px",
	},
	spin: {
		display: "flex",
		justifyContent: "center",
		padding: "16px",
	},
	alert: {
		marginBottom: "8px",
	},
	resultsContainer: {
		display: "flex",
		flexDirection: "column",
		gap: "16px",
	},
	section: {
		display: "flex",
		flexDirection: "column",
		gap: "8px",
	},
	sectionHeader: {
		display: "flex",
		alignItems: "center",
		gap: "8px",
	},
	issueList: {
		display: "flex",
		flexDirection: "column",
		gap: "6px",
	},
	issueRow: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "8px",
		padding: "8px 10px",
		borderRadius: "6px",
		border: "1px solid #23283e",
		background: "rgba(22, 26, 42, 0.8)",
	},
	issueContent: {
		display: "flex",
		alignItems: "center",
		gap: "8px",
		flex: 1,
		minWidth: 0,
	},
	issueMessage: {
		fontSize: "12px",
		fontWeight: 600,
		color: "#f1f5f9",
		lineHeight: "1.35",
		wordBreak: "break-word",
	},
});

function formatCommitOption(commit) {
	const sha = commit?.sha ?? "";
	const shortSha = sha.slice(0, 7) || sha;
	const msg = commit?.message ? ` - ${commit.message}` : "";
	return {
		value: sha,
		label: `${shortSha}${msg}`,
	};
}

function getSeverityColor(severity) {
	const sev = (severity || "").toLowerCase();
	if (sev === "error") return "red";
	if (sev === "warning") return "orange";
	if (sev === "info") return "blue";
	return "default";
}

function CommitSelector({ id, label, value, onChange, options }) {
	return (
		<div style={panelStyles.selectorGroup}>
			<label htmlFor={id} style={panelStyles.label}>
				{label}
			</label>
			<Select
				id={id}
				aria-label={label}
				value={value}
				onChange={onChange}
				options={options}
				style={panelStyles.select}
				placeholder={`Select ${label}`}
			/>
		</div>
	);
}

function CompareControls({
	before,
	after,
	options,
	onSelectBefore,
	onSelectAfter,
	onCompare,
	disabled,
	loading,
}) {
	return (
		<div style={panelStyles.controlsRow}>
			<CommitSelector
				id="before-commit-select"
				label="Before"
				value={before}
				onChange={onSelectBefore}
				options={options}
			/>
			<CommitSelector
				id="after-commit-select"
				label="After"
				value={after}
				onChange={onSelectAfter}
				options={options}
			/>
			<Button
				type="primary"
				disabled={disabled}
				loading={loading}
				onClick={onCompare}
				style={panelStyles.compareButton}
			>
				Compare
			</Button>
		</div>
	);
}

function IssueItem({ issue, onSelectItem }) {
	const handleClick = () => onSelectItem?.(issue?.itemIds?.[0]);
	const sevColor = getSeverityColor(issue?.severity);

	return (
		<div style={panelStyles.issueRow}>
			<div style={panelStyles.issueContent}>
				<Tag color={sevColor}>{issue?.severity || "info"}</Tag>
				<span style={panelStyles.issueMessage}>{issue?.message}</span>
			</div>
			<Button
				size="small"
				onClick={handleClick}
				aria-label={`Select issue ${issue?.message ?? ""}`}
			>
				Select
			</Button>
		</div>
	);
}

function IssueSection({ title, count, color, items, onSelectItem }) {
	return (
		<section style={panelStyles.section} aria-label={title}>
			<div style={panelStyles.sectionHeader}>
				<Tag color={color}>
					<span>{title}</span>
					<span> ({count})</span>
				</Tag>
			</div>
			<div style={panelStyles.issueList}>
				{items.map((issue, idx) => (
					<IssueItem
						key={issue?.id ?? idx}
						issue={issue}
						onSelectItem={onSelectItem}
					/>
				))}
			</div>
		</section>
	);
}

async function runComparison({ api, params, setResult, setError }) {
	try {
		const res = await api.compareCommits(params);
		if (res?.ok) {
			setResult(res.data ?? { fixed: [], stillOpen: [], new: [] });
		} else {
			setError(res?.error || "Comparison failed");
		}
	} catch (err) {
		// Fallback for unexpected fetch or mock exceptions
		setError(err?.message || "Comparison failed");
	}
}

function useCompareCommits({ api, commits, envId, kind }) {
	const [selectedBefore, setSelectedBefore] = useState(null);
	const [selectedAfter, setSelectedAfter] = useState(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(null);
	const [result, setResult] = useState(null);

	const before = selectedBefore ?? commits?.[1]?.sha ?? null;
	const after = selectedAfter ?? commits?.[0]?.sha ?? null;
	const canCompare = Boolean(before && after && before !== after);

	const handleCompare = async () => {
		if (!canCompare || !api?.compareCommits) return;
		setLoading(true);
		setError(null);
		await runComparison({
			api,
			params: { before, after, envId, kind },
			setResult,
			setError,
		});
		setLoading(false);
	};

	return {
		before,
		after,
		setSelectedBefore,
		setSelectedAfter,
		canCompare,
		loading,
		error,
		result,
		handleCompare,
	};
}

function CompareResults({ result, onSelectItem }) {
	const fixed = result?.fixed ?? [];
	const stillOpen = result?.stillOpen ?? [];
	const newIssues = result?.new ?? [];

	return (
		<div style={panelStyles.resultsContainer}>
			<IssueSection
				title="Fixed"
				count={fixed.length}
				color="green"
				items={fixed}
				onSelectItem={onSelectItem}
			/>
			<IssueSection
				title="Still open"
				count={stillOpen.length}
				color="amber"
				items={stillOpen}
				onSelectItem={onSelectItem}
			/>
			<IssueSection
				title="New"
				count={newIssues.length}
				color="red"
				items={newIssues}
				onSelectItem={onSelectItem}
			/>
		</div>
	);
}

export default function CompareRunsPanel({
	api,
	commits = [],
	envId,
	kind,
	onSelectItem,
}) {
	const state = useCompareCommits({ api, commits, envId, kind });
	const options = useMemo(() => commits.map(formatCommitOption), [commits]);

	return (
		<aside style={panelStyles.panel} aria-label="Compare Simulation Runs">
			<div style={panelStyles.header}>
				<CompareControls
					before={state.before}
					after={state.after}
					options={options}
					onSelectBefore={state.setSelectedBefore}
					onSelectAfter={state.setSelectedAfter}
					onCompare={state.handleCompare}
					disabled={!state.canCompare || state.loading}
					loading={state.loading}
				/>
			</div>
			<div style={panelStyles.body}>
				{state.loading && <Spin style={panelStyles.spin} />}
				{state.error && (
					<Alert
						type="error"
						message={state.error}
						showIcon
						role="alert"
						style={panelStyles.alert}
					/>
				)}
				<CompareResults result={state.result} onSelectItem={onSelectItem} />
			</div>
		</aside>
	);
}
