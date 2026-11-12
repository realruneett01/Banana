function cleanBaseUrl(url) {
	if (typeof url !== "string") {
		return "";
	}
	return url.replace(/\/+$/, "");
}

function isAbortError(err, signal) {
	if (signal?.aborted) {
		return true;
	}
	return err?.name === "AbortError" || err?.message === "aborted";
}

function handleFetchError(err, signal) {
	if (isAbortError(err, signal)) {
		return { ok: false, status: 0, error: "aborted" };
	}
	const message = err?.message || String(err);
	return { ok: false, status: 0, error: `Network error: ${message}` };
}

async function readResponseText(response) {
	if (typeof response.text !== "function") {
		return null;
	}
	try {
		return await response.text();
	} catch {
		// Response text read failed
		return "";
	}
}

async function parseJsonFallback(response) {
	if (typeof response.json !== "function") {
		return { hasJson: false, data: undefined, rawText: "" };
	}
	try {
		const data = await response.json();
		return { hasJson: true, data, rawText: "" };
	} catch {
		// Response json parse failed for non-JSON body
		return { hasJson: false, data: undefined, rawText: "" };
	}
}

async function parseResponseBody(response) {
	const rawText = await readResponseText(response);
	if (rawText === null) {
		return parseJsonFallback(response);
	}
	try {
		const trimmed = rawText.trim();
		const data = trimmed ? JSON.parse(trimmed) : undefined;
		return { hasJson: Boolean(trimmed && data !== undefined), data, rawText };
	} catch {
		// JSON parse failed for non-JSON body
		return { hasJson: false, data: undefined, rawText };
	}
}

function extractErrorMessage(data, rawText, statusText, status) {
	if (typeof data?.error === "string") {
		return data.error;
	}
	if (typeof data?.error?.message === "string") {
		return data.error.message;
	}
	if (typeof data?.message === "string") {
		return data.message;
	}
	const trimmed = typeof rawText === "string" ? rawText.trim() : "";
	if (trimmed) {
		return trimmed;
	}
	return statusText || `HTTP ${status}`;
}

function buildFailureResult(response, parsed) {
	const { status, statusText } = response;
	const { hasJson, data, rawText } = parsed;
	const error = extractErrorMessage(data, rawText, statusText, status);
	const result = { ok: false, status, error };
	if (hasJson && data !== undefined) {
		result.data = data;
	}
	return result;
}

function buildSuccessResult(response, parsed) {
	if (!parsed.hasJson) {
		return buildFailureResult(response, parsed);
	}
	return { ok: true, data: parsed.data };
}

async function executeRequest(fetchImpl, url, options, signal) {
	try {
		const response = await fetchImpl(url, { ...options, signal });
		const parsed = await parseResponseBody(response);
		if (!response.ok) {
			return buildFailureResult(response, parsed);
		}
		return buildSuccessResult(response, parsed);
	} catch (err) {
		return handleFetchError(err, signal);
	}
}

function buildAgentPayload(params) {
	const { message, approved, maxSteps, provider } = params || {};
	const body = { message };
	if (approved !== undefined) {
		body.approved = approved;
	}
	if (maxSteps !== undefined) {
		body.maxSteps = maxSteps;
	}
	if (typeof provider === "string") {
		body.provider = provider;
	}
	return body;
}

const KNOWN_SSE_EVENTS = new Set(["step", "result", "error"]);

function parseFrameLine(line, state) {
	if (line.startsWith(":")) {
		return;
	}
	if (line.startsWith("event:")) {
		state.event = line.slice(6).trim();
		return;
	}
	if (line.startsWith("data:")) {
		const val = line.slice(5);
		state.dataLines.push(val.startsWith(" ") ? val.slice(1) : val);
	}
}

function parseFrameBlock(block) {
	const lines = block.split(/\r?\n/);
	const state = { event: "", dataLines: [] };
	for (const line of lines) {
		parseFrameLine(line, state);
	}
	if (!KNOWN_SSE_EVENTS.has(state.event) || state.dataLines.length === 0) {
		return null;
	}
	return { event: state.event, data: JSON.parse(state.dataLines.join("\n")) };
}

export function parseSseChunk(buffer) {
	if (typeof buffer !== "string" || !buffer) {
		return { frames: [], rest: "" };
	}
	const delimiterRegex = /\r?\n\r?\n/g;
	const frames = [];
	let lastIndex = 0;
	let match = delimiterRegex.exec(buffer);
	while (match !== null) {
		const block = buffer.slice(lastIndex, match.index);
		lastIndex = match.index + match[0].length;
		if (block.trim()) {
			const frame = parseFrameBlock(block);
			if (frame) {
				frames.push(frame);
			}
		}
		match = delimiterRegex.exec(buffer);
	}
	return { frames, rest: buffer.slice(lastIndex) };
}

function dispatchStreamFrames(frames, onStep) {
	let result = null;
	for (const frame of frames) {
		if (frame.event === "step") {
			onStep?.(frame.data);
		} else if (frame.event === "result") {
			result = frame.data;
		} else if (frame.event === "error") {
			return {
				error: frame.data?.error || "Agent execution failed",
				result: null,
			};
		}
	}
	return { error: null, result };
}

function finishStream(resultData) {
	if (resultData !== null) {
		return { ok: true, data: resultData };
	}
	return { ok: false, status: 0, error: "Stream ended without a result frame" };
}

async function processStreamChunks(reader, onStep, signal) {
	const decoder = new TextDecoder();
	let buffer = "";
	let resultData = null;
	while (true) {
		if (signal?.aborted) {
			reader.cancel().catch(() => {});
			return { ok: false, status: 0, error: "aborted" };
		}
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const parsed = parseSseChunk(buffer);
		buffer = parsed.rest;
		const outcome = dispatchStreamFrames(parsed.frames, onStep);
		if (outcome.error) {
			reader.cancel().catch(() => {});
			return { ok: false, status: 0, error: outcome.error };
		}
		if (outcome.result !== null) {
			resultData = outcome.result;
		}
	}
	return finishStream(resultData);
}

async function readAgentStream(response, { signal, onStep }) {
	const reader = response.body?.getReader?.();
	if (!reader) {
		return { ok: false, status: 0, error: "Stream body is not readable" };
	}
	try {
		return await processStreamChunks(reader, onStep, signal);
	} catch (err) {
		reader.cancel().catch(() => {});
		if (isAbortError(err, signal)) {
			return { ok: false, status: 0, error: "aborted" };
		}
		return { ok: false, status: 0, error: err?.message || String(err) };
	}
}

async function executeAgentStream(
	fetchImpl,
	url,
	requestOptions,
	streamOptions,
) {
	const { signal, onStep, fallback, params } = streamOptions;
	let response;
	try {
		response = await fetchImpl(url, { ...requestOptions, signal });
	} catch (err) {
		return handleFetchError(err, signal);
	}
	if (response.status === 404 || response.status === 405) {
		return fallback(params, { signal });
	}
	if (!response.ok) {
		const parsed = await parseResponseBody(response);
		return buildFailureResult(response, parsed);
	}
	return readAgentStream(response, { signal, onStep });
}

function postOptions(headers, body) {
	return {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	};
}

function patchOptions(headers, body) {
	return {
		method: "PATCH",
		headers,
		body: JSON.stringify(body),
	};
}

function buildRunsQuery(filters) {
	if (!filters || typeof filters !== "object") {
		return "";
	}
	const params = new URLSearchParams();
	for (const [key, val] of Object.entries(filters)) {
		if (val !== undefined && val !== null && val !== "") {
			params.set(key, String(val));
		}
	}
	const qs = params.toString();
	return qs ? `?${qs}` : "";
}

function buildBaseMethods(send, h, runStream) {
	const runAgent = (params = {}, { signal } = {}) =>
		send("/api/agent/run", postOptions(h, buildAgentPayload(params)), signal);
	return {
		getKinds: ({ signal } = {}) =>
			send("/api/sim/kinds", { method: "GET", headers: h }, signal),
		runSim: ({ kind, env, commit, inputs } = {}, { signal } = {}) =>
			send(
				"/api/sim/run",
				postOptions(h, { kind, env, commit, inputs }),
				signal,
			),
		runErc: ({ ir, commit } = {}, { signal } = {}) =>
			send("/api/erc/run", postOptions(h, { ir, commit }), signal),
		runAgent,
		runAgentStream: (params = {}, { signal, onStep } = {}) =>
			runStream(params, { signal, onStep, fallback: runAgent }),
	};
}

function buildRunMethods(send, h) {
	return {
		listRuns: (filters = {}, { signal } = {}) =>
			send(
				`/api/sim/runs${buildRunsQuery(filters)}`,
				{ method: "GET", headers: h },
				signal,
			),
		getRun: (id, { signal } = {}) =>
			send(
				`/api/sim/runs/${encodeURIComponent(id)}`,
				{ method: "GET", headers: h },
				signal,
			),
		compareCommits: ({ before, after, envId, kind } = {}, { signal } = {}) =>
			send(
				"/api/sim/compare",
				postOptions(h, { before, after, envId, kind }),
				signal,
			),
		setIssueStatus: (id, status, { signal } = {}) =>
			send(
				`/api/issues/${encodeURIComponent(id)}`,
				patchOptions(h, { status }),
				signal,
			),
	};
}

function buildCircuitMethods(send, h) {
	return {
		simulateCircuit: ({ ir, fault, analysis } = {}, { signal } = {}) =>
			send(
				"/api/circuit/simulate",
				postOptions(h, { ir, fault, analysis }),
				signal,
			),
		suggestFaults: ({ ir } = {}, { signal } = {}) =>
			send("/api/circuit/suggest-faults", postOptions(h, { ir }), signal),
	};
}

function buildLibrarySearchQuery(q, limit) {
	const params = new URLSearchParams();
	if (q !== undefined && q !== null) {
		params.set("q", String(q));
	}
	if (limit !== undefined && limit !== null && limit !== "") {
		params.set("limit", String(limit));
	}
	const qs = params.toString();
	return qs ? `?${qs}` : "";
}

function buildLibraryMethods(send, h) {
	return {
		libraryStatus: ({ signal } = {}) =>
			send("/api/library/status", { method: "GET", headers: h }, signal),
		searchSymbols: (q, { limit, signal } = {}) =>
			send(
				`/api/library/symbols${buildLibrarySearchQuery(q, limit)}`,
				{ method: "GET", headers: h },
				signal,
			),
		getSymbol: (libId, { signal } = {}) =>
			send(
				`/api/library/symbols/${encodeURIComponent(libId)}`,
				{ method: "GET", headers: h },
				signal,
			),
		searchFootprints: (q, { limit, signal } = {}) =>
			send(
				`/api/library/footprints${buildLibrarySearchQuery(q, limit)}`,
				{ method: "GET", headers: h },
				signal,
			),
		getFootprint: (libId, { signal } = {}) =>
			send(
				`/api/library/footprints/${encodeURIComponent(libId)}`,
				{ method: "GET", headers: h },
				signal,
			),
	};
}

function buildEditorMethods(send, h) {
	return {
		editorCheck: ({ ir, board, rules } = {}, { signal } = {}) =>
			send("/api/editor/check", postOptions(h, { ir, board, rules }), signal),
		editorExport: ({ ir, board, title } = {}, { signal } = {}) =>
			send("/api/editor/export", postOptions(h, { ir, board, title }), signal),
		editorImport: ({ kind, text } = {}, { signal } = {}) =>
			send(
				`/api/editor/import?kind=${encodeURIComponent(kind)}`,
				{
					method: "POST",
					headers: { ...h, "Content-Type": "text/plain" },
					body: text,
				},
				signal,
			),
		editorCommit: ({ repoPath, files, message } = {}, { signal } = {}) =>
			send(
				"/api/editor/commit",
				postOptions(h, { repoPath, files, message }),
				signal,
			),
	};
}

export function createSimApi({
	baseUrl = "",
	fetchImpl = globalThis.fetch,
	headers = {},
} = {}) {
	const base = cleanBaseUrl(baseUrl);
	const h = { "Content-Type": "application/json", ...headers };
	const send = (p, opt, sig) =>
		executeRequest(fetchImpl, `${base}${p}`, opt, sig);
	const runStream = (params, opt) =>
		executeAgentStream(
			fetchImpl,
			`${base}/api/agent/run/stream`,
			postOptions(h, buildAgentPayload(params)),
			{ ...opt, params },
		);

	return {
		...buildBaseMethods(send, h, runStream),
		...buildRunMethods(send, h),
		...buildCircuitMethods(send, h),
		...buildLibraryMethods(send, h),
		...buildEditorMethods(send, h),
	};
}
