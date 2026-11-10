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

const QUICK_PROMPTS = [
	{
		icon: <AimOutlined />,
		label: "Explain detected diffs",
		prompt:
			"Analyze all detected changes on this PCB: explain what was done, what the electrical and physical changes are, and how I can make the layout better.",
	},
	{
		icon: <SafetyCertificateOutlined />,
		label: "Check DRC & clearance risks",
		prompt:
			"Are there any potential DRC, clearance, or solder bridge risks caused by the recent track and component shifts, and how should I fix them?",
	},
	{
		icon: <BulbOutlined />,
		label: "Optimize layout & routing",
		prompt:
			"Review the current routing and component changes. What are the top 3 concrete improvements I can make to reduce noise, improve return paths, and optimize thermals?",
	},
	{
		icon: <FileSearchOutlined />,
		label: "Trace width & current rules",
		prompt:
			"What are the recommended KiCad trace widths and IPC-2152 current carrying limits for power vs signal lines?",
	},
	{
		icon: <CompassOutlined />,
		label: "Differential pairs & SI",
		prompt:
			"What are the best practices for differential pair length matching, via stitching, and continuous ground return paths in KiCad?",
	},
];

const USER_MSG_THEME = {
	align: "flex-end",
	bg: "#1f2430",
	border: "#3b4252",
	radius: "12px 12px 2px 12px",
	shadow: "none",
	author: "You",
};

const BOT_MSG_THEME = {
	align: "flex-start",
	bg: "#161821",
	border: "#232738",
	radius: "12px 12px 12px 2px",
	shadow: "0 2px 8px rgba(0,0,0,0.2)",
	author: "Banana Copilot",
};

const DRAWER_STYLES = {
	header: {
		background: "#161821",
		borderBottom: "1px solid #232738",
		padding: "12px 16px",
	},
	body: {
		background: "#0f1015",
		padding: "12px",
		display: "flex",
		flexDirection: "column",
		overflow: "hidden",
	},
};

const BANANA_AVATAR_STYLE = {
	width: 28,
	height: 28,
	borderRadius: "50%",
	background: "linear-gradient(135deg, #fadb14 0%, #faad14 100%)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	color: "#000",
	fontWeight: "bold",
	fontSize: 14,
	boxShadow: "0 0 10px rgba(250, 219, 20, 0.4)",
};

const HEADER_TAG_BASE_STYLE = {
	fontSize: "10px",
	lineHeight: "16px",
	padding: "0 5px",
};

const HEADER_CONTAINER_STYLE = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	width: "100%",
};

const CONTEXT_BAR_STYLE = {
	background: "#161821",
	border: "1px solid #232738",
	borderRadius: "6px",
	padding: "8px 12px",
	marginBottom: "10px",
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	fontSize: "11px",
	color: "#a6adbb",
};

const CONTEXT_CONTENT_STYLE = {
	display: "flex",
	alignItems: "center",
	gap: "6px",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
};

const BANNER_STYLE = {
	background: "rgba(22, 119, 255, 0.08)",
	border: "1px solid rgba(22, 119, 255, 0.25)",
	borderRadius: "6px",
	padding: "6px 10px",
	marginBottom: "8px",
	fontSize: "11px",
	color: "#69b1ff",
	display: "flex",
	alignItems: "center",
	gap: "6px",
};

const MISSING_KEY_ALERT_STYLE = {
	marginBottom: "10px",
	background: "#1a1813",
	borderColor: "#d48806",
};

const MESSAGES_LIST_STYLE = {
	flex: 1,
	overflowY: "auto",
	paddingRight: "4px",
	display: "flex",
	flexDirection: "column",
	gap: "12px",
};

const PROMPT_BTN_STYLE = {
	fontSize: "11px",
	borderColor: "#232738",
	color: "#a6adbb",
	borderRadius: "12px",
	background: "#161821",
};

const PROMPTS_SCROLL_STYLE = {
	padding: "8px 0",
	display: "flex",
	gap: "6px",
	overflowX: "auto",
	whiteSpace: "nowrap",
	borderTop: "1px solid #1f2330",
	scrollbarWidth: "none",
	msOverflowStyle: "none",
};

const INPUT_CONTAINER_STYLE = {
	display: "flex",
	gap: "8px",
	alignItems: "flex-end",
	paddingTop: "6px",
};

const INPUT_TEXTAREA_STYLE = {
	background: "#161821",
	borderColor: "#232738",
	color: "#fff",
	borderRadius: "8px",
	fontSize: "13px",
};

const SEND_BTN_STYLE = {
	height: "38px",
	width: "38px",
	borderRadius: "8px",
	background: "#fadb14",
	borderColor: "#fadb14",
	color: "#000",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
};

const AUDIT_TAG_STYLE = {
	cursor: "pointer",
	fontWeight: 600,
	margin: "0 3px",
	boxShadow: "0 0 8px rgba(250, 219, 20, 0.25)",
	transition: "all 0.2s",
};

const AUTHOR_LABEL_STYLE = {
	fontSize: "10px",
	color: "#6b6375",
	marginTop: "3px",
	padding: "0 4px",
};

const THINKING_DOT_STYLE = {
	width: 6,
	height: 6,
	borderRadius: "50%",
	background: "#fadb14",
};

const THINKING_CONTAINER_STYLE = {
	marginTop: "6px",
	display: "flex",
	alignItems: "center",
	gap: "4px",
};

const AUDIT_REGEX =
	/\[\[audit:([^|\]]+)(?:\|([^\]]+))?\]\]|\[audit:([^|\]]+)(?:\|([^\]]+))?\]/g;

function createAuditTagPart(match) {
	const id = match[1] || match[3];
	const label = match[2] || match[4] || id;
	return { type: "audit-tag", start: match.index, id, label };
}

function createTextPart(start, value) {
	return { type: "text", start, value };
}

function parseAuditMessageContent(content) {
	if (!content) return [];
	const parts = [];
	let lastIndex = 0;

	for (const match of content.matchAll(AUDIT_REGEX)) {
		if (match.index > lastIndex) {
			parts.push(
				createTextPart(lastIndex, content.substring(lastIndex, match.index)),
			);
		}
		parts.push(createAuditTagPart(match));
		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < content.length) {
		parts.push(createTextPart(lastIndex, content.substring(lastIndex)));
	}
	return parts;
}

function MessagePartItem({ part, onSelectModification }) {
	if (part.type === "audit-tag") {
		return (
			<Tag
				color="gold"
				icon={<AimOutlined />}
				style={AUDIT_TAG_STYLE}
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
		<div style={THINKING_CONTAINER_STYLE}>
			<span className="copilot-dot-pulse" style={THINKING_DOT_STYLE} />
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
	const theme = msg.role === "user" ? USER_MSG_THEME : BOT_MSG_THEME;
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
			<span style={AUTHOR_LABEL_STYLE}>{theme.author}</span>
		</div>
	);
}

function HeaderTags({ activeModel }) {
	return (
		<div>
			<Tag color="cyan" style={{ ...HEADER_TAG_BASE_STYLE, margin: 0 }}>
				💬 Hardware Copilot
			</Tag>
			<Tag color="gold" style={{ ...HEADER_TAG_BASE_STYLE, marginLeft: 4 }}>
				{activeModel}
			</Tag>
			<Tag color="green" style={{ ...HEADER_TAG_BASE_STYLE, marginLeft: 4 }}>
				Unlimited Free
			</Tag>
		</div>
	);
}

function HeaderBrand({ activeModel }) {
	return (
		<Space align="center" size="small">
			<div style={BANANA_AVATAR_STYLE}>🍌</div>
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

function ChatDrawerHeader(props) {
	const hasKey = Boolean(props.apiKey || props.serverKeyAvailable);
	return (
		<div style={HEADER_CONTAINER_STYLE}>
			<HeaderBrand activeModel={props.activeModel} />
			<HeaderActions
				hasKey={hasKey}
				onOpenSettings={props.onOpenSettings}
				onClearHistory={props.onClearHistory}
				onClose={props.onClose}
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
		<div style={CONTEXT_BAR_STYLE}>
			<div style={CONTEXT_CONTENT_STYLE}>
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
		<div style={BANNER_STYLE}>
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
			style={MISSING_KEY_ALERT_STYLE}
		/>
	);
}

function ChatMessagesList({ messages, onSelectModification, messagesEndRef }) {
	return (
		<div style={MESSAGES_LIST_STYLE}>
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

function QuickPromptButton({ qp, isStreaming, onSelectPrompt }) {
	return (
		<Button
			key={qp.label}
			size="small"
			type="dashed"
			icon={qp.icon}
			disabled={isStreaming}
			onClick={() => onSelectPrompt(qp.prompt)}
			style={PROMPT_BTN_STYLE}
		>
			{qp.label}
		</Button>
	);
}

function QuickPromptsScroll({ isStreaming, onSelectPrompt }) {
	return (
		<div
			className="copilot-prompts-scroll"
			onWheel={handlePromptScroll}
			style={PROMPTS_SCROLL_STYLE}
		>
			{QUICK_PROMPTS.map((qp) => (
				<QuickPromptButton
					key={qp.label}
					qp={qp}
					isStreaming={isStreaming}
					onSelectPrompt={onSelectPrompt}
				/>
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

function SendChatButton({ isStreaming, disabled, onSend }) {
	return (
		<Button
			type="primary"
			icon={<SendOutlined />}
			loading={isStreaming}
			disabled={disabled}
			onClick={onSend}
			style={SEND_BTN_STYLE}
		/>
	);
}

function ChatInputBar(props) {
	const { inputRef, inputMessage, onChange, onSend, isStreaming } = props;
	return (
		<div style={INPUT_CONTAINER_STYLE}>
			<TextArea
				ref={inputRef}
				value={inputMessage}
				onChange={(e) => onChange(e.target.value)}
				onPressEnter={(e) => handleTextEnter(e, onSend)}
				placeholder="Ask anything about Banana, PCB diffs, KiCad, or hardware engineering..."
				autoSize={{ minRows: 1, maxRows: 4 }}
				disabled={isStreaming}
				style={INPUT_TEXTAREA_STYLE}
			/>
			<SendChatButton
				isStreaming={isStreaming}
				disabled={!inputMessage.trim()}
				onSend={onSend}
			/>
		</div>
	);
}

function ChatDrawerTop(props) {
	return (
		<>
			<HardwareCopilotBanner />
			<ChatContextBar
				isGrounded={props.isGrounded}
				fileName={props.fileName}
				modsCount={props.modsCount}
				diffMode={props.diffMode}
			/>
			{props.needsKey && (
				<MissingApiKeyAlert onConfigure={props.onConfigureKey} />
			)}
		</>
	);
}

function ChatDrawerControls(props) {
	return (
		<>
			<QuickPromptsScroll
				isStreaming={props.isStreaming}
				onSelectPrompt={props.onSelectPrompt}
			/>
			<ChatInputBar
				inputRef={props.inputRef}
				inputMessage={props.inputMessage}
				onChange={props.setInputMessage}
				onSend={props.onSendMessage}
				isStreaming={props.isStreaming}
			/>
		</>
	);
}

function ChatDrawerBody(props) {
	return (
		<>
			<ChatDrawerTop {...props} />
			<ChatMessagesList
				messages={props.messages}
				onSelectModification={props.onSelectModification}
				messagesEndRef={props.messagesEndRef}
			/>
			<ChatDrawerControls {...props} />
		</>
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

function getBoardContextSummary(boardContext, apiKey, serverKeyAvailable) {
	return {
		modsCount: (boardContext.modifications || []).length,
		isGrounded: Boolean(boardContext.relativeFilePath),
		fileName: boardContext.relativeFilePath?.split(/[/\\]/).pop(),
		needsKey: !apiKey && !serverKeyAvailable,
	};
}

function useChatDrawerState({ open, boardContext, ai, onSelectModification }) {
	const messagesEndRef = useAutoScrollToBottom(open);
	const inputRef = useRef(null);
	const summary = getBoardContextSummary(
		boardContext,
		ai.apiKey,
		ai.serverKeyAvailable,
	);
	return {
		...summary,
		diffMode: boardContext.diffMode,
		onConfigureKey: () => ai.setIsSettingsOpen(true),
		messages: ai.messages,
		onSelectModification,
		messagesEndRef,
		isStreaming: ai.isStreaming,
		onSelectPrompt: ai.handleSendMessage,
		inputRef,
		inputMessage: ai.inputMessage,
		setInputMessage: ai.setInputMessage,
		onSendMessage: ai.handleSendMessage,
	};
}

function CopilotDrawerHeader({ ai, onClose }) {
	return (
		<ChatDrawerHeader
			activeModel={ai.activeModel}
			apiKey={ai.apiKey}
			serverKeyAvailable={ai.serverKeyAvailable}
			onOpenSettings={() => ai.setIsSettingsOpen(true)}
			onClearHistory={ai.handleClearHistory}
			onClose={onClose}
		/>
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

function CopilotDrawer({ open, onClose, ai, bodyProps }) {
	return (
		<Drawer
			title={<CopilotDrawerHeader ai={ai} onClose={onClose} />}
			placement="right"
			size={460}
			onClose={onClose}
			open={open}
			closable={false}
			styles={DRAWER_STYLES}
		>
			<ChatDrawerBody {...bodyProps} />
		</Drawer>
	);
}

export default function ChatbotDrawer({
	open,
	onClose,
	boardContext = {},
	onSelectModification,
}) {
	const ai = useChatbotAi(boardContext);
	const bodyProps = useChatDrawerState({
		open,
		boardContext,
		ai,
		onSelectModification,
	});

	return (
		<>
			<CopilotDrawer
				open={open}
				onClose={onClose}
				ai={ai}
				bodyProps={bodyProps}
			/>
			<CopilotSettingsDialog ai={ai} />
		</>
	);
}
