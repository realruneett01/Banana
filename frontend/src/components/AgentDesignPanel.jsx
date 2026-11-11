import { Alert, Button, Input, Tag, Timeline, Typography } from "antd";
import { useMemo, useState } from "react";
import { API_BASE_URL } from "../config.js";
import { createSimApi } from "../simApi.js";
import BoardPreview from "./BoardPreview.jsx";
import IssuesPanel from "./IssuesPanel.jsx";
import { useDesignAgent } from "./useDesignAgent.js";

const PANEL_STYLE = Object.freeze({
	display: "flex",
	flexDirection: "column",
	gap: "14px",
	padding: "16px",
	background: "#0f121d",
	color: "#e2e8f0",
	minHeight: "100%",
	boxSizing: "border-box",
	overflowY: "auto",
});

const SECTION_STYLE = Object.freeze({
	display: "flex",
	flexDirection: "column",
	gap: "8px",
});

const TEXTAREA_STYLE = Object.freeze({
	background: "#161a2a",
	color: "#e2e8f0",
	borderColor: "#23283e",
	borderRadius: "6px",
});

const BUTTON_ROW_STYLE = Object.freeze({
	display: "flex",
	gap: "8px",
	justifyContent: "flex-end",
});

const ACTION_GAP_STYLE = Object.freeze({
	display: "flex",
	gap: "8px",
});

const ALERT_STYLE = Object.freeze({
	background: "#1c1f2e",
	borderColor: "#3b4468",
});

const RESPONSE_BOX_STYLE = Object.freeze({
	padding: "12px",
	background: "#161a2a",
	borderRadius: "6px",
	border: "1px solid #23283e",
});

const SECTION_TITLE_STYLE = Object.freeze({
	display: "block",
	color: "#94a3b8",
	fontSize: "12px",
	fontWeight: 600,
	textTransform: "uppercase",
	letterSpacing: "0.05em",
	marginBottom: "6px",
});

const RESPONSE_TEXT_STYLE = Object.freeze({
	color: "#e2e8f0",
	margin: 0,
	whiteSpace: "pre-wrap",
});

const TIMELINE_CONTAINER_STYLE = Object.freeze({
	padding: "12px",
	background: "#141724",
	borderRadius: "6px",
	border: "1px solid #23283e",
});

const TIMELINE_STYLE = Object.freeze({
	marginTop: "8px",
});

const ITEM_HEADER_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	gap: "8px",
	marginBottom: "4px",
});

const TOOL_NAME_STYLE = Object.freeze({
	color: "#e2e8f0",
	fontWeight: 600,
	fontSize: "13px",
});

const SUMMARY_TEXT_STYLE = Object.freeze({
	color: "#94a3b8",
	fontSize: "12px",
	fontFamily: "monospace",
	wordBreak: "break-all",
});

const STEP_STYLE = Object.freeze({
	color: "#38bdf8",
	fontWeight: 600,
	fontSize: "12px",
});

const SIMULATE_BUTTON_STYLE = Object.freeze({
	alignSelf: "flex-start",
});

const PANEL_WRAPPER_STYLE = Object.freeze({
	height: "360px",
	border: "1px solid #1e2438",
	borderRadius: "8px",
	overflow: "hidden",
	display: "flex",
	flexDirection: "column",
	flexShrink: 0,
});

function truncateSummary(val) {
	if (val === null || val === undefined) {
		return "";
	}
	const raw = typeof val === "string" ? val : JSON.stringify(val);
	return raw.length > 300 ? `${raw.slice(0, 300)}...` : raw;
}

function renderItemContent(title, statusTag, summary) {
	return (
		<div>
			<div style={ITEM_HEADER_STYLE}>
				<span style={TOOL_NAME_STYLE}>{title}</span>
				{statusTag}
			</div>
			{summary && <div style={SUMMARY_TEXT_STYLE}>{summary}</div>}
		</div>
	);
}

function toToolResultItem(ev) {
	const tag = (
		<Tag color={ev.ok ? "success" : "error"}>{ev.ok ? "OK" : "Error"}</Tag>
	);
	const text = truncateSummary(ev.ok ? ev.output : ev.error);
	return {
		color: ev.ok ? "#10b981" : "#ef4444",
		children: renderItemContent(ev.name, tag, text),
	};
}

function toToolCallItem(ev) {
	const tag = <Tag color="warning">Pending</Tag>;
	const text = truncateSummary(ev.input);
	return {
		color: "#fbbf24",
		children: renderItemContent(ev.name, tag, text),
	};
}

function toStepItem(ev) {
	return {
		color: "#38bdf8",
		children: (
			<span style={STEP_STYLE}>
				Step {ev.step} / {ev.maxSteps}
			</span>
		),
	};
}

function hasResult(events, callIndex, call) {
	for (let i = callIndex + 1; i < events.length; i++) {
		if (events[i]?.type === "tool_result" && events[i].name === call.name) {
			return true;
		}
	}
	return false;
}

function toTimelineItem(ev, index, events) {
	if (ev.type === "step") {
		return toStepItem(ev);
	}
	if (ev.type === "tool_result") {
		return toToolResultItem(ev);
	}
	if (ev.type === "tool_call" && !hasResult(events, index, ev)) {
		return toToolCallItem(ev);
	}
	return null;
}

function buildTimelineItems(events) {
	if (!Array.isArray(events)) return [];
	const items = [];
	for (let i = 0; i < events.length; i++) {
		const item = toTimelineItem(events[i], i, events);
		if (item) items.push(item);
	}
	return items;
}

function AgentTimeline({ events }) {
	const items = useMemo(() => buildTimelineItems(events), [events]);
	if (!items.length) {
		return null;
	}
	return (
		<div style={TIMELINE_CONTAINER_STYLE}>
			<Typography.Text style={SECTION_TITLE_STYLE}>
				Execution Steps
			</Typography.Text>
			<Timeline items={items} style={TIMELINE_STYLE} />
		</div>
	);
}

function PromptButtons({ isRunning, hasText, onSend, onCancel }) {
	return (
		<div style={BUTTON_ROW_STYLE}>
			<Button
				type="primary"
				onClick={onSend}
				disabled={isRunning || !hasText}
				aria-label="Send prompt"
			>
				Send
			</Button>
			{isRunning && (
				<Button danger onClick={onCancel} aria-label="Cancel execution">
					Cancel
				</Button>
			)}
		</div>
	);
}

function PromptSection({ text, onChange, onSend, onCancel, status }) {
	const isRunning = status === "running";
	const handleKeyDown = (e) => {
		if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			onSend();
		}
	};
	return (
		<div style={SECTION_STYLE}>
			<Input.TextArea
				rows={3}
				value={text}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Describe PCB design (e.g. 555 timer board)..."
				disabled={isRunning}
				aria-label="Design prompt"
				style={TEXTAREA_STYLE}
			/>
			<PromptButtons
				isRunning={isRunning}
				hasText={Boolean(text.trim())}
				onSend={onSend}
				onCancel={onCancel}
			/>
		</div>
	);
}

function ApprovalAction({ onApprove, onReject }) {
	return (
		<div style={ACTION_GAP_STYLE}>
			<Button
				size="small"
				type="primary"
				onClick={onApprove}
				aria-label="Approve tool execution"
			>
				Approve
			</Button>
			<Button
				size="small"
				danger
				onClick={onReject}
				aria-label="Reject tool execution"
			>
				Reject
			</Button>
		</div>
	);
}

function ApprovalAlert({ pendingApproval, onApprove, onReject }) {
	const toolName = pendingApproval?.name || "tool";
	const reason =
		pendingApproval?.reason ||
		"This tool requires user confirmation before proceeding.";
	return (
		<Alert
			type="warning"
			showIcon
			message={`Approval required: ${toolName}`}
			description={`Tool "${toolName}" requires approval. ${reason}`}
			action={<ApprovalAction onApprove={onApprove} onReject={onReject} />}
			style={ALERT_STYLE}
		/>
	);
}

function ApprovalSection({ agent }) {
	if (agent.status !== "needs_approval") {
		return null;
	}
	return (
		<ApprovalAlert
			pendingApproval={agent.pendingApproval}
			onApprove={agent.approve}
			onReject={agent.cancel}
		/>
	);
}

function getFinalText(messages) {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.role === "assistant" && messages[i].content) {
			return messages[i].content;
		}
	}
	return "";
}

function AgentResponse({ messages }) {
	const text = getFinalText(messages);
	if (!text) {
		return null;
	}
	return (
		<section style={RESPONSE_BOX_STYLE} aria-label="Agent response">
			<Typography.Text style={SECTION_TITLE_STYLE}>
				Agent Response
			</Typography.Text>
			<Typography.Paragraph style={RESPONSE_TEXT_STYLE}>
				{text}
			</Typography.Paragraph>
		</section>
	);
}

function SimulateAction({ ir, onOpenSimulation }) {
	if (!ir) {
		return null;
	}
	return (
		<Button
			type="primary"
			onClick={() => onOpenSimulation?.(ir)}
			aria-label="Simulate this design"
			style={SIMULATE_BUTTON_STYLE}
		>
			Simulate this design
		</Button>
	);
}

function ErrorAlert({ error }) {
	if (!error) {
		return null;
	}
	return (
		<Alert
			type="error"
			showIcon
			message="Execution Error"
			description={error}
			style={ALERT_STYLE}
		/>
	);
}

function BoardPreviewSection({ ir }) {
	if (!ir) {
		return null;
	}
	return <BoardPreview ir={ir} />;
}

function IssuesSection({ issues }) {
	if (!issues?.length) {
		return null;
	}
	return (
		<div style={PANEL_WRAPPER_STYLE}>
			<IssuesPanel issues={issues} />
		</div>
	);
}

export default function AgentDesignPanel({ api, onOpenSimulation }) {
	const [text, setText] = useState("");
	const effectiveApi = useMemo(
		() => api ?? createSimApi({ baseUrl: API_BASE_URL }),
		[api],
	);
	const agent = useDesignAgent({ api: effectiveApi });

	return (
		<section style={PANEL_STYLE} aria-label="AI Design Panel">
			<PromptSection
				text={text}
				onChange={setText}
				onSend={() => agent.send(text)}
				onCancel={agent.cancel}
				status={agent.status}
			/>
			<ErrorAlert error={agent.error} />
			<ApprovalSection agent={agent} />
			<AgentResponse messages={agent.messages} />
			<AgentTimeline events={agent.events} />
			<SimulateAction ir={agent.ir} onOpenSimulation={onOpenSimulation} />
			<BoardPreviewSection ir={agent.ir} />
			<IssuesSection issues={agent.issues} />
		</section>
	);
}
