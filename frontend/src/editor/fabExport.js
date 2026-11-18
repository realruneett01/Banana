async function resolveBaseUrl() {
	try {
		const mod = await import("../config.js");
		return mod.API_BASE_URL;
	} catch (_err) {
		// Fallback for Node test environment where import.meta.env is undefined
		const envVal =
			typeof process !== "undefined" ? process.env?.VITE_API_URL : null;
		return envVal?.trim()
			? envVal.trim().replace(/\/+$/, "")
			: "http://localhost:5000";
	}
}

export const API_BASE_URL = await resolveBaseUrl();

const MIME_BY_EXT = {
	pdf: "application/pdf",
	csv: "text/csv",
	step: "model/step",
	stp: "model/step",
};

function getMimeType(name = "") {
	const match = String(name)
		.toLowerCase()
		.match(/\.([a-z0-9]+)$/);
	const ext = match ? match[1] : "";
	return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function decodeBase64ToBlob(base64, name = "") {
	const type = getMimeType(name);
	const binary = atob(base64 ?? "");
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	return new Blob([bytes], { type });
}

function triggerAnchorDownload(doc, targetUrl, fileName) {
	const anchor = Object.assign(doc.createElement("a"), {
		href: targetUrl,
		download: fileName,
	});
	doc.body?.appendChild?.(anchor);
	anchor.click();
	doc.body?.removeChild?.(anchor);
}

function downloadSingleFile(file, doc) {
	const payload = file.blob ?? decodeBase64ToBlob(file.base64, file.name);
	const resourceUrl = URL.createObjectURL(payload);
	try {
		triggerAnchorDownload(doc, resourceUrl, file.name);
	} finally {
		URL.revokeObjectURL(resourceUrl);
	}
}

export function downloadFiles(
	files,
	{ doc = typeof document !== "undefined" ? document : null } = {},
) {
	if (!Array.isArray(files) || !doc) return;
	for (const file of files) {
		downloadSingleFile(file, doc);
	}
}

async function parseFabResponse(response) {
	if (response.ok) {
		const result = await response.json();
		return result?.files ?? [];
	}
	const payload = await response.json().catch(() => null);
	throw new Error(
		payload?.error || `Export failed with status ${response.status}`,
	);
}

export async function requestFabOutputs({
	pcbText,
	pcb,
	name,
	outputs,
	fetchImpl = fetch,
	baseUrl = API_BASE_URL,
}) {
	const sanitizedHost = String(baseUrl ?? "").replace(/\/+$/, "");
	const exportUrl = `${sanitizedHost}/api/fab/export`;
	const requestOptions = {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			pcb: pcbText ?? pcb,
			name,
			outputs,
		}),
	};
	const res = await fetchImpl(exportUrl, requestOptions);
	return parseFabResponse(res);
}
