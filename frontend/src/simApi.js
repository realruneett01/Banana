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
	const { message, approved, maxSteps } = params || {};
	const body = { message };
	if (approved !== undefined) {
		body.approved = approved;
	}
	if (maxSteps !== undefined) {
		body.maxSteps = maxSteps;
	}
	return body;
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

function buildBaseMethods(send, h) {
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
		runAgent: (params = {}, { signal } = {}) =>
			send("/api/agent/run", postOptions(h, buildAgentPayload(params)), signal),
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

export function createSimApi({
	baseUrl = "",
	fetchImpl = globalThis.fetch,
	headers = {},
} = {}) {
	const base = cleanBaseUrl(baseUrl);
	const h = { "Content-Type": "application/json", ...headers };
	const send = (p, opt, sig) =>
		executeRequest(fetchImpl, `${base}${p}`, opt, sig);

	return {
		...buildBaseMethods(send, h),
		...buildRunMethods(send, h),
		...buildCircuitMethods(send, h),
		...buildLibraryMethods(send, h),
	};
}
