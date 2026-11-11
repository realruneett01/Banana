function formatToolMessage(call, result) {
	const content = result.ok
		? (result.output ?? { output: null })
		: { error: result.error || "tool execution failed" };
	return {
		role: "tool",
		name: call.name,
		toolName: call.name,
		content,
	};
}

function buildMaxStepsText(text, maxSteps) {
	const note = `[Max steps reached: ${maxSteps}]`;
	if (!text) {
		return note;
	}
	return `${text}\n\n${note}`;
}

function createAssistantMessage(response) {
	const msg = {
		role: "assistant",
		content: response.text || "",
	};
	if (Array.isArray(response.toolCalls) && response.toolCalls.length > 0) {
		msg.toolCalls = response.toolCalls;
	}
	return msg;
}

function normalizeInitialMessages(userMessage) {
	if (Array.isArray(userMessage)) {
		return [...userMessage];
	}
	if (typeof userMessage === "string") {
		return [{ role: "user", content: userMessage }];
	}
	if (userMessage && typeof userMessage === "object") {
		return [userMessage];
	}
	return [];
}

async function callToolWithEvent(ctx) {
	const { registry, call, approved, onEvent, step } = ctx;
	onEvent({ type: "tool_call", name: call.name, input: call.input, step });
	const result = await registry.call(call.name, call.input, { approved });
	onEvent({
		type: "tool_result",
		name: call.name,
		ok: result.ok,
		output: result.output,
		error: result.error,
		step,
	});
	return result;
}

async function processToolCalls(ctx) {
	const { registry, toolCalls, approved, onEvent, step, messages } = ctx;
	for (const call of toolCalls) {
		const callCtx = { registry, call, approved, onEvent, step };
		const result = await callToolWithEvent(callCtx);
		if (!result.ok && result.error === "approval required") {
			return { pendingApproval: { name: call.name, input: call.input } };
		}
		messages.push(formatToolMessage(call, result));
	}
	return null;
}

function finishRun(onEvent, res) {
	onEvent({ type: "done", ...res });
	return res;
}

function checkAbortSignal(signal) {
	if (signal?.aborted) {
		signal.throwIfAborted?.();
		const err = new Error("This operation was aborted");
		err.name = "AbortError";
		throw err;
	}
}

async function executeAgentLoop(params) {
	const {
		model,
		registry,
		system,
		maxSteps,
		onEvent,
		messages,
		approved,
		signal,
	} = params;
	const tools = registry?.list ? registry.list() : undefined;
	for (let step = 1; step <= maxSteps; step++) {
		checkAbortSignal(signal);
		onEvent({ type: "step", step, maxSteps });
		const response = await model.generate({ system, messages, tools, signal });
		messages.push(createAssistantMessage(response));
		const toolCalls = response.toolCalls;
		if (!toolCalls || toolCalls.length === 0) {
			return finishRun(onEvent, { text: response.text || "", steps: step });
		}
		if (step >= maxSteps) {
			const text = buildMaxStepsText(response.text, maxSteps);
			return finishRun(onEvent, { text, steps: step });
		}
		const block = await processToolCalls({
			registry,
			toolCalls,
			approved,
			onEvent,
			step,
			messages,
		});
		if (block?.pendingApproval) {
			return finishRun(onEvent, {
				text: response.text || "",
				steps: step,
				pendingApproval: block.pendingApproval,
			});
		}
	}
}

export function createAgent({
	model,
	registry,
	system,
	maxSteps = 8,
	onEvent = () => {},
} = {}) {
	if (!model || typeof model.generate !== "function") {
		throw new Error("model with generate() is required");
	}
	const safeOnEvent = typeof onEvent === "function" ? onEvent : () => {};
	return {
		run: (userMessage, { approved = false, signal } = {}) => {
			const messages = normalizeInitialMessages(userMessage);
			return executeAgentLoop({
				model,
				registry,
				system,
				maxSteps,
				onEvent: safeOnEvent,
				messages,
				approved,
				signal,
			});
		},
	};
}
