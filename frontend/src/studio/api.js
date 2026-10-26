import { API_BASE_URL } from "../config.js";

const BASE = `${API_BASE_URL}/api/design`;

export class StudioApiError extends Error {
	constructor(message, status, details) {
		super(message);
		this.status = status;
		this.details = details;
	}
}

async function parse(res) {
	const type = res.headers.get("content-type") || "";
	const body = type.includes("json")
		? await res.json().catch(() => ({}))
		: await res.text();
	if (!res.ok) {
		const msg =
			(body && (body.error || body.details)) ||
			`Request failed (${res.status})`;
		throw new StudioApiError(String(msg), res.status, body?.details);
	}
	return body;
}

const opts = (extra = {}) => ({ credentials: "same-origin", ...extra });
const enc = encodeURIComponent;

export const api = {
	listProjects: () =>
		fetch(`${BASE}/projects`, opts())
			.then(parse)
			.then((r) => r.projects),
	tool: (name, args) =>
		fetch(
			`${BASE}/tools/${enc(name)}`,
			opts({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(args ?? {}),
			}),
		).then(parse),
	state: (project) =>
		fetch(`${BASE}/projects/${enc(project)}/state`, opts()).then(parse),
	changes: (project, { base, target, file = "board" }) => {
		const q = new URLSearchParams({ file });
		if (base) q.set("base", base);
		if (target) q.set("target", target);
		return fetch(`${BASE}/projects/${enc(project)}/changes?${q}`, opts()).then(
			parse,
		);
	},
	viewUrl: (project, kind, { view = "front", rev = "working" } = {}) =>
		`${BASE}/projects/${enc(project)}/view/${kind}.svg?view=${enc(view)}&rev=${enc(rev)}`,
	viewSvg: (project, kind, options) =>
		fetch(api.viewUrl(project, kind, options), opts()).then(parse),
	exportKinds: () =>
		fetch(`${BASE}/exports`, opts())
			.then(parse)
			.then((r) => r.kinds),
	runExport: (project, kind) =>
		fetch(
			`${BASE}/projects/${enc(project)}/export/${enc(kind)}`,
			opts({ method: "POST" }),
		).then(parse),
	exportUrl: (project, kind, file) =>
		`${BASE}/projects/${enc(project)}/export/${enc(kind)}/${enc(file)}`,
	undo: (project) =>
		fetch(
			`${BASE}/projects/${enc(project)}/undo`,
			opts({ method: "POST" }),
		).then(parse),
	redo: (project) =>
		fetch(
			`${BASE}/projects/${enc(project)}/redo`,
			opts({ method: "POST" }),
		).then(parse),
};

/** Reads a server-sent-event stream from a fetch response and calls onEvent(name, data) for each event. */
export async function readEventStream(response, onEvent) {
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const flush = (block) => {
		const name = /^event: (.*)$/m.exec(block)?.[1];
		const data = /^data: (.*)$/m.exec(block)?.[1];
		if (!name || data === undefined) return;
		try {
			onEvent(name, JSON.parse(data));
		} catch {
			/* ignore a malformed block */
		}
	};
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const blocks = buffer.split("\n\n");
		buffer = blocks.pop() ?? "";
		blocks.forEach(flush);
	}
	buffer += decoder.decode();
	if (buffer.trim()) flush(buffer);
}

export async function streamAssistant({
	project,
	messages,
	apiKey,
	model,
	signal,
	onEvent,
}) {
	const response = await fetch(
		`${BASE}/agent`,
		opts({
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(apiKey ? { "x-gemini-api-key": apiKey } : {}),
			},
			body: JSON.stringify({ project, messages, model }),
			signal,
		}),
	);
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new StudioApiError(
			body.error || `Request failed (${response.status})`,
			response.status,
		);
	}
	await readEventStream(response, onEvent);
}
