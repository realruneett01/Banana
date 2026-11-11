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

function hasToolCalls(calls) {
	return Array.isArray(calls) && calls.length > 0;
}

function createAssistantMessage(response) {
	const msg = {
		role: "assistant",
		content: response.text || "",
	};
	if (hasToolCalls(response.toolCalls)) {
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

function getTools(registry) {
	return registry?.list ? registry.list() : undefined;
}

async function resolveStepOutcome(params, response, step) {
	const text = response.text || "";
	if (!hasToolCalls(response.toolCalls)) {
		return { text, steps: step };
	}
	if (step >= params.maxSteps) {
		return {
			text: buildMaxStepsText(response.text, params.maxSteps),
			steps: step,
		};
	}
	const block = await processToolCalls({
		registry: params.registry,
		toolCalls: response.toolCalls,
		approved: params.approved,
		onEvent: params.onEvent,
		step,
		messages: params.messages,
	});
	if (block?.pendingApproval) {
		return { text, steps: step, pendingApproval: block.pendingApproval };
	}
	return null;
}

async function executeAgentStep(params, tools, step) {
	const { model, system, maxSteps, onEvent, messages, signal } = params;
	onEvent({ type: "step", step, maxSteps });
	const response = await model.generate({ system, messages, tools, signal });
	messages.push(createAssistantMessage(response));
	return resolveStepOutcome(params, response, step);
}

async function executeAgentLoop(params) {
	const { maxSteps, onEvent, signal, registry } = params;
	const tools = getTools(registry);
	for (let step = 1; step <= maxSteps; step++) {
		checkAbortSignal(signal);
		const outcome = await executeAgentStep(params, tools, step);
		if (outcome) {
			return finishRun(onEvent, outcome);
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
