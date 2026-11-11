import { Collapse, Empty, Segmented, Select, Tag } from "antd";
import { useState } from "react";
import {
	filterIssues,
	formatMeasured,
	groupIssues,
	issueSummary,
} from "./issuesModel.js";

const SOURCE_OPTIONS = ["All", "DRC", "ERC", "Sim"];

const STATUS_OPTIONS = [
	{ value: "open", label: "Open" },
	{ value: "fixed", label: "Fixed" },
	{ value: "wontfix", label: "Won't fix" },
];

const SEVERITY_CONFIG = Object.freeze({
	error: { label: "Errors", color: "#fb7185" },
	warning: { label: "Warnings", color: "#fbbf24" },
	info: { label: "Info", color: "#38bdf8" },
});

const PANEL_STYLE = Object.freeze({
	width: "100%",
	height: "100%",
	background: "#0f121d",
	display: "flex",
	flexDirection: "column",
	userSelect: "none",
	overflow: "hidden",
});

const HEADER_STYLE = Object.freeze({
	padding: "12px 14px",
	borderBottom: "1px solid #1e2438",
	background: "#121520",
	display: "flex",
	flexDirection: "column",
	gap: "10px",
	flexShrink: 0,
});

const HEADER_TOP_ROW_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: "8px",
});

const TITLE_CONTAINER_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	gap: "8px",
});

const TITLE_DOT_STYLE = Object.freeze({
	width: 8,
	height: 8,
	borderRadius: "50%",
	background: "#10b981",
	boxShadow: "0 0 8px #10b981",
	display: "inline-block",
});

const TITLE_STYLE = Object.freeze({
	margin: 0,
	fontSize: "12px",
	fontWeight: 700,
	textTransform: "uppercase",
	letterSpacing: "0.06em",
	color: "#e2e8f0",
});

const TAGS_CONTAINER_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	gap: "4px",
	flexWrap: "wrap",
});

const BODY_STYLE = Object.freeze({
	flex: 1,
	overflowY: "auto",
	padding: "10px 12px",
	display: "flex",
	flexDirection: "column",
	gap: "8px",
});

const EMPTY_CONTAINER_STYLE = Object.freeze({
	padding: "32px 16px",
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
});

const ROW_CONTAINER_STYLE = Object.freeze({
	display: "flex",
	alignItems: "flex-start",
	justifyContent: "space-between",
	gap: "8px",
	padding: "8px 10px",
	borderRadius: "6px",
	border: "1px solid #23283e",
	background: "rgba(22, 26, 42, 0.8)",
	marginBottom: "6px",
});

const ROW_BTN_STYLE = Object.freeze({
	flex: 1,
	display: "flex",
	flexDirection: "column",
	alignItems: "flex-start",
	gap: "4px",
	background: "transparent",
	border: "none",
	padding: 0,
	margin: 0,
	cursor: "pointer",
	textAlign: "left",
	color: "inherit",
	font: "inherit",
});

const MESSAGE_STYLE = Object.freeze({
	fontSize: "12px",
	fontWeight: 600,
	color: "#f1f5f9",
	lineHeight: "1.35",
	wordBreak: "break-word",
});

const MEASURED_STYLE = Object.freeze({
	fontSize: "11px",
	fontFamily: "monospace",
	color: "#fbbf24",
	background: "#181d2f",
	border: "1px solid #28304c",
	borderRadius: "4px",
	padding: "1px 6px",
});

const SUGGESTION_STYLE = Object.freeze({
	fontSize: "11px",
	color: "#94a3b8",
	lineHeight: "1.4",
	wordBreak: "break-word",
});

const SELECT_STYLE = Object.freeze({
	width: 96,
	flexShrink: 0,
});

const GROUP_LIST_STYLE = Object.freeze({
	display: "flex",
	flexDirection: "column",
});

function normalizeSource(val) {
	if (!val) return "All";
	const match = SOURCE_OPTIONS.find(
		(opt) => opt.toLowerCase() === val.toLowerCase(),
	);
	return match ?? val;
}

function IssueRow({ issue, onSelectItem, onChangeStatus }) {
	const measured = formatMeasured(issue);
	const handleSelect = () => onSelectItem?.(issue?.itemIds?.[0], issue);
	const handleStatus = (val) => onChangeStatus?.(issue?.id, val);

	return (
		<div style={ROW_CONTAINER_STYLE}>
			<button type="button" onClick={handleSelect} style={ROW_BTN_STYLE}>
				<span style={MESSAGE_STYLE}>{issue?.message}</span>
				{measured ? <span style={MEASURED_STYLE}>{measured}</span> : null}
				{issue?.suggestion ? (
					<span style={SUGGESTION_STYLE}>{issue.suggestion}</span>
				) : null}
			</button>
			<Select
				size="small"
				value={issue?.status ?? "open"}
				onChange={handleStatus}
				options={STATUS_OPTIONS}
				style={SELECT_STYLE}
			/>
		</div>
	);
}

function IssueGroupList({ items, onSelectItem, onChangeStatus }) {
	return (
		<div style={GROUP_LIST_STYLE}>
			{items.map((issue) => (
				<IssueRow
					key={issue.id}
					issue={issue}
					onSelectItem={onSelectItem}
					onChangeStatus={onChangeStatus}
				/>
			))}
		</div>
	);
}

function getSeverityHeader(group) {
	const conf = SEVERITY_CONFIG[group.severity] ?? {
		label: group.severity,
		color: "#cbd5e1",
	};
	return (
		<span style={{ fontSize: "12px", fontWeight: 700, color: conf.color }}>
			{conf.label} ({group.items.length})
		</span>
	);
}

function buildCollapseItems(groups, onSelectItem, onChangeStatus) {
	return groups.map((group) => ({
		key: group.severity,
		label: getSeverityHeader(group),
		children: (
			<IssueGroupList
				items={group.items}
				onSelectItem={onSelectItem}
				onChangeStatus={onChangeStatus}
			/>
		),
	}));
}

function IssueHeaderTags({ summary }) {
	return (
		<div style={TAGS_CONTAINER_STYLE}>
			<Tag color="red">
				{summary.error} {summary.error === 1 ? "error" : "errors"}
			</Tag>
			<Tag color="orange">
				{summary.warning} {summary.warning === 1 ? "warning" : "warnings"}
			</Tag>
			<Tag color="blue">{summary.info} info</Tag>
		</div>
	);
}

function IssuesHeader({ summary, source, onSourceChange }) {
	return (
		<div style={HEADER_STYLE}>
			<div style={HEADER_TOP_ROW_STYLE}>
				<div style={TITLE_CONTAINER_STYLE}>
					<span style={TITLE_DOT_STYLE} />
					<h3 style={TITLE_STYLE}>Issues</h3>
				</div>
				<IssueHeaderTags summary={summary} />
			</div>
			<Segmented
				block
				options={SOURCE_OPTIONS}
				value={source}
				onChange={onSourceChange}
			/>
		</div>
	);
}

function IssuesBody({ groups, collapseItems }) {
	if (groups.length === 0) {
		return (
			<div style={EMPTY_CONTAINER_STYLE}>
				<Empty
					image={Empty.PRESENTED_IMAGE_SIMPLE}
					description="No open issues"
				/>
			</div>
		);
	}
	return (
		<Collapse
			ghost
			defaultActiveKey={["error", "warning", "info"]}
			items={collapseItems}
		/>
	);
}

export default function IssuesPanel({
	issues = [],
	onSelectItem,
	onChangeStatus,
	sourceFilter,
	onSourceFilterChange,
}) {
	const [localSource, setLocalSource] = useState("All");
	const activeSource = normalizeSource(sourceFilter ?? localSource);

	const handleSourceChange = (val) => {
		setLocalSource(val);
		onSourceFilterChange?.(val);
	};

	const filtered = filterIssues(issues, {
		status: "open",
		source: activeSource,
	});
	const summary = issueSummary(filtered);
	const groups = groupIssues(filtered);
	const collapseItems = buildCollapseItems(
		groups,
		onSelectItem,
		onChangeStatus,
	);

	return (
		<aside style={PANEL_STYLE}>
			<IssuesHeader
				summary={summary}
				source={activeSource}
				onSourceChange={handleSourceChange}
			/>
			<div style={BODY_STYLE}>
				<IssuesBody groups={groups} collapseItems={collapseItems} />
			</div>
		</aside>
	);
}
