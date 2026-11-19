import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "./config.js";

const STORAGE_KEYS = {
	CHAT_HISTORY: "banana:chatHistory",
	API_KEY: "banana:geminiApiKey",
};

const INITIAL_MESSAGE = {
	role: "model",
	content: "Hey! What are we checking or working on today?",
	timestamp: Date.now(),
};

function loadStoredMessages() {
	const saved = localStorage.getItem(STORAGE_KEYS.CHAT_HISTORY);
	if (!saved) return [INITIAL_MESSAGE];
	try {
		return JSON.parse(saved);
	} catch (err) {
		console.debug("[Banana Copilot] Could not restore chat history:", err);
		return [INITIAL_MESSAGE];
	}
}

function buildChatPayload(messages, boardContext, activeModel) {
	return {
		messages: messages.map((m) => ({ role: m.role, content: m.content })),
		boardContext: {
			relativeFilePath: boardContext.relativeFilePath,
			baseCommit: boardContext.baseCommit,
			targetCommit: boardContext.targetCommit,
			selectedLayers: boardContext.selectedLayers || [],
			diffMode: boardContext.diffMode,
			modifications: boardContext.modifications || [],
			pcbMetadata: boardContext.pcbMetadata,
			activeAuditIdx: boardContext.activeAuditIdx,
			activeAuditItem: boardContext.activeAuditItem,
			evolutionInfo: boardContext.evolutionInfo,
			telemetry: boardContext.telemetry,
		},
		model: activeModel,
	};
}

function handleSseError(data, callbacks) {
	if (data.isKeyRequired) {
		callbacks.onKeyRequired();
	} else {
		callbacks.onError(data.error);
	}
	return false;
}

function handleSseChunk(data, callbacks) {
	if (data.error) return handleSseError(data, callbacks);
	if (data.text) callbacks.onText(data.text);
	if (data.done) callbacks.onDone();
	return true;
}

async function processSseData(jsonStr, callbacks) {
	try {
		return handleSseChunk(JSON.parse(jsonStr), callbacks);
	} catch (err) {
		console.debug("[Banana Copilot] Malformed SSE chunk ignored:", err);
		return true;
	}
}

async function processSseLines(lines, callbacks) {
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("data:")) continue;
		const jsonStr = trimmed.slice(5).trim();
		if (!jsonStr) continue;
		const keepGoing = await processSseData(jsonStr, callbacks);
		if (!keepGoing) return false;
	}
	return true;
}

async function consumeSseStream(reader, callbacks) {
	const decoder = new TextDecoder("utf-8");
	let buffer = "";

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		const keepGoing = await processSseLines(lines, callbacks);
		if (!keepGoing) return;
	}
}

function createChatStreamCallbacks(updateMsg, onKeyRequired) {
	const textChunks = [];
	const pushAndFinalize = (text) => {
		textChunks.push(text);
		updateMsg(textChunks.join(""), false);
	};

	return {
		getFinalText: () => textChunks.join("") || "*(Empty response received)*",
		callbacks: {
			onText: (chunk) => {
				textChunks.push(chunk);
				updateMsg(textChunks.join(""), true);
			},
			onDone: () => updateMsg(textChunks.join(""), false),
			onError: (errMsg) => pushAndFinalize(`\n\n❌ **Error**: ${errMsg}`),
			onKeyRequired: () => {
				pushAndFinalize(
					"\n\n⚠️ **API Key Required**: Please provide a Gemini API key in the Copilot Settings.",
				);
				onKeyRequired();
			},
		},
	};
}

async function executeAiChatRequest({
	apiKey,
	payload,
	updateMsg,
	onKeyRequired,
}) {
	const headers = { "Content-Type": "application/json" };
	if (apiKey) headers["x-gemini-api-key"] = apiKey;

	const response = await fetch(`${API_BASE_URL}/api/ai/chat`, {
		method: "POST",
		headers,
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		throw new Error(`Server returned HTTP ${response.status}`);
	}

	const { callbacks, getFinalText } = createChatStreamCallbacks(
		updateMsg,
		onKeyRequired,
	);
	await consumeSseStream(response.body.getReader(), callbacks);
	updateMsg(getFinalText(), false);
}

async function fetchAiStatus(setServerKeyAvailable, setActiveModel) {
	try {
		const res = await fetch(`${API_BASE_URL}/api/ai/status`);
		if (!res.ok) return;
		const data = await res.json();
		setServerKeyAvailable(Boolean(data.serverKeyConfigured));
		if (data.model) setActiveModel(data.model);
	} catch (err) {
		console.warn("[Banana Copilot] Could not check AI status:", err.message);
	}
}

function prepareChatStreamState({
	messages,
	messageToSend,
	setMessages,
	setInputMessage,
	setIsStreaming,
}) {
	const newMessages = [
		...messages,
		{ role: "user", content: messageToSend, timestamp: Date.now() },
	];
	const assistantIndex = newMessages.length;
	setMessages(newMessages);
	setInputMessage("");
	setIsStreaming(true);
	setMessages((prev) => [
		...prev,
		{ role: "model", content: "", timestamp: Date.now(), isStreaming: true },
	]);
	return { newMessages, assistantIndex };
}

function createAssistantUpdater(setMessages, assistantIndex) {
	return (content, streaming) => {
		setMessages((prev) => {
			const copy = [...prev];
			if (!copy[assistantIndex]) return copy;
			copy[assistantIndex] = {
				...copy[assistantIndex],
				content,
				isStreaming: streaming,
			};
			return copy;
		});
	};
}

function formatChatError(err) {
	return `❌ **Failed to connect to Banana Copilot**: ${err.message}\n\nPlease check your internet connection or verify your Gemini API key in Copilot Settings.`;
}

async function sendAiChatStream(config) {
	const { newMessages, assistantIndex } = prepareChatStreamState(config);
	const updateAssistantMsg = createAssistantUpdater(
		config.setMessages,
		assistantIndex,
	);

	try {
		const payload = buildChatPayload(
			newMessages,
			config.boardContext,
			config.activeModel,
		);
		await executeAiChatRequest({
			apiKey: config.apiKey,
			payload,
			updateMsg: updateAssistantMsg,
			onKeyRequired: () => config.setIsSettingsOpen(true),
		});
	} catch (err) {
		console.error("[Banana Copilot] Error in chat stream:", err);
		updateAssistantMsg(formatChatError(err), false);
	} finally {
		config.setIsStreaming(false);
	}
}

function saveChatHistory(messages) {
	try {
		localStorage.setItem(
			STORAGE_KEYS.CHAT_HISTORY,
			JSON.stringify(messages.slice(-30)),
		);
	} catch (err) {
		console.debug("[Banana Copilot] Failed to save chat history:", err);
	}
}

function useChatMessages() {
	const [messages, setMessages] = useState(loadStoredMessages);

	useEffect(() => {
		saveChatHistory(messages);
	}, [messages]);

	const handleClearHistory = useCallback(() => {
		setMessages([INITIAL_MESSAGE]);
		localStorage.removeItem(STORAGE_KEYS.CHAT_HISTORY);
	}, []);

	return { messages, setMessages, handleClearHistory };
}

function loadApiKey() {
	return localStorage.getItem(STORAGE_KEYS.API_KEY) || "";
}

function saveApiKey(key, setApiKey, setIsSettingsOpen) {
	const trimmed = key.trim();
	setApiKey(trimmed);
	localStorage.setItem(STORAGE_KEYS.API_KEY, trimmed);
	setIsSettingsOpen(false);
}

function useChatSettings() {
	const [apiKey, setApiKey] = useState(loadApiKey);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [serverKeyAvailable, setServerKeyAvailable] = useState(false);
	const [activeModel, setActiveModel] = useState("gemini-3-flash-preview");

	useEffect(() => {
		fetchAiStatus(setServerKeyAvailable, setActiveModel);
	}, []);

	const handleSaveApiKey = useCallback((key) => {
		saveApiKey(key, setApiKey, setIsSettingsOpen);
	}, []);

	return useMemo(
		() => ({
			apiKey,
			setApiKey,
			isSettingsOpen,
			setIsSettingsOpen,
			serverKeyAvailable,
			activeModel,
			handleSaveApiKey,
		}),
		[apiKey, isSettingsOpen, serverKeyAvailable, activeModel, handleSaveApiKey],
	);
}

async function triggerChatStream(opts) {
	const { settings, prompt } = opts;
	if (!settings.apiKey && !settings.serverKeyAvailable) {
		settings.setIsSettingsOpen(true);
		return;
	}
	await sendAiChatStream({
		messageToSend: prompt,
		apiKey: settings.apiKey,
		boardContext: opts.boardContext,
		activeModel: settings.activeModel,
		messages: opts.messages,
		setMessages: opts.setMessages,
		setInputMessage: opts.setInputMessage,
		setIsStreaming: opts.setIsStreaming,
		setIsSettingsOpen: settings.setIsSettingsOpen,
	});
}

function useChatSender({ boardContext, messages, setMessages, settings }) {
	const [inputMessage, setInputMessage] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);

	const handleSendMessage = useCallback(
		async (customPrompt) => {
			const prompt = (customPrompt || inputMessage).trim();
			if (!prompt || isStreaming) return;
			await triggerChatStream({
				prompt,
				boardContext,
				messages,
				setMessages,
				settings,
				setInputMessage,
				setIsStreaming,
			});
		},
		[inputMessage, isStreaming, settings, boardContext, messages, setMessages],
	);

	return { inputMessage, setInputMessage, isStreaming, handleSendMessage };
}

export function useChatbotAi(boardContext) {
	const history = useChatMessages();
	const settings = useChatSettings();
	const sender = useChatSender({
		boardContext,
		messages: history.messages,
		setMessages: history.setMessages,
		settings,
	});

	return {
		messages: history.messages,
		...sender,
		...settings,
		handleClearHistory: history.handleClearHistory,
	};
}
