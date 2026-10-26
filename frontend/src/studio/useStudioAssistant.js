import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../config.js";
import { streamAssistant } from "./api.js";

const KEY_STORAGE = "banana:geminiApiKey";
const chatKey = (project) => `banana:studio:chat:${project}`;
const safeGet = (k) => {
	try {
		return localStorage.getItem(k);
	} catch {
		return null;
	}
};
const safeSet = (k, v) => {
	try {
		localStorage.setItem(k, v);
	} catch {
		/* storage unavailable */
	}
};

function loadChat(project) {
	try {
		const parsed = JSON.parse(safeGet(chatKey(project)) || "[]");
		return Array.isArray(parsed)
			? parsed.filter((m) => m && typeof m.content === "string")
			: [];
	} catch {
		return [];
	}
}

let nextId = 1;
const uid = () => `m${Date.now()}-${nextId++}`;

/**
 * The Studio assistant: streams one prompt at a time to the server's agent endpoint and keeps a chat per project.
 * Uses the same Gemini key setting as the diff Copilot, but its own history.
 */
export function useStudioAssistant({ project, onDesignChanged, onDone }) {
	const [messages, setMessages] = useState(() =>
		project ? loadChat(project) : [],
	);
	const [streaming, setStreaming] = useState(false);
	const [apiKey, setApiKey] = useState(() => safeGet(KEY_STORAGE) || "");
	const [serverKeyAvailable, setServerKeyAvailable] = useState(false);
	const [activeModel, setActiveModel] = useState("gemini-3-flash-preview");
	const [settingsOpen, setSettingsOpen] = useState(false);
	const abortRef = useRef(null);
	const callbacks = useRef({ onDesignChanged, onDone });
	callbacks.current = { onDesignChanged, onDone };

	useEffect(() => {
		setMessages(project ? loadChat(project) : []);
	}, [project]);

	useEffect(() => {
		if (!project) return;
		safeSet(
			chatKey(project),
			JSON.stringify(
				messages.slice(-30).map((m) => ({
					id: m.id,
					role: m.role,
					content: m.content,
					error: m.error,
				})),
			),
		);
	}, [messages, project]);

	useEffect(() => {
		fetch(`${API_BASE_URL}/api/ai/status`, { credentials: "same-origin" })
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => {
				if (d) {
					setServerKeyAvailable(Boolean(d.serverKeyConfigured));
					if (d.model) setActiveModel(d.model);
				}
			})
			.catch(() => {});
	}, []);

	const saveKey = useCallback((key) => {
		const trimmed = (key || "").trim();
		setApiKey(trimmed);
		safeSet(KEY_STORAGE, trimmed);
		setSettingsOpen(false);
	}, []);

	const patchLast = useCallback((fn) => {
		setMessages((prev) => {
			if (!prev.length) return prev;
			const copy = prev.slice();
			copy[copy.length - 1] = fn(copy[copy.length - 1]);
			return copy;
		});
	}, []);

	const send = useCallback(
		async (text) => {
			const content = (text || "").trim();
			if (!content || streaming || !project) return;
			if (!apiKey && !serverKeyAvailable) {
				setSettingsOpen(true);
				return;
			}
			const history = [...messages, { id: uid(), role: "user", content }];
			setMessages([
				...history,
				{ id: uid(), role: "assistant", content: "", steps: [], pending: true },
			]);
			setStreaming(true);
			const controller = new AbortController();
			abortRef.current = controller;
			let finished = null;
			try {
				await streamAssistant({
					project,
					apiKey,
					signal: controller.signal,
					messages: history
						.filter((m) => m.content && !m.error)
						.map((m) => ({ role: m.role, content: m.content })),
					onEvent: (name, data) => {
						if (name === "text")
							patchLast((m) => ({
								...m,
								content: m.content ? `${m.content}\n\n${data.text}` : data.text,
							}));
						else if (name === "tool_call")
							patchLast((m) => ({
								...m,
								steps: [
									...m.steps,
									{
										id: data.id,
										name: data.name,
										args: data.args,
										status: "running",
									},
								],
							}));
						else if (name === "tool_result")
							patchLast((m) => ({
								...m,
								steps: m.steps.map((s) =>
									s.id === data.id
										? {
												...s,
												status: data.ok ? "ok" : "failed",
												error: data.error,
											}
										: s,
								),
							}));
						else if (name === "design_changed")
							callbacks.current.onDesignChanged?.(data);
						else if (name === "error") {
							patchLast((m) => ({ ...m, error: data.message }));
							if (data.code === "key_required") setSettingsOpen(true);
						} else if (name === "done") finished = data;
					},
				});
			} catch (e) {
				if (e.name !== "AbortError")
					patchLast((m) => ({ ...m, error: e.message }));
			} finally {
				patchLast((m) => ({ ...m, pending: false }));
				setStreaming(false);
				abortRef.current = null;
				callbacks.current.onDone?.(finished);
			}
		},
		[apiKey, messages, patchLast, project, serverKeyAvailable, streaming],
	);

	const stop = useCallback(() => abortRef.current?.abort(), []);
	const clear = useCallback(() => setMessages([]), []);

	return {
		messages,
		streaming,
		send,
		stop,
		clear,
		apiKey,
		saveKey,
		serverKeyAvailable,
		activeModel,
		settingsOpen,
		setSettingsOpen,
	};
}
