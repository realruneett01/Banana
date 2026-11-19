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

const SUMMARY_TAG_CONFIG = [
	{
		key: "error",
		color: "red",
		format: (count) => `${count} ${count === 1 ? "error" : "errors"}`,
	},
	{
		key: "warning",
		color: "orange",
		format: (count) => `${count} ${count === 1 ? "warning" : "warnings"}`,
	},
	{
		key: "info",
		color: "blue",
		format: (count) => `${count} info`,
	},
];

function makeFlex(direction, align, extra = {}) {
	const style = { display: "flex", flexDirection: direction, ...extra };
	if (align) {
		style.alignItems = align;
	}
	return Object.freeze(style);
}

function makeDot(size, color) {
	return Object.freeze({
		width: size,
		height: size,
		borderRadius: "50%",
		background: color,
		boxShadow: `0 0 ${size}px ${color}`,
		display: "inline-block",
	});
}

function makeHeading(color) {
	return Object.freeze({
		margin: 0,
		fontSize: "12px",
		fontWeight: 700,
		textTransform: "uppercase",
		letterSpacing: "0.06em",
		color,
	});
}

const panelStyles = Object.freeze({
	panel: makeFlex("column", null, {
		width: "100%",
		height: "100%",
		background: "#0f121d",
		userSelect: "none",
		overflow: "hidden",
	}),
	header: makeFlex("column", null, {
		padding: "12px 14px",
		borderBottom: "1px solid #1e2438",
		background: "#121520",
		gap: "10px",
		flexShrink: 0,
	}),
	headerTopRow: makeFlex("row", "center", {
		justifyContent: "space-between",
		gap: "8px",
	}),
	titleContainer: makeFlex("row", "center", {
		gap: "8px",
	}),
	titleDot: makeDot(8, "#10b981"),
	title: makeHeading("#e2e8f0"),
	tagsContainer: makeFlex("row", "center", {
		gap: "4px",
		flexWrap: "wrap",
	}),
	body: makeFlex("column", null, {
		flex: 1,
		overflowY: "auto",
		padding: "10px 12px",
		gap: "8px",
	}),
	emptyContainer: makeFlex("row", "center", {
		padding: "32px 16px",
		justifyContent: "center",
	}),
	rowContainer: makeFlex("row", "flex-start", {
		justifyContent: "space-between",
		gap: "8px",
		padding: "8px 10px",
		borderRadius: "6px",
		border: "1px solid #23283e",
		background: "rgba(22, 26, 42, 0.8)",
		marginBottom: "6px",
	}),
	rowBtn: makeFlex("column", "flex-start", {
		flex: 1,
		gap: "4px",
		background: "transparent",
		border: "none",
		padding: 0,
		margin: 0,
		cursor: "pointer",
		textAlign: "left",
		color: "inherit",
		font: "inherit",
	}),
	message: Object.freeze({
		fontSize: "12px",
		fontWeight: 600,
		color: "#f1f5f9",
		lineHeight: "1.35",
		wordBreak: "break-word",
	}),
	measured: Object.freeze({
		fontSize: "11px",
		fontFamily: "monospace",
		color: "#fbbf24",
		background: "#181d2f",
		border: "1px solid #28304c",
		borderRadius: "4px",
		padding: "1px 6px",
	}),
	suggestion: Object.freeze({
		fontSize: "11px",
		color: "#94a3b8",
		lineHeight: "1.4",
		wordBreak: "break-word",
	}),
	select: Object.freeze({
		width: 96,
		flexShrink: 0,
	}),
	groupList: makeFlex("column", null),
});

function normalizeSource(val) {
	if (!val) return "All";
	const match = SOURCE_OPTIONS.find(
		(opt) => opt.toLowerCase() === val.toLowerCase(),
	);
	return match ?? val;
}

function OptionalDetail({ text, style }) {
	if (!text) return null;
	return <span style={style}>{text}</span>;
}

function IssueRow({ issue, onSelectItem, onChangeStatus }) {
	const measured = formatMeasured(issue);
	const handleSelect = () => onSelectItem?.(issue?.itemIds?.[0], issue);
	const handleStatus = (val) => onChangeStatus?.(issue?.id, val);

	return (
		<div style={panelStyles.rowContainer}>
			<button type="button" onClick={handleSelect} style={panelStyles.rowBtn}>
				<span style={panelStyles.message}>{issue?.message}</span>
				<OptionalDetail text={measured} style={panelStyles.measured} />
				<OptionalDetail
					text={issue?.suggestion}
					style={panelStyles.suggestion}
				/>
			</button>
			<Select
				size="small"
				value={issue?.status ?? "open"}
				onChange={handleStatus}
				options={STATUS_OPTIONS}
				style={panelStyles.select}
			/>
		</div>
	);
}

function IssueGroupList({ items, onSelectItem, onChangeStatus }) {
	return (
		<div style={panelStyles.groupList}>
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

function renderSummaryTag({ key, color, format }, summary) {
	return (
		<Tag key={key} color={color}>
			{format(summary[key])}
		</Tag>
	);
}

function IssueHeaderTags({ summary }) {
	return (
		<div style={panelStyles.tagsContainer}>
			{SUMMARY_TAG_CONFIG.map((cfg) => renderSummaryTag(cfg, summary))}
		</div>
	);
}

function PanelHeading({ title }) {
	return (
		<div style={panelStyles.titleContainer}>
			<span style={panelStyles.titleDot} />
			<h3 style={panelStyles.title}>{title}</h3>
		</div>
	);
}

function IssuesHeader({ summary, source, onSourceChange }) {
	return (
		<div style={panelStyles.header}>
			<div style={panelStyles.headerTopRow}>
				<PanelHeading title="Issues" />
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
			<div style={panelStyles.emptyContainer}>
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
		<aside style={panelStyles.panel}>
			<IssuesHeader
				summary={summary}
				source={activeSource}
				onSourceChange={handleSourceChange}
			/>
			<div style={panelStyles.body}>
				<IssuesBody groups={groups} collapseItems={collapseItems} />
			</div>
		</aside>
	);
}
