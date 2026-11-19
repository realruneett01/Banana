const OPENABLE_KINDS = new Set(["schematic", "pcb"]);
const BASE64_CHUNK = 0x8000;

export function joinPath(dir, file) {
	if (!dir || !file) return "";
	const sep = dir.includes("\\") ? "\\" : "/";
	const trimmed = dir.endsWith(sep) ? dir.slice(0, -1) : dir;
	return `${trimmed}${sep}${file}`;
}

export function fileOpenTarget(projectRoot, file) {
	if (!OPENABLE_KINDS.has(file?.kind)) return null;
	return {
		projectRoot,
		filePath: joinPath(projectRoot, file.name),
		kind: file.kind,
	};
}

export function bytesToBase64(bytes) {
	let binary = "";
	for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
	}
	return btoa(binary);
}

async function requestJson(url, init, fetchImpl) {
	try {
		const res = await fetchImpl(url, init);
		const data = await res.json().catch(() => null);
		if (res.status >= 300) {
			return { ok: false, error: data?.error || "Request failed" };
		}
		return { ok: true, data };
	} catch (err) {
		return { ok: false, error: err?.message || "Network error" };
	}
}

export async function listProjectFiles(projectRoot, deps) {
	const { baseUrl, headers, fetchImpl = fetch } = deps;
	const query = encodeURIComponent(projectRoot);
	const url = `${baseUrl}/api/projects/files?projectRoot=${query}`;
	const res = await requestJson(url, { headers }, fetchImpl);
	if (!res.ok) return res;
	const files = Array.isArray(res.data?.files) ? res.data.files : [];
	return { ok: true, files };
}

export async function importProjectFile(projectRoot, file, deps) {
	const { baseUrl, headers, fetchImpl = fetch } = deps;
	const bytes = new Uint8Array(await file.arrayBuffer());
	const body = JSON.stringify({
		projectRoot,
		name: file.name,
		contentBase64: bytesToBase64(bytes),
	});
	const init = { method: "POST", headers, body };
	const res = await requestJson(
		`${baseUrl}/api/projects/import`,
		init,
		fetchImpl,
	);
	return res.ok ? { ok: true } : res;
}
