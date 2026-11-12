import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function isPlainObject(val) {
	return val !== null && typeof val === "object" && !Array.isArray(val);
}

function isMatchingCall(call, name) {
	return call?.type === "tool_call" && call.name === name;
}

function findMatchingCallIr(events, resultIndex, name) {
	for (let j = resultIndex - 1; j >= 0; j--) {
		const call = events[j];
		if (isMatchingCall(call, name) && isPlainObject(call.input?.ir)) {
			return call.input.ir;
		}
	}
	return null;
}

function findResultIr(events, index, ev) {
	if (isPlainObject(ev.output?.ir)) {
		return ev.output.ir;
	}
	if (isPlainObject(ev.input?.ir)) {
		return ev.input.ir;
	}
	return findMatchingCallIr(events, index, ev.name);
}

function findFallbackCallIr(events) {
	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i];
		if (ev?.type === "tool_call" && isPlainObject(ev.input?.ir)) {
			return ev.input.ir;
		}
	}
	return null;
}

export function deriveIr(events) {
	if (!Array.isArray(events)) {
		return null;
	}
	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i];
		if (ev?.type === "tool_result" && ev.ok) {
			const ir = findResultIr(events, i, ev);
			if (ir) {
				return ir;
			}
		}
	}
	return findFallbackCallIr(events);
}

function isIssueTool(ev) {
	return ev?.name === "erc.run" || ev?.name === "sim.run";
}

export function deriveIssues(events) {
	if (!Array.isArray(events)) {
		return [];
	}
	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i];
		if (ev?.type === "tool_result" && isIssueTool(ev)) {
			if (Array.isArray(ev.output?.issues)) {
				return ev.output.issues;
			}
		}
	}
	return [];
}

function applyAgentSuccess(data, state) {
	state.setEvents(Array.isArray(data?.events) ? data.events : []);
	if (data?.pendingApproval) {
		state.setPendingApproval(data.pendingApproval);
		state.setStatus("needs_approval");
	} else {
		state.setPendingApproval(null);
		state.setStatus("done");
	}
	if (data?.text) {
		state.setMessages((prev) => [
			...prev,
			{ role: "assistant", content: data.text },
		]);
	}
}

function applyAgentFailure(res, state) {
	if (res.error === "aborted") {
		state.setStatus("idle");
		return;
	}
	state.setStatus("error");
	state.setError(res.error || "Agent execution failed");
}

function applyAgentCatch(err, state) {
	if (err?.name === "AbortError" || err?.message === "aborted") {
		state.setStatus("idle");
		return;
	}
	state.setStatus("error");
	state.setError(err?.message || "Agent execution failed");
}

function hasAgentMethod(api) {
	return (
		typeof api?.runAgentStream === "function" ||
		typeof api?.runAgent === "function"
	);
}

function invokeAgent(api, payload, signal, onStep) {
	if (typeof api.runAgentStream === "function") {
		return api.runAgentStream(payload, { signal, onStep });
	}
	return api.runAgent(payload, { signal });
}

async function runAgentRequest(api, payload, signal, state) {
	if (!hasAgentMethod(api)) {
		state.setStatus("error");
		state.setError("API client is required");
		return;
	}
	state.setStatus("running");
	state.setError(null);
	state.setPendingApproval(null);
	try {
		const onStep = (step) => state.setEvents((prev) => [...prev, step]);
		const res = await invokeAgent(api, payload, signal, onStep);
		if (signal.aborted) return;
		if (res.ok) {
			applyAgentSuccess(res.data, state);
		} else {
			applyAgentFailure(res, state);
		}
	} catch (err) {
		if (signal.aborted) return;
		applyAgentCatch(err, state);
	}
}

function useAgentState() {
	const [messages, setMessages] = useState([]);
	const [events, setEvents] = useState([]);
	const [status, setStatus] = useState("idle");
	const [error, setError] = useState(null);
	const [pendingApproval, setPendingApproval] = useState(null);
	const lastMessageRef = useRef("");
	const abortRef = useRef(null);

	return {
		messages,
		setMessages,
		events,
		setEvents,
		status,
		setStatus,
		error,
		setError,
		pendingApproval,
		setPendingApproval,
		lastMessageRef,
		abortRef,
	};
}

function attachProvider(payload, provider) {
	const body = { ...payload };
	if (typeof provider === "string" && provider.trim()) {
		body.provider = provider.trim();
	}
	return body;
}

function useAgentActions(api, state, provider) {
	const { lastMessageRef, abortRef, setStatus, setMessages } = state;
	const start = useCallback(
		(payload) => {
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			const body = attachProvider(payload, provider);
			runAgentRequest(api, body, controller.signal, state);
		},
		[api, state, abortRef, provider],
	);
	const send = useCallback(
		(text) => {
			if (typeof text !== "string" || !text.trim()) return;
			lastMessageRef.current = text;
			setMessages((prev) => [...prev, { role: "user", content: text }]);
			start({ message: text });
		},
		[start, setMessages, lastMessageRef],
	);
	const approve = useCallback(() => {
		if (lastMessageRef.current) {
			start({ message: lastMessageRef.current, approved: true });
		}
	}, [start, lastMessageRef]);
	const cancel = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setStatus("idle");
	}, [abortRef, setStatus]);
	return { send, approve, cancel };
}

function clearAgentState(state) {
	state.abortRef.current?.abort();
	state.abortRef.current = null;
	state.lastMessageRef.current = "";
	state.setStatus("idle");
	state.setError(null);
	state.setPendingApproval(null);
	state.setMessages([]);
	state.setEvents([]);
}

export function useDesignAgent({ api, provider } = {}) {
	const state = useAgentState();
	const ir = useMemo(() => deriveIr(state.events), [state.events]);
	const issues = useMemo(() => deriveIssues(state.events), [state.events]);
	const actions = useAgentActions(api, state, provider);
	const reset = useCallback(() => clearAgentState(state), [state]);

	useEffect(() => {
		return () => state.abortRef.current?.abort();
	}, [state.abortRef]);

	return {
		messages: state.messages,
		events: state.events,
		ir,
		issues,
		status: state.status,
		error: state.error,
		pendingApproval: state.pendingApproval,
		reset,
		...actions,
	};
}
