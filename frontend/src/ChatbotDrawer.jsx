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

const { Text } = Typography;
const { TextArea } = Input;

const PROMPT_ENTRIES = [
	{
		Icon: AimOutlined,
		label: "Explain detected diffs",
		prompt:
			"Analyze all detected changes on this PCB: explain what was done, what the electrical and physical changes are, and how I can make the layout better.",
	},
	{
		Icon: SafetyCertificateOutlined,
		label: "Check DRC & clearance risks",
		prompt:
			"Are there any potential DRC, clearance, or solder bridge risks caused by the recent track and component shifts, and how should I fix them?",
	},
	{
		Icon: BulbOutlined,
		label: "Optimize layout & routing",
		prompt:
			"Review the current routing and component changes. What are the top 3 concrete improvements I can make to reduce noise, improve return paths, and optimize thermals?",
	},
	{
		Icon: FileSearchOutlined,
		label: "Trace width & current rules",
		prompt:
			"What are the recommended KiCad trace widths and IPC-2152 current carrying limits for power vs signal lines?",
	},
	{
		Icon: CompassOutlined,
		label: "Differential pairs & SI",
		prompt:
			"What are the best practices for differential pair length matching, via stitching, and continuous ground return paths in KiCad?",
	},
];

const QUICK_PROMPTS = PROMPT_ENTRIES.map(({ Icon, label, prompt }) => ({
	icon: <Icon />,
	label,
	prompt,
}));

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

const DRAWER_STYLES = {
	header: {
		background: "#161821",
		borderBottom: "1px solid #232738",
		padding: "12px 16px",
	},
	body: {
		display: "flex",
		flexDirection: "column",
		background: "#0f1015",
		padding: "12px",
		overflow: "hidden",
	},
};

const UI_STYLES = {
	avatar: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		width: 28,
		height: 28,
		borderRadius: "50%",
		background: "linear-gradient(135deg, #fadb14 0%, #faad14 100%)",
		color: "#000",
		fontWeight: "bold",
		fontSize: 14,
		boxShadow: "0 0 10px rgba(250, 219, 20, 0.4)",
	},
	headerTag: {
		fontSize: "10px",
		lineHeight: "16px",
		padding: "0 5px",
	},
	headerBox: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		width: "100%",
	},
	contextBar: {
		background: "#161821",
		border: "1px solid #232738",
		display: "flex",
		alignItems: "center",
		fontSize: "11px",
		color: "#a6adbb",
		borderRadius: "6px",
		padding: "8px 12px",
		marginBottom: "10px",
		justifyContent: "space-between",
	},
	contextContent: {
		display: "flex",
		alignItems: "center",
		gap: "6px",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	banner: {
		display: "flex",
		alignItems: "center",
		background: "rgba(22, 119, 255, 0.08)",
		border: "1px solid rgba(22, 119, 255, 0.25)",
		borderRadius: "6px",
		padding: "6px 10px",
		marginBottom: "8px",
		fontSize: "11px",
		color: "#69b1ff",
		gap: "6px",
	},
	missingKey: {
		marginBottom: "10px",
		background: "#1a1813",
		borderColor: "#d48806",
	},
	msgList: {
		display: "flex",
		flexDirection: "column",
		flex: 1,
		overflowY: "auto",
		paddingRight: "4px",
		gap: "12px",
	},
	promptBtn: {
		fontSize: "11px",
		color: "#a6adbb",
		borderColor: "#232738",
		borderRadius: "12px",
		background: "#161821",
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
	inputBox: {
		display: "flex",
		gap: "8px",
		alignItems: "flex-end",
		paddingTop: "6px",
	},
	inputArea: {
		background: "#161821",
		borderColor: "#232738",
		color: "#fff",
		borderRadius: "8px",
		fontSize: "13px",
	},
	sendBtn: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		height: "38px",
		width: "38px",
		borderRadius: "8px",
		background: "#fadb14",
		borderColor: "#fadb14",
		color: "#000",
	},
	auditTag: {
		cursor: "pointer",
		fontWeight: 600,
		margin: "0 3px",
		boxShadow: "0 0 8px rgba(250, 219, 20, 0.25)",
		transition: "all 0.2s",
	},
	authorLabel: {
		fontSize: "10px",
		color: "#6b6375",
		marginTop: "3px",
		padding: "0 4px",
	},
	thinkingDot: {
		width: 6,
		height: 6,
		borderRadius: "50%",
		background: "#fadb14",
	},
	thinkingBox: {
		display: "flex",
		alignItems: "center",
		marginTop: "6px",
		gap: "4px",
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

function HeaderActions({ hasKey, onOpenSettings, onClearHistory, onClose }) {
	return (
		<Space size="small">
			<Tooltip title="Copilot Settings (API Key & Model)">
				<Button
					type="text"
					icon={<SettingOutlined />}
					onClick={onOpenSettings}
					style={{ color: hasKey ? "#52c41a" : "#faad14" }}
				/>
			</Tooltip>
			<Tooltip title="Clear chat history">
				<Button
					type="text"
					icon={<DeleteOutlined />}
					onClick={onClearHistory}
					style={{ color: "#a6adbb" }}
				/>
			</Tooltip>
			<Button
				type="text"
				icon={<CloseOutlined />}
				onClick={onClose}
				style={{ color: "#a6adbb" }}
			/>
		</Space>
	);
}

function checkKeyConfigured(apiKey, serverKeyAvailable) {
	return Boolean(apiKey || serverKeyAvailable);
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

export default function ChatbotDrawer({
	open,
	onClose,
	boardContext = {},
	onSelectModification,
}) {
	const ai = useChatbotAi(boardContext);

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
