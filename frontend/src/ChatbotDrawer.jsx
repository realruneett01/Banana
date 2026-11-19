import {
	AimOutlined,
	BulbOutlined,
	CloseOutlined,
	CompassOutlined,
	DeleteOutlined,
	FileSearchOutlined,
	MessageOutlined,
	SafetyCertificateOutlined,
	SendOutlined,
	SettingOutlined,
} from "@ant-design/icons";
import {
	Alert,
	Badge,
	Button,
	Drawer,
	Input,
	Space,
	Tag,
	Tooltip,
	Typography,
} from "antd";
import { useEffect, useRef } from "react";
import ChatSettingsModal from "./ChatSettingsModal.jsx";
import { useChatbotAi } from "./useChatbotAi.js";
import {
	centerRow,
	column,
	ELLIPSIS,
	FLEX_CENTER,
	FLEX_CENTERED,
	FLEX_COLUMN,
} from "./utils/fe_a-styles.js";

const { Text } = Typography;
const { TextArea } = Input;

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

const PROMPT_ENTRIES = {
	"Explain detected diffs": [
		AimOutlined,
		"Analyze all detected changes on this PCB: explain what was done, what the electrical and physical changes are, and how I can make the layout better.",
	],
	"Check DRC & clearance risks": [
		SafetyCertificateOutlined,
		"Are there any potential DRC, clearance, or solder bridge risks caused by the recent track and component shifts, and how should I fix them?",
	],
	"Optimize layout & routing": [
		BulbOutlined,
		"Review the current routing and component changes. What are the top 3 concrete improvements I can make to reduce noise, improve return paths, and optimize thermals?",
	],
	"Trace width & current rules": [
		FileSearchOutlined,
		"What are the recommended KiCad trace widths and IPC-2152 current carrying limits for power vs signal lines?",
	],
	"Differential pairs & SI": [
		CompassOutlined,
		"What are the best practices for differential pair length matching, via stitching, and continuous ground return paths in KiCad?",
	],
};

const QUICK_PROMPTS = Object.entries(PROMPT_ENTRIES).map(
	([label, [Icon, prompt]]) => ({
		icon: <Icon />,
		label,
		prompt,
	}),
);

const makeTheme = (opts) => ({
	align: opts.align,
	bg: opts.bg,
	border: opts.border,
	radius: opts.radius,
	shadow: opts.shadow,
	author: opts.author,
});

const MSG_THEMES = {
	user: makeTheme({
		align: "flex-end",
		bg: "#1f2430",
		border: "#3b4252",
		radius: "12px 12px 2px 12px",
		shadow: "none",
		author: "You",
	}),
	model: makeTheme({
		align: "flex-start",
		bg: "#161821",
		border: "#232738",
		radius: "12px 12px 12px 2px",
		shadow: "0 2px 8px rgba(0,0,0,0.2)",
		author: "Banana Copilot",
	}),
};

const PANEL_BG = "#161821";
const PANEL_BORDER = "#232738";
const ACCENT = "#fadb14";
const MUTED_TEXT = "#a6adbb";
const PANEL_FIELD = { background: PANEL_BG, borderColor: PANEL_BORDER };

const DRAWER_STYLES = {
	header: {
		background: PANEL_BG,
		borderBottom: `1px solid ${PANEL_BORDER}`,
		padding: "12px 16px",
	},
	body: {
		...FLEX_COLUMN,
		background: "#0f1015",
		padding: "12px",
		overflow: "hidden",
	},
};

const INLINE_CONTAINER_STYLE = Object.freeze({
	height: "100%",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	background: "#0f1015",
});

const INLINE_HEADER_STYLE = Object.freeze({
	height: "30px",
	minHeight: "30px",
	maxHeight: "30px",
	boxSizing: "border-box",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "0 8px",
	background: PANEL_BG,
	borderBottom: `1px solid ${PANEL_BORDER}`,
});

const INLINE_BODY_STYLE = Object.freeze({
	...DRAWER_STYLES.body,
	flex: 1,
	minHeight: 0,
});

const UI_STYLES = {
	avatar: {
		...FLEX_CENTERED,
		width: 28,
		height: 28,
		borderRadius: "50%",
		background: "linear-gradient(135deg, #fadb14 0%, #faad14 100%)",
		color: "#000",
		fontWeight: "bold",
		fontSize: 14,
		boxShadow: "0 0 10px rgba(250, 219, 20, 0.4)",
	},
	headerTag: { fontSize: "10px", lineHeight: "16px", padding: "0 5px" },
	headerBox: { ...FLEX_CENTER, justifyContent: "space-between", width: "100%" },
	contextBar: {
		background: PANEL_BG,
		border: `1px solid ${PANEL_BORDER}`,
		...FLEX_CENTER,
		fontSize: "11px",
		color: MUTED_TEXT,
		borderRadius: "6px",
		padding: "8px 12px",
		marginBottom: "10px",
		justifyContent: "space-between",
	},
	contextContent: centerRow("6px", ELLIPSIS),
	banner: centerRow("6px", {
		background: "rgba(22, 119, 255, 0.08)",
		border: "1px solid rgba(22, 119, 255, 0.25)",
		borderRadius: "6px",
		padding: "6px 10px",
		marginBottom: "8px",
		fontSize: "11px",
		color: "#69b1ff",
	}),
	missingKey: {
		marginBottom: "10px",
		background: "#1a1813",
		borderColor: "#d48806",
	},
	promptBtn: {
		...PANEL_FIELD,
		fontSize: "11px",
		color: MUTED_TEXT,
		borderRadius: "12px",
	},
	promptsScroll: {
		padding: "8px 0",
		display: "flex",
		gap: "6px",
		overflowX: "auto",
		whiteSpace: "nowrap",
		borderTop: "1px solid #1f2330",
		scrollbarWidth: "none",
		msOverflowStyle: "none",
	},
	msgList: column("12px", { flex: 1, overflowY: "auto", paddingRight: "4px" }),
	inputBox: {
		display: "flex",
		gap: "8px",
		alignItems: "flex-end",
		paddingTop: "6px",
	},
	inputArea: {
		...PANEL_FIELD,
		color: "#fff",
		borderRadius: "8px",
		fontSize: "13px",
	},
	sendBtn: {
		...FLEX_CENTERED,
		height: "38px",
		width: "38px",
		borderRadius: "8px",
		background: ACCENT,
		borderColor: ACCENT,
		color: "#000",
	},
	auditTag: {
		cursor: "pointer",
		fontWeight: 600,
		margin: "0 3px",
		boxShadow: "0 0 8px rgba(250, 219, 20, 0.25)",
		transition: "all 0.2s",
	},
	thinkingDot: { width: 6, height: 6, borderRadius: "50%", background: ACCENT },
	thinkingBox: centerRow("4px", { marginTop: "6px" }),
	authorLabel: {
		fontSize: "10px",
		color: "#6b6375",
		marginTop: "3px",
		padding: "0 4px",
	},
};

const AUDIT_REGEX =
	/\[\[audit:([^|\]]+)(?:\|([^\]]+))?\]\]|\[audit:([^|\]]+)(?:\|([^\]]+))?\]/g;

function pushTextChunk(parts, text, start, end) {
	if (start < end) {
		parts.push({ type: "text", start, value: text.slice(start, end) });
	}
}

function parseAuditMessageContent(content) {
	if (!content) return [];
	const parts = [];
	let lastIndex = 0;

	for (const match of content.matchAll(AUDIT_REGEX)) {
		pushTextChunk(parts, content, lastIndex, match.index);
		const id = match[1] || match[3];
		const altLabel = match[2] || match[4];
		const label = altLabel || id;
		parts.push({ type: "audit-tag", start: match.index, id, label });
		lastIndex = match.index + match[0].length;
	}

	pushTextChunk(parts, content, lastIndex, content.length);
	return parts;
}

function MessagePartItem({ part, onSelectModification }) {
	if (part.type === "audit-tag") {
		return (
			<Tag
				color="gold"
				icon={<AimOutlined />}
				style={UI_STYLES.auditTag}
				onClick={() => onSelectModification?.(part.id, part.label)}
				title={`Click to zoom directly to ${part.label} on board`}
			>
				{part.label}
			</Tag>
		);
	}
	return <span style={{ whiteSpace: "pre-wrap" }}>{part.value}</span>;
}

function MessageBody({ content, onSelectModification }) {
	if (!content) return null;
	const parts = parseAuditMessageContent(content);

	return (
		<div
			className="copilot-message-body"
			style={{ fontSize: "13px", lineHeight: "1.6", color: "#e1e7f0" }}
		>
			{parts.map((part) => (
				<MessagePartItem
					key={`${part.type}-${part.start}`}
					part={part}
					onSelectModification={onSelectModification}
				/>
			))}
		</div>
	);
}

function ThinkingIndicator() {
	return (
		<div style={UI_STYLES.thinkingBox}>
			<span className="copilot-dot-pulse" style={UI_STYLES.thinkingDot} />
			<Text type="secondary" style={{ fontSize: "11px", color: "#fadb14" }}>
				Thinking...
			</Text>
		</div>
	);
}

function MessageBubble({ msg, theme, onSelectModification }) {
	return (
		<div
			style={{
				background: theme.bg,
				border: `1px solid ${theme.border}`,
				borderRadius: theme.radius,
				padding: "10px 14px",
				boxShadow: theme.shadow,
			}}
		>
			<MessageBody
				content={msg.content}
				onSelectModification={onSelectModification}
			/>
			{msg.isStreaming && <ThinkingIndicator />}
		</div>
	);
}

function ChatMessageItem({ msg, onSelectModification }) {
	const theme = msg.role === "user" ? MSG_THEMES.user : MSG_THEMES.model;
	return (
		<div
			style={{
				alignSelf: theme.align,
				maxWidth: "92%",
				display: "flex",
				flexDirection: "column",
				alignItems: theme.align,
			}}
		>
			<MessageBubble
				msg={msg}
				theme={theme}
				onSelectModification={onSelectModification}
			/>
			<span style={UI_STYLES.authorLabel}>{theme.author}</span>
		</div>
	);
}

function HeaderTags({ activeModel }) {
	return (
		<div>
			<Tag color="cyan" style={UI_STYLES.headerTag}>
				💬 Hardware Copilot
			</Tag>
			<Tag color="gold" style={{ ...UI_STYLES.headerTag, marginLeft: 4 }}>
				{activeModel}
			</Tag>
			<Tag color="green" style={{ ...UI_STYLES.headerTag, marginLeft: 4 }}>
				Unlimited Free
			</Tag>
		</div>
	);
}

function HeaderBrand({ activeModel }) {
	return (
		<Space align="center" size="small">
			<div style={UI_STYLES.avatar}>🍌</div>
			<div>
				<Text strong style={{ color: "#fff", fontSize: "14px" }}>
					Banana Hardware Copilot
				</Text>
				<HeaderTags activeModel={activeModel} />
			</div>
		</Space>
	);
}

function HeaderActions({
	hasKey,
	onOpenSettings,
	onClearHistory,
	onClose,
	compact,
}) {
	const btnSize = compact ? "small" : undefined;
	return (
		<Space size={compact ? 2 : "small"}>
			<Tooltip title="Copilot Settings (API Key & Model)">
				<Button
					type="text"
					size={btnSize}
					icon={<SettingOutlined />}
					onClick={onOpenSettings}
					style={{ color: hasKey ? "#52c41a" : "#faad14" }}
					aria-label="Open AI settings"
					title="Open AI settings"
				/>
			</Tooltip>
			<Tooltip title="Clear chat history">
				<Button
					type="text"
					size={btnSize}
					icon={<DeleteOutlined />}
					onClick={onClearHistory}
					style={{ color: "#a6adbb" }}
					aria-label="Clear conversation history"
					title="Clear conversation history"
				/>
			</Tooltip>
			{onClose && (
				<Button
					type="text"
					size={btnSize}
					icon={<CloseOutlined />}
					onClick={onClose}
					style={{ color: "#a6adbb" }}
					aria-label="Close hardware copilot"
					title="Close hardware copilot"
				/>
			)}
		</Space>
	);
}

function checkKeyConfigured(apiKey, serverKeyAvailable) {
	return Boolean(apiKey || serverKeyAvailable);
}

function ChatInlineHeader({ ai, onClose }) {
	const hasKey = checkKeyConfigured(ai.apiKey, ai.serverKeyAvailable);
	return (
		<div style={INLINE_HEADER_STYLE}>
			<Space align="center" size={6}>
				<span style={{ fontSize: "13px" }}>🍌</span>
				<Text strong style={{ color: "#fff", fontSize: "12px" }}>
					Banana Hardware Copilot
				</Text>
			</Space>
			<HeaderActions
				hasKey={hasKey}
				onOpenSettings={() => ai.setIsSettingsOpen(true)}
				onClearHistory={ai.handleClearHistory}
				onClose={onClose}
				compact
			/>
		</div>
	);
}

function ChatDrawerHeader({ ai, onClose }) {
	const hasKey = checkKeyConfigured(ai.apiKey, ai.serverKeyAvailable);
	return (
		<div style={UI_STYLES.headerBox}>
			<HeaderBrand activeModel={ai.activeModel} />
			<HeaderActions
				hasKey={hasKey}
				onOpenSettings={() => ai.setIsSettingsOpen(true)}
				onClearHistory={ai.handleClearHistory}
				onClose={onClose}
			/>
		</div>
	);
}

function ContextDetails({ isGrounded, fileName, modsCount, diffMode }) {
	if (isGrounded) {
		return (
			<span>
				<Text strong style={{ color: "#fadb14" }}>
					{fileName}
				</Text>
				<span style={{ color: "#6b6375", marginLeft: 4 }}>
					({modsCount} diffs on {diffMode})
				</span>
			</span>
		);
	}
	return <span>No board loaded • General Hardware Assistant</span>;
}

function ChatContextBar({ isGrounded, fileName, modsCount, diffMode }) {
	return (
		<div style={UI_STYLES.contextBar}>
			<div style={UI_STYLES.contextContent}>
				<CompassOutlined style={{ color: "#fadb14" }} />
				<ContextDetails
					isGrounded={isGrounded}
					fileName={fileName}
					modsCount={modsCount}
					diffMode={diffMode}
				/>
			</div>
			<Badge
				status={isGrounded ? "success" : "default"}
				text={
					<span style={{ fontSize: "10px", color: "#6b6375" }}>
						{isGrounded ? "Grounded" : "Ready"}
					</span>
				}
			/>
		</div>
	);
}

function HardwareCopilotBanner() {
	return (
		<div style={UI_STYLES.banner}>
			<MessageOutlined style={{ fontSize: "13px", flexShrink: 0 }} />
			<span>
				<strong>AI Hardware Copilot</strong>: Grounded in your active PCB diff
				context. Ask about layout changes, clearance risks, DRC rules, and
				electronics design.
			</span>
		</div>
	);
}

function MissingApiKeyAlert({ onConfigure }) {
	return (
		<Alert
			type="warning"
			showIcon
			title="Gemini API Key Needed"
			description={
				<div style={{ fontSize: "11px" }}>
					To start unlimited AI chat, click Settings to paste your Gemini API
					key (or set <code>GEMINI_API_KEY</code> in backend/.env).
					<div style={{ marginTop: "6px" }}>
						<Button size="small" type="primary" onClick={onConfigure}>
							Configure API Key
						</Button>
					</div>
				</div>
			}
			style={UI_STYLES.missingKey}
		/>
	);
}

function ChatMessagesList({ messages, onSelectModification, messagesEndRef }) {
	return (
		<div style={UI_STYLES.msgList}>
			{messages.map((msg, idx) => (
				<ChatMessageItem
					// biome-ignore lint/suspicious/noArrayIndexKey: chat log is append-only, so the index is a stable identity
					key={`msg-${idx}`}
					msg={msg}
					onSelectModification={onSelectModification}
				/>
			))}
			<div ref={messagesEndRef} />
		</div>
	);
}

function handlePromptScroll(e) {
	if (e.deltaY !== 0) {
		e.currentTarget.scrollLeft += e.deltaY;
	}
}

function QuickPromptsScroll({ isStreaming, onSelectPrompt }) {
	return (
		<div
			className="copilot-prompts-scroll"
			onWheel={handlePromptScroll}
			style={UI_STYLES.promptsScroll}
		>
			{QUICK_PROMPTS.map((qp) => (
				<Button
					key={qp.label}
					size="small"
					type="dashed"
					icon={qp.icon}
					disabled={isStreaming}
					onClick={() => onSelectPrompt(qp.prompt)}
					style={UI_STYLES.promptBtn}
				>
					{qp.label}
				</Button>
			))}
		</div>
	);
}

function handleTextEnter(e, onSend) {
	if (!e.shiftKey) {
		e.preventDefault();
		onSend();
	}
}

function ChatInputBar(props) {
	const { inputRef, inputMessage, onChange, onSend, isStreaming } = props;
	return (
		<div style={UI_STYLES.inputBox}>
			<TextArea
				ref={inputRef}
				value={inputMessage}
				onChange={(e) => onChange(e.target.value)}
				onPressEnter={(e) => handleTextEnter(e, onSend)}
				placeholder="Ask anything about Banana, PCB diffs, KiCad, or hardware engineering..."
				autoSize={{ minRows: 1, maxRows: 4 }}
				disabled={isStreaming}
				style={UI_STYLES.inputArea}
			/>
			<Button
				type="primary"
				icon={<SendOutlined />}
				loading={isStreaming}
				disabled={!inputMessage.trim()}
				onClick={onSend}
				style={UI_STYLES.sendBtn}
				aria-label="Send prompt to copilot"
				title="Send prompt to copilot"
			/>
		</div>
	);
}

function useAutoScrollToBottom(open) {
	const ref = useRef(null);
	useEffect(() => {
		if (open) {
			ref.current?.scrollIntoView({ behavior: "smooth" });
		}
	}, [open]);
	return ref;
}

function extractContextSummary(boardContext) {
	const filePath = boardContext.relativeFilePath;
	return {
		isGrounded: Boolean(filePath),
		fileName: filePath ? filePath.split(/[/\\]/).pop() : undefined,
		modsCount: (boardContext.modifications || []).length,
		diffMode: boardContext.diffMode,
	};
}

function ChatDrawerBody({ ai, boardContext, onSelectModification, open }) {
	const messagesEndRef = useAutoScrollToBottom(open);
	const inputRef = useRef(null);
	const summary = extractContextSummary(boardContext);
	const hasKey = checkKeyConfigured(ai.apiKey, ai.serverKeyAvailable);

	return (
		<>
			<HardwareCopilotBanner />
			<ChatContextBar {...summary} />
			{!hasKey && (
				<MissingApiKeyAlert onConfigure={() => ai.setIsSettingsOpen(true)} />
			)}
			<ChatMessagesList
				messages={ai.messages}
				onSelectModification={onSelectModification}
				messagesEndRef={messagesEndRef}
			/>
			<QuickPromptsScroll
				isStreaming={ai.isStreaming}
				onSelectPrompt={ai.handleSendMessage}
			/>
			<ChatInputBar
				inputRef={inputRef}
				inputMessage={ai.inputMessage}
				onChange={ai.setInputMessage}
				onSend={ai.handleSendMessage}
				isStreaming={ai.isStreaming}
			/>
		</>
	);
}

function CopilotSettingsDialog({ ai }) {
	return (
		<ChatSettingsModal
			open={ai.isSettingsOpen}
			onClose={() => ai.setIsSettingsOpen(false)}
			apiKey={ai.apiKey}
			activeModel={ai.activeModel}
			serverKeyAvailable={ai.serverKeyAvailable}
			onSaveKey={ai.handleSaveApiKey}
		/>
	);
}

function ChatbotDrawerView({
	ai,
	boardContext,
	onSelectModification,
	open,
	onClose,
}) {
	return (
		<>
			<Drawer
				title={<ChatDrawerHeader ai={ai} onClose={onClose} />}
				placement="right"
				size={460}
				onClose={onClose}
				open={open}
				closable={false}
				styles={DRAWER_STYLES}
			>
				<ChatDrawerBody
					ai={ai}
					boardContext={boardContext}
					onSelectModification={onSelectModification}
					open={open}
				/>
			</Drawer>
			<CopilotSettingsDialog ai={ai} />
		</>
	);
}

function ChatbotInlineView({
	ai,
	boardContext,
	onSelectModification,
	onClose,
	chrome,
}) {
	return (
		<div style={INLINE_CONTAINER_STYLE}>
			{chrome.showHeader && <ChatInlineHeader ai={ai} onClose={onClose} />}
			<div style={INLINE_BODY_STYLE}>
				<ChatDrawerBody
					ai={ai}
					boardContext={boardContext}
					onSelectModification={onSelectModification}
					open={true}
				/>
			</div>
			<CopilotSettingsDialog ai={ai} />
		</div>
	);
}

export default function ChatbotDrawer({
	open,
	onClose,
	boardContext = {},
	onSelectModification,
	inline = false,
}) {
	const ai = useChatbotAi(boardContext);
	const chrome = panelChrome({
		inline,
		title: "Banana Hardware Copilot",
		onClose,
	});

	if (chrome.isInline) {
		return (
			<ChatbotInlineView
				ai={ai}
				boardContext={boardContext}
				onSelectModification={onSelectModification}
				onClose={onClose}
				chrome={chrome}
			/>
		);
	}

	return (
		<ChatbotDrawerView
			ai={ai}
			boardContext={boardContext}
			onSelectModification={onSelectModification}
			open={open}
			onClose={onClose}
		/>
	);
}
