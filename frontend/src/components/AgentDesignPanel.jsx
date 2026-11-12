import { SettingOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Modal, Tag, Timeline, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../config.js";
import { createSimApi, parseSseChunk } from "../simApi.js";
import AgentModelSettings, {
	readAgentApiKey,
	readAgentModel,
} from "./AgentModelSettings.jsx";
import BoardPreview from "./BoardPreview.jsx";
import IrDiffReview from "./IrDiffReview.jsx";
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

const HEADER_STYLE = Object.freeze({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: "4px",
});

const HEADER_INFO_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	gap: "6px",
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

function onPromptKeyDown(e, onSend) {
	if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
		e.preventDefault();
		onSend();
	}
}

function PromptSection({ text, onChange, onSend, onCancel, status }) {
	const isRunning = status === "running";
	return (
		<div style={SECTION_STYLE}>
			<Input.TextArea
				rows={3}
				value={text}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => onPromptKeyDown(e, onSend)}
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

function hasNoDesign(ir) {
	return ir === null || ir === undefined;
}

function shouldShowReview(agentIr, currentIr, reviewedIr) {
	if (!agentIr) return false;
	if (!currentIr || typeof currentIr !== "object") return false;
	if (currentIr === agentIr) return false;
	return reviewedIr !== agentIr;
}

function useIrReview({ agentIr, currentIr, onAcceptIr }) {
	const [reviewedIr, setReviewedIr] = useState(null);
	const [autoAcceptedIr, setAutoAcceptedIr] = useState(null);

	useEffect(() => {
		if (!agentIr || !hasNoDesign(currentIr)) return;
		if (autoAcceptedIr === agentIr) return;
		setAutoAcceptedIr(agentIr);
		onAcceptIr?.(agentIr);
	}, [agentIr, currentIr, autoAcceptedIr, onAcceptIr]);

	const handleAccept = (ir) => {
		setReviewedIr(ir);
		onAcceptIr?.(ir);
	};
	const handleReject = () => setReviewedIr(agentIr);

	const showReview = shouldShowReview(agentIr, currentIr, reviewedIr);
	return { showReview, handleAccept, handleReject };
}

function AgentOutputs({ agent, currentIr, review, onOpenSimulation }) {
	return (
		<>
			<ErrorAlert error={agent.error} />
			<ApprovalSection agent={agent} />
			<AgentResponse messages={agent.messages} />
			<AgentTimeline events={agent.events} />
			{review.showReview && (
				<IrDiffReview
					before={currentIr}
					after={agent.ir}
					onAccept={review.handleAccept}
					onReject={review.handleReject}
				/>
			)}
			<SimulateAction ir={agent.ir} onOpenSimulation={onOpenSimulation} />
			<BoardPreviewSection ir={agent.ir} />
			<IssuesSection issues={agent.issues} />
		</>
	);
}

function getValidModel(settings, provider) {
	const raw = settings?.model;
	if (typeof raw === "string" && raw.trim()) {
		return raw.trim();
	}
	if (provider === "ollama") {
		return "qwen2.5:7b";
	}
	return undefined;
}

function buildAgentBody(params, settings) {
	const provider = settings?.provider || params?.provider;
	const body = { message: params?.message };
	if (params?.approved !== undefined) {
		body.approved = params.approved;
	}
	if (provider) {
		body.provider = provider;
	}
	const model = getValidModel(settings, provider);
	if (model) {
		body.model = model;
	}
	return body;
}

function buildAgentHeaders(apiKey) {
	const headers = { "Content-Type": "application/json" };
	if (typeof apiKey === "string" && apiKey.trim()) {
		headers["x-model-api-key"] = apiKey.trim();
	}
	return headers;
}

async function parseJsonSafe(response) {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

async function handleAgentJson(response) {
	const data = await parseJsonSafe(response);
	if (!response.ok) {
		const error = data?.error || `HTTP ${response.status}`;
		return { ok: false, status: response.status, error };
	}
	return { ok: true, data: data ?? {} };
}

async function runAgentDirect(url, body, options = {}) {
	const { fetchImpl = globalThis.fetch, headers, signal } = options;
	try {
		const res = await fetchImpl(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal,
		});
		return handleAgentJson(res);
	} catch (err) {
		if (signal?.aborted) return { ok: false, status: 0, error: "aborted" };
		return { ok: false, status: 0, error: err?.message || "Request failed" };
	}
}

function dispatchStreamFrame(frame, onStep) {
	if (frame.event === "step") {
		onStep?.(frame.data);
		return null;
	}
	if (frame.event === "result") {
		return { result: frame.data };
	}
	if (frame.event === "error") {
		return { error: frame.data?.error || "Agent execution failed" };
	}
	return null;
}

function processFrames(frames, onStep) {
	let result = null;
	for (const frame of frames) {
		const outcome = dispatchStreamFrame(frame, onStep);
		if (outcome?.error) return outcome;
		if (outcome?.result !== undefined) result = outcome.result;
	}
	return { result };
}

async function readChunkLoop(reader, onStep, signal) {
	const decoder = new TextDecoder();
	let buf = "";
	let finalResult = null;
	while (true) {
		if (signal?.aborted) return { ok: false, error: "aborted" };
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		const parsed = parseSseChunk(buf);
		buf = parsed.rest;
		const out = processFrames(parsed.frames, onStep);
		if (out.error) return { ok: false, error: out.error };
		if (out.result) finalResult = out.result;
	}
	if (finalResult) return { ok: true, data: finalResult };
	return { ok: false, error: "Stream ended without result" };
}

async function streamResponse(res, onStep, signal) {
	const reader = res.body?.getReader?.();
	if (!reader) {
		return { ok: false, error: "Body not readable" };
	}
	try {
		return await readChunkLoop(reader, onStep, signal);
	} catch (err) {
		if (signal?.aborted) return { ok: false, error: "aborted" };
		return { ok: false, error: err?.message || "Stream error" };
	}
}

async function runAgentStreamRequest(baseUrl, body, headers, opt = {}) {
	const { fetchImpl = globalThis.fetch, signal, onStep } = opt;
	const streamUrl = `${baseUrl}/api/agent/run/stream`;
	let res;
	try {
		res = await fetchImpl(streamUrl, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal,
		});
	} catch (err) {
		if (signal?.aborted) return { ok: false, status: 0, error: "aborted" };
		return { ok: false, status: 0, error: err?.message || "Request failed" };
	}
	if (res.status === 404 || res.status === 405) {
		return runAgentDirect(`${baseUrl}/api/agent/run`, body, {
			fetchImpl,
			headers,
			signal,
		});
	}
	if (!res.ok) {
		return handleAgentJson(res);
	}
	return streamResponse(res, onStep, signal);
}

function createAgentApiClient(baseUrl, settings, apiKey, fallbackApi) {
	const headers = buildAgentHeaders(apiKey);
	const fetchImpl =
		typeof fallbackApi?.fetchImpl === "function"
			? fallbackApi.fetchImpl
			: globalThis.fetch;
	const runStream = (params, opt = {}) => {
		const body = buildAgentBody(params, settings);
		return runAgentStreamRequest(baseUrl, body, headers, { ...opt, fetchImpl });
	};
	const runSync = (params, opt = {}) => {
		const body = buildAgentBody(params, settings);
		return runAgentDirect(`${baseUrl}/api/agent/run`, body, {
			fetchImpl,
			headers,
			signal: opt?.signal,
		});
	};
	return {
		...(fallbackApi || {}),
		runAgentStream: runStream,
		runAgent: runSync,
	};
}

function resolveBaseUrl(api) {
	if (typeof api?.baseUrl === "string" && api.baseUrl) {
		return api.baseUrl.replace(/\/+$/, "");
	}
	return API_BASE_URL;
}

function SettingsHeader({ modelConfig, onOpenSettings, disabled }) {
	const isOllama = modelConfig.provider === "ollama";
	const modelLabel = modelConfig.model || (isOllama ? "qwen2.5:7b" : null);
	return (
		<div style={HEADER_STYLE}>
			<div style={HEADER_INFO_STYLE}>
				<Tag color="geekblue">{modelConfig.provider}</Tag>
				{modelLabel && <Tag>{modelLabel}</Tag>}
			</div>
			<Button
				size="small"
				icon={<SettingOutlined />}
				onClick={onOpenSettings}
				disabled={disabled}
				aria-label="Agent settings"
			>
				Settings
			</Button>
		</div>
	);
}

function useAgentSettingsState() {
	const [modelConfig, setModelConfig] = useState(() => readAgentModel());
	const [apiKey, setApiKey] = useState(() =>
		readAgentApiKey(modelConfig.provider),
	);
	const [settingsOpen, setSettingsOpen] = useState(false);

	const handleSaveSettings = (saved) => {
		setModelConfig({ provider: saved.provider, model: saved.model });
		setApiKey(saved.apiKey);
		setSettingsOpen(false);
	};

	return {
		modelConfig,
		apiKey,
		settingsOpen,
		setSettingsOpen,
		handleSaveSettings,
	};
}

function useAgentPanelState(props) {
	const { api, currentIr, onAcceptIr } = props;
	const [text, setText] = useState("");
	const settings = useAgentSettingsState();
	const baseUrl = useMemo(() => resolveBaseUrl(api), [api]);
	const effectiveApi = useMemo(() => {
		const base = api ?? createSimApi({ baseUrl: API_BASE_URL });
		return createAgentApiClient(
			baseUrl,
			settings.modelConfig,
			settings.apiKey,
			base,
		);
	}, [api, baseUrl, settings.modelConfig, settings.apiKey]);

	const agent = useDesignAgent({
		api: effectiveApi,
		provider: settings.modelConfig.provider,
	});
	const review = useIrReview({
		agentIr: agent.ir,
		currentIr,
		onAcceptIr,
	});

	return { text, setText, agent, review, settings };
}

function PanelPrompt({ text, setText, agent }) {
	return (
		<PromptSection
			text={text}
			onChange={setText}
			onSend={() => agent.send(text)}
			onCancel={agent.cancel}
			status={agent.status}
		/>
	);
}

function SettingsModal({ open, onClose, onSave }) {
	return (
		<Modal
			title="AI Model Settings"
			open={open}
			onCancel={onClose}
			footer={null}
			destroyOnClose
		>
			<AgentModelSettings onSave={onSave} onClose={onClose} />
		</Modal>
	);
}

export default function AgentDesignPanel(props) {
	const { text, setText, agent, review, settings } = useAgentPanelState(props);

	return (
		<section style={PANEL_STYLE} aria-label="AI Design Panel">
			<SettingsHeader
				modelConfig={settings.modelConfig}
				onOpenSettings={() => settings.setSettingsOpen(true)}
				disabled={agent.status === "running"}
			/>
			<PanelPrompt text={text} setText={setText} agent={agent} />
			<AgentOutputs
				agent={agent}
				currentIr={props.currentIr}
				review={review}
				onOpenSimulation={props.onOpenSimulation}
			/>
			<SettingsModal
				open={settings.settingsOpen}
				onClose={() => settings.setSettingsOpen(false)}
				onSave={settings.handleSaveSettings}
			/>
		</section>
	);
}
