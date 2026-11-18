let resolvedApiBaseUrl = "http://localhost:5000";
try {
	// Load Vite config when available; catch in Node tests where import.meta.env is undefined
	const config = await import("../config.js");
	resolvedApiBaseUrl = config.API_BASE_URL;
} catch (_err) {
	const raw =
		typeof process !== "undefined" ? process.env?.VITE_API_URL : undefined;
	resolvedApiBaseUrl =
		raw && raw.trim() !== ""
			? raw.trim().replace(/\/+$/, "")
			: "http://localhost:5000";
}

export const API_BASE_URL = resolvedApiBaseUrl;

function getMimeType(name = "") {
	const lower = String(name).toLowerCase();
	if (lower.endsWith(".pdf")) return "application/pdf";
	if (lower.endsWith(".csv")) return "text/csv";
	if (lower.endsWith(".step") || lower.endsWith(".stp")) return "model/step";
	return "application/octet-stream";
}

export function decodeBase64ToBlob(base64, name = "") {
	const type = getMimeType(name);
	const binary = atob(base64 ?? "");
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	return new Blob([bytes], { type });
}

function downloadSingleFile(file, doc) {
	const blob = file.blob ?? decodeBase64ToBlob(file.base64, file.name);
	const url = URL.createObjectURL(blob);
	const link = doc.createElement("a");
	link.href = url;
	link.download = file.name;
	doc.body?.appendChild?.(link);
	link.click();
	doc.body?.removeChild?.(link);
	URL.revokeObjectURL(url);
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

export async function requestFabOutputs({
	pcbText,
	pcb,
	name,
	outputs,
	fetchImpl = fetch,
	baseUrl = API_BASE_URL,
}) {
	const host = (baseUrl ?? "").replace(/\/+$/, "");
	const res = await fetchImpl(`${host}/api/fab/export`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ pcb: pcbText ?? pcb, name, outputs }),
	});
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(body?.error || `Export failed with status ${res.status}`);
	}
	const data = await res.json();
	return data?.files ?? [];
}
