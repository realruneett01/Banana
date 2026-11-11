// Framework-agnostic three.js engine for the 3D hologram board viewer.
// Takes the GLB produced by `kicad-cli pcb export glb` (POST /api/board/glb), splits the
// single copper/pad mesh into per-layer meshes by height, and stacks the layers so they
// can be exploded, soloed and inspected one by one.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const FIT_SIZE = 10; // board fitted to this many scene units across
const GAP = 1.1; // scene units between exploded layers at spacing 1
// Graphics presets. pr = max pixel ratio (ultra supersamples), samples = MSAA for the post-processing (bloom) path.
const QUALITY = {
	low: { pr: 0.75, samples: 0 },
	medium: { pr: 1, samples: 2 },
	high: { pr: 2, samples: 4 },
	ultra: { pr: 3, samples: 8 },
};

// KiCad 3D-viewer colours (sRGB, as written by kicad-cli) with a metallic finish.
export const KICAD_MATERIALS = {
	soldermask: {
		c: [0.08, 0.2, 0.14],
		metal: 0,
		rough: 0.35,
		op: 0.83,
		cc: 0.3,
		em: 0.55,
	},
	silkscreen: { c: [1.0, 1.0, 1.0], metal: 0, rough: 0.85, op: 0.9, em: 0.15 },
	copper: { c: [0.7, 0.61, 0.0], metal: 1, rough: 0.34 },
	pad: { c: [0.7, 0.61, 0.0], metal: 1, rough: 0.2 },
	via: { c: [0.7, 0.61, 0.0], metal: 1, rough: 0.34 },
	PCB: { c: [0.42, 0.45, 0.29], metal: 0, rough: 0.75, op: 0.98, em: 0.55 },
};

// Stack slots, bottom → top. The bottom-most layer stays put; each layer above rises by its rank * gap.
export const LAYER_SLOTS = [
	{ slot: -1, key: "BComponents", label: "B.Components", holo: 0xffb547 },
	{ slot: 0, key: "BSilkscreen", label: "B.Silkscreen", holo: 0xe8fbff },
	{ slot: 1, key: "BMask", label: "B.Mask", holo: 0x1d6bff },
	{ slot: 2, key: "BCu", label: "B.Cu", holo: 0xff5edb },
	{ slot: 3, key: "In2Cu", label: "In2.Cu", holo: 0x8a7dff },
	{ slot: 4, key: "Core", label: "Core (FR4)", holo: 0x2a5cff },
	{ slot: 5, key: "In1Cu", label: "In1.Cu", holo: 0x2bffc6 },
	{ slot: 6, key: "FCu", label: "F.Cu", holo: 0x4fe3ff },
	{ slot: 7, key: "FMask", label: "F.Mask", holo: 0x1d6bff },
	{ slot: 8, key: "FSilkscreen", label: "F.Silkscreen", holo: 0xe8fbff },
	{ slot: 9, key: "FComponents", label: "F.Components", holo: 0xffb547 },
];
const SWATCH = {
	BComponents: "pad",
	FComponents: "pad",
	BSilkscreen: "silkscreen",
	FSilkscreen: "silkscreen",
	BMask: "soldermask",
	FMask: "soldermask",
	Core: "PCB",
};

const srgb = (c) =>
	new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
export const layerSwatch = (key) =>
	`#${srgb(KICAD_MATERIALS[SWATCH[key] || "copper"].c).getHexString()}`;

function physical(def) {
	const m = new THREE.MeshPhysicalMaterial({
		color: srgb(def.c),
		metalness: def.metal,
		roughness: def.rough,
		clearcoat: def.cc || 0,
		clearcoatRoughness: 0.08,
		transparent: (def.op ?? 1) < 1,
		opacity: def.op ?? 1,
		side: THREE.DoubleSide,
		envMapIntensity: def.metal ? 1.4 : 0.7,
	});
	if (def.em) {
		m.emissive = srgb(def.c);
		m.emissiveIntensity = def.em;
	} // KiCad lights these evenly
	m.userData.op = def.op ?? 1;
	return m;
}

function isGoldPin(r, g, b) {
	if (r <= 0.6 || b >= 0.35) return false;
	return g < 0.6 * r + 0.15;
}

function isTinTerminal(r, b, lum) {
	if (lum <= 0.55 || lum > 0.7) return false;
	return Math.abs(r - b) < 0.12;
}

function deriveFinish(c) {
	const { r, g, b } = c.clone().convertLinearToSRGB();
	const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	if (isGoldPin(r, g, b)) {
		return { metal: 1, rough: 0.2, cc: 0 }; // gold pins
	}
	if (isTinTerminal(r, b, lum)) {
		return { metal: 1, rough: 0.3, cc: 0 }; // tin terminals
	}
	if (lum < 0.05) {
		return { metal: 0, rough: 0.45, cc: 0.3 }; // epoxy mould
	}
	return { metal: 0, rough: 0.5, cc: 0 };
}

// glTF materials from KiCad omit metallicFactor (spec default = 1, fully metallic), which renders
// plastic parts as dark mirrors. Re-derive a plausible finish from the base colour instead.
function componentMaterial(src) {
	const c = src.color ? src.color.clone() : new THREE.Color(0.5, 0.5, 0.5);
	const { metal, rough, cc } = deriveFinish(c);
	const op = src.opacity ?? 1;
	const m = new THREE.MeshPhysicalMaterial({
		color: c,
		metalness: metal,
		roughness: rough,
		clearcoat: cc,
		clearcoatRoughness: 0.1,
		side: THREE.DoubleSide,
		envMapIntensity: metal ? 1.4 : 0.8,
		transparent: op < 1,
		opacity: op,
	});
	m.userData.op = op;
	return m;
}

function holoMaterial(color, alpha, shared) {
	return new THREE.ShaderMaterial({
		uniforms: {
			...shared,
			uColor: { value: new THREE.Color(color) },
			uAlpha: { value: alpha },
			uBoost: { value: 1 },
			uFade: { value: 1 },
		},
		vertexShader: `varying vec3 vN; varying vec3 vW; varying vec3 vV;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
		fragmentShader: `uniform vec3 uColor; uniform float uAlpha, uTime, uGlow, uBoost, uFade, uScanY;
      varying vec3 vN; varying vec3 vW; varying vec3 vV;
      void main() { float fr = pow(1.0 - abs(dot(normalize(vN), vV)), 2.2);
        float lines = 0.85 + 0.15 * sin(vW.y * 90.0 - uTime * 4.0);
        float scan = smoothstep(0.35, 0.0, abs(vW.y - uScanY)) * 2.5;
        float a = (uAlpha + fr * uAlpha * 1.6) * lines * uGlow * uBoost + scan * 0.35;
        gl_FragColor = vec4(uColor * (1.0 + scan), a * uFade); }`,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		blending: THREE.AdditiveBlending,
	});
}

function computeTriangleCentroids(pos, matrixWorld) {
	const triCount = pos.count / 3;
	const ys = new Float64Array(triCount);
	const v = new THREE.Vector3();
	for (let t = 0; t < triCount; t++) {
		let y = 0;
		for (let k = 0; k < 3; k++) {
			v.fromBufferAttribute(pos, t * 3 + k).applyMatrix4(matrixWorld);
			y += v.y;
		}
		ys[t] = Math.round((y / 3) * 1e6) / 1e6;
	}
	return ys;
}

function clusterHeightBands(ys, gap) {
	const uniq = Array.from(new Set(ys)).sort((a, b) => a - b);
	const bands = [];
	let start = uniq[0];
	for (let i = 1; i < uniq.length; i++) {
		if (uniq[i] - uniq[i - 1] > gap) {
			bands.push([start, uniq[i - 1]]);
			start = uniq[i];
		}
	}
	bands.push([start, uniq[uniq.length - 1]]);
	return bands;
}

function copyBandAttributes(idx, pos, nrm) {
	const p = new Float32Array(idx.length * 9);
	const n = nrm ? new Float32Array(idx.length * 9) : null;
	for (let j = 0; j < idx.length; j++) {
		const t = idx[j];
		for (let k = 0; k < 9; k++) {
			p[j * 9 + k] = pos.array[t * 9 + k];
			if (n) n[j * 9 + k] = nrm.array[t * 9 + k];
		}
	}
	return { p, n };
}

function createBandMesh(mesh, { pos, nrm, ys, lo, hi }) {
	const triCount = pos.count / 3;
	const idx = [];
	for (let t = 0; t < triCount; t++) {
		if (ys[t] >= lo - 1e-9 && ys[t] <= hi + 1e-9) idx.push(t);
	}
	const { p, n } = copyBandAttributes(idx, pos, nrm);
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.BufferAttribute(p, 3));
	if (n) g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
	else g.computeVertexNormals();
	const m = new THREE.Mesh(g, mesh.material);
	m.name = mesh.name;
	mesh.matrixWorld.decompose(m.position, m.quaternion, m.scale);
	m.updateMatrixWorld(true);
	m.userData.kind = mesh.userData.kind;
	return m;
}

/** Split a mesh into one mesh per height band (triangle centroid Y, world space). */
function splitByHeight(mesh, gap = 5e-5) {
	const src = mesh.geometry.index
		? mesh.geometry.toNonIndexed()
		: mesh.geometry;
	const pos = src.attributes.position;
	const nrm = src.attributes.normal;
	const ys = computeTriangleCentroids(pos, mesh.matrixWorld);
	const bands = clusterHeightBands(ys, gap);
	if (bands.length === 1) return [mesh];
	return bands.map(([lo, hi]) =>
		createBandMesh(mesh, { pos, nrm, ys, lo, hi }),
	);
}

const centerY = (o) =>
	new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).y;

function cleanGeometryAttributes(g) {
	for (const name of Object.keys(g.attributes)) {
		if (name !== "position" && name !== "normal") {
			g.deleteAttribute(name);
		}
	}
	g.morphAttributes = {};
	if (!g.attributes.normal) {
		g.computeVertexNormals();
	}
}

function bakeMeshGeometry(mesh, indexed) {
	mesh.updateMatrixWorld(true);
	const geom = mesh.geometry;
	const g = !indexed && geom.index ? geom.toNonIndexed() : geom.clone();
	cleanGeometryAttributes(g);
	return g.applyMatrix4(mesh.matrixWorld);
}

/** Merge meshes into one geometry, baking each world transform (layer groups start at the holder origin). */
function mergeBaked(meshes) {
	const indexed = meshes.every((o) => o.geometry.index);
	const geoms = meshes.map((o) => bakeMeshGeometry(o, indexed));
	const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms);
	if (!merged) {
		throw new Error("Could not merge board meshes (incompatible attributes)");
	}
	if (geoms.length > 1) {
		geoms.forEach((g) => {
			g.dispose();
		});
	}
	merged.computeBoundingSphere();
	merged.computeBoundingBox();
	return merged;
}

function createAdditiveMaterial(color, opacity) {
	return new THREE.MeshBasicMaterial({
		color,
		transparent: true,
		opacity,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
		depthWrite: false,
	});
}

function addProjectorRings(base) {
	for (const [r, o] of [
		[9.05, 0.6],
		[6.4, 0.3],
		[3.2, 0.2],
	]) {
		const ring = new THREE.Mesh(
			new THREE.RingGeometry(r - 0.03, r, 160),
			createAdditiveMaterial(0x4fe3ff, o),
		);
		ring.rotation.x = -Math.PI / 2;
		base.add(ring);
	}
}

function createProjectorBase(scene) {
	const base = new THREE.Group();
	scene.add(base);
	const polar = new THREE.PolarGridHelper(9, 24, 8, 96, 0x1a6f8a, 0x0d3a4a);
	polar.material.transparent = true;
	polar.material.opacity = 0.3;
	polar.material.blending = THREE.AdditiveBlending;
	base.add(polar);
	addProjectorRings(base);
	const tick = new THREE.Mesh(
		new THREE.RingGeometry(9.25, 9.6, 160, 1, 0, Math.PI * 0.35),
		createAdditiveMaterial(0xffb547, 0.45),
	);
	tick.rotation.x = -Math.PI / 2;
	base.add(tick);
	return { base, polar, tick };
}

function initRenderer(container) {
	const renderer = new THREE.WebGLRenderer({
		antialias: true,
		powerPreference: "high-performance",
		preserveDrawingBuffer: false,
	});
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	container.appendChild(renderer.domElement);
	renderer.domElement.style.display = "block";
	renderer.domElement.style.touchAction = "none"; // OrbitControls handles pinch/rotate on phones
	return renderer;
}

function initScene(renderer) {
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x05070c);
	scene.fog = new THREE.FogExp2(0x05070c, 0.012);
	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
	scene.environmentIntensity = 0.45;
	const key = new THREE.DirectionalLight(0xffffff, 2.2);
	key.position.set(-8, 14, 10);
	scene.add(key);
	const rim = new THREE.DirectionalLight(0x9fdcff, 1.2);
	rim.position.set(10, 6, -12);
	scene.add(rim);
	return { scene, pmrem };
}

function initCameraAndControls(domElement) {
	const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 500);
	camera.position.set(-14, 12, 18);
	const controls = new OrbitControls(camera, domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.06;
	controls.autoRotate = true;
	controls.autoRotateSpeed = 0.5;
	controls.target.set(0, 3.2, 0);
	controls.minDistance = 1;
	controls.maxDistance = 60;
	return { camera, controls };
}

function initComposer(renderer, scene, camera) {
	const composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0, 0.3, 0.9); // off by default: crisp parts
	bloom.enabled = false;
	composer.addPass(bloom);
	composer.addPass(new OutputPass());
	return { composer, bloom };
}

const HOLO_ALPHA = {
	copper: 0.1,
	pad: 0.1,
	via: 0.1,
	silkscreen: 0.3,
	soldermask: 0.035,
	PCB: 0.02,
};

const SPLITTABLE_KINDS = new Set(["copper", "pad", "soldermask", "silkscreen"]);

function getMeshKind(o, gltf) {
	const a = gltf.parser.associations.get(o);
	const meshName =
		a?.meshes !== undefined
			? gltf.parser.json.meshes[a.meshes]?.name || ""
			: "";
	return /_(copper|pad|via|silkscreen|soldermask|PCB)$/.exec(meshName)?.[1];
}

function hasBoardMesh(node) {
	let found = false;
	node.traverse((o) => {
		if (o.userData.kind) found = true;
	});
	return found;
}

function classifyGltfNodes(gltf) {
	const boardMeshes = [];
	const comps = [];
	gltf.scene.traverse((o) => {
		if (!o.isMesh) return;
		const kind = getMeshKind(o, gltf);
		if (kind) {
			o.userData.kind = kind;
			boardMeshes.push(o);
		}
	});
	const topNodes = gltf.scene.children[0]?.children ?? gltf.scene.children;
	for (const top of topNodes) {
		if (!hasBoardMesh(top) && top.name) comps.push(top);
	}
	return { boardMeshes, comps };
}

function copperSlot(y, cu) {
	const near = cu.reduce(
		(a, c) => (Math.abs(c - y) < Math.abs(a - y) ? c : a),
		cu[0],
	);
	if (Math.abs(near - y) > 1e-4) return 4; // through-hole barrels span the board
	const i = cu.indexOf(near);
	const n = cu.length;
	if (i === n - 1) return 6;
	if (i === 0) return 2;
	return i === n - 2 ? 5 : 3;
}

function createSlotResolver(mid, cu) {
	return (m) => {
		const k = m.userData.kind;
		const y = centerY(m);
		if (k === "silkscreen") return y > mid ? 8 : 0;
		if (k === "soldermask") return y > mid ? 7 : 1;
		if (k === "copper" || k === "pad") return copperSlot(y, cu);
		return 4;
	};
}

function getBoardHeights(split) {
	const body = split.find((m) => m.userData.kind === "PCB");
	if (!body) {
		throw new Error("3D model has no board body (missing *_PCB mesh)");
	}
	const bb = new THREE.Box3().setFromObject(body);
	const mid = (bb.min.y + bb.max.y) / 2;
	const cu = Array.from(
		new Set(
			split
				.filter((m) => m.userData.kind === "copper")
				.map((m) => Math.round(centerY(m) * 1e5) / 1e5),
		),
	).sort((a, b) => a - b);
	return { mid, cu, topY: bb.max.y };
}

function fitHolder(holder, root, bodyTopY) {
	const full = new THREE.Box3().setFromObject(root);
	const size = full.getSize(new THREE.Vector3());
	const ctr = full.getCenter(new THREE.Vector3());
	const s = FIT_SIZE / Math.max(size.x, size.z);
	holder.scale.setScalar(s);
	holder.position.set(-ctr.x * s, -full.min.y * s + 1.2, -ctr.z * s);
	const topY = (bodyTopY - full.min.y) * s + 1.2;
	return { size, ctr, s, topY };
}

function createGroupManager(holder) {
	const groups = new Map();
	const groupFor = (slot) => {
		if (!groups.has(slot)) {
			const def = LAYER_SLOTS.find((d) => d.slot === slot);
			const g = new THREE.Group();
			holder.add(g);
			groups.set(slot, {
				...def,
				k: 0,
				group: g,
				meshes: [],
				lines: [],
				fade: 0,
				target: 1,
				visible: true,
			});
		}
		return groups.get(slot);
	};
	return { groups, groupFor };
}

// KiCad emits thousands of tiny meshes (~56k draw calls/frame unmerged). Bake each into board space
// and merge per layer+kind (board) or per component+material (parts) → a few hundred draw calls.
function collectMeshBuckets({ split, comps, slotOf, mid, groupFor }) {
	const buckets = new Map();
	const bucket = (key, init) => {
		if (!buckets.has(key)) buckets.set(key, { ...init, srcs: [] });
		return buckets.get(key);
	};
	for (const m of split) {
		const slot = slotOf(m);
		const kind = m.userData.kind;
		bucket(`b|${slot}|${kind}`, { L: groupFor(slot), kind }).srcs.push(m);
	}
	for (const c of comps) {
		const L = groupFor(centerY(c) > mid ? 9 : -1);
		c.traverse((o) => {
			if (!o.isMesh) return;
			const mat = o.material;
			const key = `c|${c.name}|${mat.color?.getHexString()}|${mat.opacity ?? 1}`;
			bucket(key, { L, ref: c.name, src: mat }).srcs.push(o);
		});
	}
	return buckets;
}

function createPcbOutline(geometry) {
	// faint outline keeps the stack readable as a projection
	const ls = new THREE.LineSegments(
		new THREE.EdgesGeometry(geometry, 35),
		new THREE.LineBasicMaterial({
			color: 0x4fe3ff,
			transparent: true,
			opacity: 0.35,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		}),
	);
	ls.userData.base = 0.35;
	return ls;
}

function buildBucketMesh(b, shared, parts) {
	const m = new THREE.Mesh(mergeBaked(b.srcs));
	if (b.ref) {
		m.userData.metal = componentMaterial(b.src);
		m.userData.holo = holoMaterial(b.L.holo, 0.05, shared);
		m.userData.ref = b.ref;
		parts.push(m);
	} else {
		m.userData.kind = b.kind;
		m.userData.metal = physical(KICAD_MATERIALS[b.kind]);
		m.userData.holo = holoMaterial(b.L.holo, HOLO_ALPHA[b.kind] ?? 0.1, shared);
		if (b.kind === "PCB") {
			const ls = createPcbOutline(m.geometry);
			m.add(ls);
			b.L.lines.push(ls);
		}
	}
	m.material = m.userData.metal;
	b.L.group.add(m);
	b.L.meshes.push(m);
}

function populateBuckets(buckets, shared, parts, split) {
	for (const b of buckets.values()) {
		buildBucketMesh(b, shared, parts);
	}
	for (const m of split) m.geometry.dispose();
}

function finalizeLayers(groups) {
	const sorted = [...groups.values()].sort((a, b) => a.slot - b.slot);
	sorted.forEach((L, i) => {
		L.k = i;
	}); // rank from the bottom
	const layers = [...groups.values()].sort((a, b) => b.k - a.k);
	for (const L of layers) {
		L.baseY = L.group.position.y;
	}
	return layers;
}

function formatLayerSummary(layers, partsCount, size) {
	return {
		layers: layers.map(({ key, label, k }) => ({
			key,
			label,
			k,
			swatch: layerSwatch(key),
		})),
		parts: partsCount,
		sizeMm: [size.x * 1000, size.z * 1000],
	};
}

function setPartHighlight(o, on, amber) {
	o.userData.holo.uniforms.uBoost.value = on ? 4 : 1;
	const m = o.userData.metal;
	if (on) {
		m.userData.em = [m.emissive.clone(), m.emissiveIntensity];
		m.emissive = amber;
		m.emissiveIntensity = 0.6;
	} else if (m.userData.em) {
		[m.emissive, m.emissiveIntensity] = m.userData.em;
	}
}

function highlightParts(parts, ref, on) {
	if (!ref) return;
	const amber = new THREE.Color(0xffb547);
	for (const o of parts) {
		if (o.userData.ref === ref) setPartHighlight(o, on, amber);
	}
}

function findHoveredPart({ e, domElement, camera, layers, parts }) {
	const r = domElement.getBoundingClientRect();
	const ndc = new THREE.Vector2(
		((e.clientX - r.left) / r.width) * 2 - 1,
		-((e.clientY - r.top) / r.height) * 2 + 1,
	);
	const ray = new THREE.Raycaster();
	ray.setFromCamera(ndc, camera);
	const vis = new Set(
		layers.filter((L) => L.fade > 0.5).flatMap((L) => L.meshes),
	);
	const hit = ray.intersectObjects(
		parts.filter((p) => vis.has(p)),
		false,
	)[0];
	return { ref: hit?.object.userData.ref || null, rect: r };
}

function isThrottledOrFixed(state, rawDt) {
	if (state.quality !== "auto" || state.resHeight) return true;
	return rawDt >= 0.25;
}

function canIncreasePr(autoPr, native, autoCeil) {
	if (autoPr + 0.25 > native) return false;
	return autoPr + 0.25 < autoCeil;
}

function adjustAutoQuality(state, rawDt, onResize) {
	if (isThrottledOrFixed(state, rawDt)) return;
	state.perfTime += rawDt;
	state.perfFrames++;
	if (state.perfTime <= 1) return;
	const avg = state.perfTime / state.perfFrames;
	const native = Math.min(window.devicePixelRatio || 1, 2);
	if (avg > 1 / 55 && state.autoPr > 0.5) {
		state.autoCeil = state.autoPr;
		state.autoPr = Math.max(0.5, state.autoPr - 0.25);
		onResize();
	} else if (
		avg < 1 / 58 &&
		canIncreasePr(state.autoPr, native, state.autoCeil)
	) {
		state.autoPr += 0.25;
		onResize();
	}
	state.perfTime = 0;
	state.perfFrames = 0;
}

function updateLayerMeshes(L) {
	for (const o of L.meshes) {
		o.userData.holo.uniforms.uFade.value = L.fade;
		const m = o.userData.metal;
		const op = m.userData.op * L.fade;
		const tr = op < 0.999;
		if (m.transparent !== tr) {
			m.transparent = tr;
			m.needsUpdate = true;
		}
		m.opacity = op;
		m.depthWrite = L.fade > 0.6;
	}
	for (const ls of L.lines) ls.material.opacity = ls.userData.base * L.fade;
	L.group.visible = L.fade > 0.01;
}

function updateLayer(L, dt) {
	const targetY = L.targetY ?? L.baseY;
	const isNearY = Math.abs(targetY - L.group.position.y) < 1e-4;
	const isNearFade = Math.abs(L.target - L.fade) < 1e-3;
	if (isNearY && isNearFade) {
		if (L.idle) return; // settled: nothing to update this frame
		L.group.position.y = targetY;
		L.fade = L.target;
		L.idle = true;
	} else {
		L.idle = false;
		L.group.position.y += (targetY - L.group.position.y) * Math.min(1, dt * 6);
		L.fade += (L.target - L.fade) * Math.min(1, dt * 5);
	}
	updateLayerMeshes(L);
}

function updateLayers(layers, dt) {
	for (const L of layers) updateLayer(L, dt);
}

function updateScan(state, shared, dt, layers) {
	if (state.scanT < 0 || !layers.length) return;
	state.scanT += dt / 6;
	const ys = layers.map((L) => L.group.getWorldPosition(new THREE.Vector3()).y);
	const lo = Math.min(...ys) - 0.6;
	const hi = Math.max(...ys) + 1.2;
	shared.uScanY.value = lo + (hi - lo) * state.scanT;
	if (state.scanT >= 1) {
		state.scanT = -1;
		shared.uScanY.value = -99;
	}
}

// Bottom visible layer never moves. Gaps open top-down as `explode` goes 0 → 1, so layers peel off
// one at a time, each carrying the layers stacked on it. Hidden layers drop out and the stack closes up.
function applyExplode(layers, explode, spacing, holder) {
	const stack = layers.filter((L) => L.visible).sort((a, b) => a.k - b.k);
	const n = stack.length - 1;
	const step = (GAP * spacing) / (holder.scale.x || 1);
	let y = 0;
	stack.forEach((L, r) => {
		if (r > 0) y += step * Math.min(1, Math.max(0, explode * n - (n - r)));
		L.targetY = L.baseY + y;
	});
}

// aim at the middle of the fully exploded stack and back off far enough to see all of it
function frameStack(layers, spacing, controls, camera) {
	const h = Math.max(0, layers.length - 1) * GAP * spacing;
	const k = Math.max(1, (h + 2) / 11);
	controls.target.set(0, 1.2 + h / 2, 0);
	camera.position.set(-14 * k, 1.2 + h / 2 + 8.8 * k, 18 * k);
}

function getLayerTargetFade(L, solo) {
	if (!L.visible) return 0;
	if (!solo || solo === L.key) return 1;
	return 0.08;
}

function refreshLayers(layers, solo) {
	for (const L of layers) {
		L.target = getLayerTargetFade(L, solo);
	}
}

function applySceneStyle(style, layers, bloom) {
	const holo = style === "holo";
	for (const L of layers) {
		for (const o of L.meshes) {
			o.material = holo ? o.userData.holo : o.userData.metal;
		}
	}
	bloom.strength = holo ? 0.7 : 0;
	bloom.radius = holo ? 0.45 : 0.3;
	bloom.threshold = holo ? 0.12 : 0.9;
	bloom.enabled = bloom.strength > 0; // the pass blurs 5 mip levels per frame even at strength 0
}

function clearBoard(holder) {
	holder.traverse((o) => {
		if (o.geometry) o.geometry.dispose();
		for (const m of [o.material, o.userData?.metal, o.userData?.holo].flat()) {
			m?.dispose?.();
		}
	});
	holder.clear();
}

function captureFrame({ renderer, composer, camera, draw, resize, height }) {
	const h = height || renderer.domElement.height;
	const w = Math.round((h * 16) / 9);
	renderer.setPixelRatio(1);
	composer.setPixelRatio(1);
	renderer.setSize(w, h, false);
	composer.setSize(w, h);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
	draw();
	return new Promise((res) =>
		renderer.domElement.toBlob((b) => {
			resize();
			res(b);
		}, "image/png"),
	);
}

function applySamples(quality, renderer, composer) {
	const n = Math.min(
		QUALITY[quality === "auto" ? "high" : quality].samples,
		renderer.capabilities.maxSamples || 0,
	);
	for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
		if (rt.samples !== n) {
			rt.samples = n;
			rt.dispose();
		}
	}
}

function calcTargetPixelRatio(quality, autoPr) {
	const dpr = window.devicePixelRatio || 1;
	if (quality === "auto") return autoPr;
	if (quality === "ultra") return Math.min(dpr * 2, QUALITY.ultra.pr);
	return Math.min(dpr, QUALITY[quality].pr);
}

function updateRendererSize({ container, renderer, composer, camera, pr }) {
	const w = container.clientWidth || 1;
	const h = container.clientHeight || 1;
	renderer.setPixelRatio(pr);
	composer.setPixelRatio(pr);
	renderer.setSize(w, h);
	composer.setSize(w, h);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
}

class HoloSceneSession {
	constructor(container, options = {}) {
		this.container = container;
		this.options = options;
		this.onHover = options.onHover;
		this.renderer = initRenderer(container);
		const { scene, pmrem } = initScene(this.renderer);
		this.scene = scene;
		this.pmrem = pmrem;
		const { camera, controls } = initCameraAndControls(
			this.renderer.domElement,
		);
		this.camera = camera;
		this.controls = controls;
		const { composer, bloom } = initComposer(this.renderer, scene, camera);
		this.composer = composer;
		this.bloom = bloom;
		this.shared = {
			uTime: { value: 0 },
			uGlow: { value: 1 },
			uScanY: { value: -99 },
		};
		const { polar, tick } = createProjectorBase(scene);
		this.polar = polar;
		this.tick = tick;
		this.holder = new THREE.Group();
		scene.add(this.holder);
		this.initState();
		this.initEvents();
		this.initLoop();
	}

	initState() {
		this.boardTransform = null;
		this.layers = [];
		this.parts = [];
		this.style = "kicad";
		this.explode = 1;
		this.spacing = 1;
		this.solo = null;
		this.resHeight = 0;
		this.scanT = -1;
		this.quality = "auto";
		this.autoPr = Math.min(window.devicePixelRatio || 1, 2);
		this.autoCeil = Infinity;
		this.disposed = false;
		this.loadSeq = 0;
		this.hovered = null;
		this.pendingPick = null;
		this.perfTime = 0;
		this.perfFrames = 0;
	}

	initEvents() {
		this.onMove = (e) => {
			if (e.pointerType === "mouse" && !e.buttons) this.pendingPick = e;
		};
		this.onTap = (e) => {
			if (e.pointerType !== "mouse") this.pendingPick = e;
		};
		this.renderer.domElement.addEventListener("pointermove", this.onMove);
		this.renderer.domElement.addEventListener("pointerup", this.onTap);
		this.applySamples();
		this.ro = new ResizeObserver(() => this.resize());
		this.ro.observe(this.container);
		this.resize();
	}

	initLoop() {
		this.timer = new THREE.Timer();
		this.timer.connect(document);
		this.renderer.setAnimationLoop((ts) => this.onFrame(ts));
	}

	// Direct render when bloom is off: skips the post chain and uses the canvas native MSAA.
	draw() {
		if (this.bloom.enabled) this.composer.render();
		else this.renderer.render(this.scene, this.camera);
	}

	resize() {
		const h = this.container.clientHeight || 1;
		const pr = this.resHeight
			? this.resHeight / h
			: calcTargetPixelRatio(this.quality, this.autoPr);
		updateRendererSize({
			container: this.container,
			renderer: this.renderer,
			composer: this.composer,
			camera: this.camera,
			pr,
		});
	}

	applySamples() {
		applySamples(this.quality, this.renderer, this.composer);
	}

	pick(e) {
		const { ref, rect } = findHoveredPart({
			e,
			domElement: this.renderer.domElement,
			camera: this.camera,
			layers: this.layers,
			parts: this.parts,
		});
		if (this.hovered !== ref) {
			highlightParts(this.parts, this.hovered, false);
			this.hovered = ref;
			highlightParts(this.parts, this.hovered, true);
		}
		this.onHover?.(
			this.hovered
				? {
						ref: this.hovered,
						x: e.clientX - rect.left,
						y: e.clientY - rect.top,
					}
				: null,
		);
	}

	onFrame(ts) {
		if (this.disposed) return;
		this.timer.update(ts);
		const rawDt = this.timer.getDelta();
		const dt = Math.min(rawDt, 0.05);
		const t = this.timer.getElapsed();
		this.shared.uTime.value = t;
		adjustAutoQuality(this, rawDt, () => this.resize());
		if (this.pendingPick) {
			this.pick(this.pendingPick);
			this.pendingPick = null;
		}
		updateLayers(this.layers, dt);
		updateScan(this, this.shared, dt, this.layers);
		this.tick.rotation.z = t * 0.35;
		this.polar.rotation.y = -t * 0.05;
		this.controls.update();
		this.options?.onFrame?.(dt);
		this.draw();
	}

	clearBoard() {
		clearBoard(this.holder);
		this.boardTransform = null;
		this.layers = [];
		this.parts = [];
		this.solo = null;
		this.hovered = null;
	}

	boardToScene(x, y, z) {
		if (!this.boardTransform) return null;
		const { ctr, s, topY } = this.boardTransform;
		const px = Array.isArray(x) ? x[0] : (x ?? 0);
		const py = Array.isArray(x) ? x[1] : (y ?? 0);
		const pz = Array.isArray(x) ? x[2] : (z ?? 0);
		return [
			(px * 0.001 - ctr.x) * s,
			topY + pz * 0.001 * s,
			(py * 0.001 - ctr.z) * s,
		];
	}

	async loadGlb(arrayBuffer) {
		const seq = ++this.loadSeq;
		const gltf = await new GLTFLoader().parseAsync(arrayBuffer, "");
		if (seq !== this.loadSeq || this.disposed) {
			throw new Error("Superseded by a newer board load");
		}
		this.clearBoard();
		gltf.scene.updateMatrixWorld(true);
		const { boardMeshes, comps } = classifyGltfNodes(gltf);
		const split = boardMeshes.flatMap((m) =>
			SPLITTABLE_KINDS.has(m.userData.kind) ? splitByHeight(m) : [m],
		);
		const { mid, cu, topY } = getBoardHeights(split);
		const xf = fitHolder(this.holder, gltf.scene, topY);
		this.boardTransform = xf;
		const { groups, groupFor } = createGroupManager(this.holder);
		const slotOf = createSlotResolver(mid, cu);
		const buckets = collectMeshBuckets({ split, comps, slotOf, mid, groupFor });
		populateBuckets(buckets, this.shared, this.parts, split);
		this.layers = finalizeLayers(groups);
		this.applyExplode();
		this.setStyle(this.style);
		this.frameStack();
		return formatLayerSummary(this.layers, comps.length, xf.size);
	}

	applyExplode() {
		applyExplode(this.layers, this.explode, this.spacing, this.holder);
	}

	frameStack() {
		frameStack(this.layers, this.spacing, this.controls, this.camera);
	}

	refresh() {
		refreshLayers(this.layers, this.solo);
	}

	setStyle(next) {
		this.style = next;
		applySceneStyle(this.style, this.layers, this.bloom);
		for (const L of this.layers) L.idle = false;
	}

	setExplode(v) {
		this.explode = v;
		this.applyExplode();
	}

	setSpacing(v) {
		this.spacing = v;
		this.applyExplode();
	}

	setGlow(v) {
		if (this.style === "holo") this.shared.uGlow.value = v;
		else {
			this.bloom.strength = v;
			this.bloom.enabled = v > 0;
		}
	}

	setAutoRotate(on) {
		this.controls.autoRotate = on;
	}

	setResolution(h) {
		this.resHeight = h;
		this.resize();
		return `${this.renderer.domElement.width} × ${this.renderer.domElement.height}`;
	}

	/** Graphics preset: auto (holds 60 fps) | low | medium | high | ultra (max device quality). Returns the render size. */
	setQuality(q) {
		this.quality = QUALITY[q] || q === "auto" ? q : "auto";
		if (this.quality === "auto") {
			this.autoPr = Math.min(window.devicePixelRatio || 1, 2);
			this.autoCeil = Infinity;
		}
		this.applySamples();
		this.resize();
		return `${this.renderer.domElement.width} × ${this.renderer.domElement.height}`;
	}

	setLayerVisible(key, on) {
		const L = this.layers.find((x) => x.key === key);
		if (L) {
			L.visible = on;
			this.refresh();
			this.applyExplode();
		}
	}

	setSolo(key) {
		this.solo = key;
		this.refresh();
	}

	showAll() {
		this.solo = null;
		this.layers.forEach((L) => {
			L.visible = true;
		});
		this.refresh();
		this.applyExplode();
	}

	scan() {
		this.scanT = 0;
	}

	resetView() {
		this.frameStack();
	}

	/** Render one exact 16:9 frame at `height` px and resolve a PNG blob. */
	capture(height) {
		return captureFrame({
			renderer: this.renderer,
			composer: this.composer,
			camera: this.camera,
			draw: () => this.draw(),
			resize: () => this.resize(),
			height,
		});
	}

	dispose() {
		this.disposed = true;
		this.boardTransform = null;
		this.options = null;
		this.ro.disconnect();
		this.timer.dispose();
		this.renderer.domElement.removeEventListener("pointermove", this.onMove);
		this.renderer.domElement.removeEventListener("pointerup", this.onTap);
		this.renderer.setAnimationLoop(null);
		this.clearBoard();
		this.controls.dispose();
		this.pmrem.dispose();
		this.composer.dispose?.();
		this.renderer.dispose();
		this.renderer.domElement.remove();
	}
}

export function createHoloScene(container, options = {}) {
	const session = new HoloSceneSession(container, options);
	return {
		scene: session.scene,
		boardToScene: (x, y, z) => session.boardToScene(x, y, z),
		loadGlb: (buf) => session.loadGlb(buf),
		setExplode: (v) => session.setExplode(v),
		setSpacing: (v) => session.setSpacing(v),
		setStyle: (next) => session.setStyle(next),
		setGlow: (v) => session.setGlow(v),
		setAutoRotate: (on) => session.setAutoRotate(on),
		setResolution: (h) => session.setResolution(h),
		setQuality: (q) => session.setQuality(q),
		setLayerVisible: (k, on) => session.setLayerVisible(k, on),
		setSolo: (k) => session.setSolo(k),
		showAll: () => session.showAll(),
		scan: () => session.scan(),
		resetView: () => session.resetView(),
		capture: (h) => session.capture(h),
		dispose: () => session.dispose(),
	};
}
