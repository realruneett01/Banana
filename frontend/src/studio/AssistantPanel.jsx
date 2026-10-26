import React, { useEffect, useRef, useState } from "react";
import { Button, Input, Space, Tag, Tooltip, Typography } from "antd";
import {
	ClearOutlined,
	LoadingOutlined,
	SendOutlined,
	SettingOutlined,
	StopOutlined,
} from "@ant-design/icons";
import ChatSettingsModal from "../ChatSettingsModal.jsx";

const { Text } = Typography;

const SUGGESTIONS = [
	"Design a board with an LED and a resistor, powered from a 5 V pin header",
	"Add a 3.3 V regulator with input and output capacitors",
	"Run the checks and fix whatever fails",
];

function describeStep(step) {
	const a = step.args || {};
	if (step.name === "edit")
		return `edit · ${a.operations?.length ?? 0} operation${a.operations?.length === 1 ? "" : "s"}`;
	if (step.name === "search_symbols" || step.name === "search_footprints")
		return `${step.name.replace("_", " ")} · ${a.query}`;
	if (step.name === "get_symbol" || step.name === "get_footprint")
		return `${step.name.replace("_", " ")} · ${a.id}`;
	return step.name.replace(/_/g, " ");
}

function Steps({ steps }) {
	if (!steps?.length) return null;
	return (
		<div
			style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "6px 0" }}
			data-testid="assistant-steps"
		>
			{steps.map((s) => (
				<Tooltip key={s.id} title={s.error || undefined}>
					<Tag
						data-testid={`step-${s.name}`}
						color={
							s.status === "failed"
								? "red"
								: s.status === "ok"
									? "default"
									: "processing"
						}
						icon={s.status === "running" ? <LoadingOutlined /> : undefined}
						style={{ margin: 0, fontSize: 11 }}
					>
						{describeStep(s)}
					</Tag>
				</Tooltip>
			))}
		</div>
	);
}

function Message({ m }) {
	const isUser = m.role === "user";
	return (
		<div
			data-testid={isUser ? "user-message" : "assistant-message"}
			style={{
				alignSelf: isUser ? "flex-end" : "flex-start",
				maxWidth: "92%",
				background: isUser ? "rgba(250, 219, 20, 0.12)" : "#1c1f2b",
				border: `1px solid ${isUser ? "rgba(250, 219, 20, 0.3)" : "#2a2f42"}`,
				borderRadius: 8,
				padding: "8px 10px",
			}}
		>
			{!isUser && <Steps steps={m.steps} />}
			{m.content && (
				<Text style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
					{m.content}
				</Text>
			)}
			{!isUser && m.pending && !m.content && !m.steps?.length && (
				<Text type="secondary">Thinking…</Text>
			)}
			{m.error && (
				<Text
					type="danger"
					style={{ display: "block", fontSize: 12, marginTop: 4 }}
					data-testid="assistant-error"
				>
					{m.error}
				</Text>
			)}
		</div>
	);
}

export default function AssistantPanel({ assistant, project }) {
	const [draft, setDraft] = useState("");
	const endRef = useRef(null);
	useEffect(() => {
		endRef.current?.scrollIntoView?.({ block: "end" });
	}, [assistant.messages]);

	const submit = () => {
		if (!draft.trim()) return;
		assistant.send(draft);
		setDraft("");
	};

	return (
		<div
			data-testid="assistant-panel"
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				gap: 8,
			}}
		>
			<div
				style={{
					flex: 1,
					minHeight: 0,
					overflowY: "auto",
					display: "flex",
					flexDirection: "column",
					gap: 8,
					paddingRight: 4,
				}}
			>
				{assistant.messages.length === 0 && (
					<Space direction="vertical" size={8} style={{ width: "100%" }}>
						<Text type="secondary" style={{ fontSize: 13 }}>
							Describe what you want. The assistant edits <b>{project}</b> with
							real KiCad parts, checks it, and saves the result as one step you
							can undo.
						</Text>
						{SUGGESTIONS.map((s) => (
							<Button
								key={s}
								size="small"
								style={{
									whiteSpace: "normal",
									height: "auto",
									textAlign: "left",
									padding: "4px 8px",
								}}
								onClick={() => assistant.send(s)}
								data-testid="suggestion"
							>
								{s}
							</Button>
						))}
					</Space>
				)}
				{assistant.messages.map((m) => (
					<Message key={m.id} m={m} />
				))}
				<div ref={endRef} />
			</div>
			<div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
				<Input.TextArea
					data-testid="assistant-input"
					autoSize={{ minRows: 1, maxRows: 5 }}
					value={draft}
					disabled={assistant.streaming}
					placeholder="Ask for a change, a check or an explanation…"
					onChange={(e) => setDraft(e.target.value)}
					onPressEnter={(e) => {
						if (!e.shiftKey) {
							e.preventDefault();
							submit();
						}
					}}
				/>
				{assistant.streaming ? (
					<Button
						danger
						icon={<StopOutlined />}
						onClick={assistant.stop}
						data-testid="assistant-stop"
					/>
				) : (
					<Button
						type="primary"
						icon={<SendOutlined />}
						onClick={submit}
						disabled={!draft.trim()}
						data-testid="assistant-send"
					/>
				)}
			</div>
			<Space style={{ justifyContent: "space-between" }}>
				<Button
					size="small"
					type="text"
					icon={<SettingOutlined />}
					onClick={() => assistant.setSettingsOpen(true)}
					data-testid="assistant-settings"
				>
					Gemini key
				</Button>
				<Button
					size="small"
					type="text"
					icon={<ClearOutlined />}
					onClick={assistant.clear}
					disabled={assistant.streaming || !assistant.messages.length}
					data-testid="assistant-clear"
				>
					Clear chat
				</Button>
			</Space>
			<ChatSettingsModal
				open={assistant.settingsOpen}
				onClose={() => assistant.setSettingsOpen(false)}
				apiKey={assistant.apiKey}
				activeModel={assistant.activeModel}
				serverKeyAvailable={assistant.serverKeyAvailable}
				onSaveKey={assistant.saveKey}
			/>
		</div>
	);
}
