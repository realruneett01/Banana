import * as THREE from "three";

let resolvedApiBaseUrl = "http://localhost:5000";
try {
	const config = await import("../../config.js");
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

const modelCache = new Map();
let occtPromise = null;

export function footprintToModelPath(footprint) {
	if (!footprint || typeof footprint !== "string") return null;
	const trimmed = footprint.trim();
	const parts = trimmed.split(":");
	if (parts.length !== 2) return null;
	const lib = parts[0].trim();
	const name = parts[1].trim();
	if (!lib || !name) return null;
	return `\${KICAD10_3DMODEL_DIR}/${lib}.3dshapes/${name}.step`;
}

function parseMeshColor(color, THREE_LIB) {
	if (!Array.isArray(color)) return new THREE_LIB.Color(0x888888);
	if (color.length < 3) return new THREE_LIB.Color(0x888888);
	const hasHigh = color.some((c) => c > 1);
	const scale = hasHigh ? 255 : 1;
	return new THREE_LIB.Color(
		color[0] / scale,
		color[1] / scale,
		color[2] / scale,
	);
}

function createMeshGeometry(meshData, THREE_LIB) {
	const posArr = meshData?.attributes?.position?.array;
	if (!posArr) return null;
	const geom = new THREE_LIB.BufferGeometry();
	geom.setAttribute(
		"position",
		new THREE_LIB.BufferAttribute(new Float32Array(posArr), 3),
	);
	const normArr = meshData?.attributes?.normal?.array;
	if (normArr) {
		geom.setAttribute(
			"normal",
			new THREE_LIB.BufferAttribute(new Float32Array(normArr), 3),
		);
	} else {
		geom.computeVertexNormals();
	}
	const idxArr = meshData?.index?.array;
	if (idxArr) {
		geom.setIndex(new THREE_LIB.BufferAttribute(new Uint32Array(idxArr), 1));
	}
	return geom;
}

export function occtResultToGroup(result, THREE_LIB = THREE) {
	if (!result?.meshes || !Array.isArray(result.meshes)) return null;
	const group = new THREE_LIB.Group();
	for (const meshData of result.meshes) {
		const geom = createMeshGeometry(meshData, THREE_LIB);
		if (!geom) continue;
		const color = parseMeshColor(meshData.color, THREE_LIB);
		const mat = new THREE_LIB.MeshStandardMaterial({
			color,
			roughness: 0.5,
			metalness: 0.1,
		});
		const mesh = new THREE_LIB.Mesh(geom, mat);
		if (meshData.name) mesh.name = meshData.name;
		group.add(mesh);
	}
	return group;
}

export function cloneModel(group) {
	if (!group) return null;
	const clone = new group.constructor();
	for (const child of group.children) {
		if (child.isMesh) {
			const mat = Array.isArray(child.material)
				? child.material.map((m) => m.clone())
				: child.material.clone();
			const m = new child.constructor(child.geometry.clone(), mat);
			m.name = child.name;
			clone.add(m);
		} else {
			clone.add(child.clone(true));
		}
	}
	return clone;
}

async function defaultOcctLoader() {
	if (!occtPromise) {
		occtPromise = (async () => {
			const [{ default: initOcct }, wasmModule] = await Promise.all([
				import("occt-import-js"),
				import("occt-import-js/dist/occt-import-js.wasm?url"),
			]);
			const wasmUrl = wasmModule.default;
			const factory =
				typeof initOcct === "function" ? initOcct : initOcct.default;
			return factory({
				locateFile: () => wasmUrl,
			});
		})();
	}
	return occtPromise;
}

async function fetchModelStep(url, fetchImpl) {
	try {
		const res = await fetchImpl(url);
		if (!res.ok) return null;
		const buffer = await res.arrayBuffer();
		return new Uint8Array(buffer);
	} catch {
		return null;
	}
}

async function parseStepData(bytes, occtLoader) {
	try {
		const occt = await occtLoader();
		if (!occt || typeof occt.ReadStepFile !== "function") return null;
		const result = occt.ReadStepFile(bytes, null);
		if (!result?.success) return null;
		return occtResultToGroup(result, THREE);
	} catch {
		return null;
	}
}

export async function loadModel(
	footprint,
	{
		fetchImpl = fetch,
		baseUrl = API_BASE_URL,
		occtLoader = defaultOcctLoader,
	} = {},
) {
	const modelPath = footprintToModelPath(footprint);
	if (!modelPath) return null;
	if (modelCache.has(modelPath)) {
		return modelCache.get(modelPath);
	}
	const promise = (async () => {
		const host = (baseUrl ?? API_BASE_URL).replace(/\/+$/, "");
		const url = `${host}/api/models?path=${encodeURIComponent(modelPath)}`;
		const bytes = await fetchModelStep(url, fetchImpl);
		if (!bytes) return null;
		return parseStepData(bytes, occtLoader);
	})();
	modelCache.set(modelPath, promise);
	return promise;
}

function disposeModel(group) {
	if (!group?.children) return;
	for (const child of group.children) {
		child.geometry?.dispose();
		child.material?.dispose();
	}
}

export function disposeModelCache() {
	for (const promise of modelCache.values()) {
		if (promise && typeof promise.then === "function") {
			promise.then((group) => disposeModel(group)).catch(() => {});
		}
	}
	modelCache.clear();
}
