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

// glTF materials from KiCad omit metallicFactor (spec default = 1, fully metallic), which renders
// plastic parts as dark mirrors. Re-derive a plausible finish from the base colour instead.
function componentMaterial(src) {
	const c = src.color ? src.color.clone() : new THREE.Color(0.5, 0.5, 0.5);
	const { r, g, b } = c.clone().convertLinearToSRGB();
	const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	let metal = 0,
		rough = 0.5,
		cc = 0;
	if (r > 0.6 && g < 0.6 * r + 0.15 && b < 0.35) {
		metal = 1;
		rough = 0.2;
	} // gold pins
	else if (lum > 0.55 && lum <= 0.7 && Math.abs(r - b) < 0.12) {
		metal = 1;
		rough = 0.3;
	} // tin terminals
	else if (lum < 0.05) {
		rough = 0.45;
		cc = 0.3;
	} // epoxy mould
	const m = new THREE.MeshPhysicalMaterial({
		color: c,
		metalness: metal,
		roughness: rough,
		clearcoat: cc,
		clearcoatRoughness: 0.1,
		side: THREE.DoubleSide,
		envMapIntensity: metal ? 1.4 : 0.8,
		transparent: (src.opacity ?? 1) < 1,
		opacity: src.opacity ?? 1,
	});
	m.userData.op = src.opacity ?? 1;
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

/** Split a mesh into one mesh per height band (triangle centroid Y, world space). */
function splitByHeight(mesh, gap = 5e-5) {
	const src = mesh.geometry.index
		? mesh.geometry.toNonIndexed()
		: mesh.geometry;
	const pos = src.attributes.position,
		nrm = src.attributes.normal;
	const mw = mesh.matrixWorld,
		v = new THREE.Vector3();
	const triCount = pos.count / 3,
		ys = new Float64Array(triCount);
	for (let t = 0; t < triCount; t++) {
		let y = 0;
		for (let k = 0; k < 3; k++) {
			v.fromBufferAttribute(pos, t * 3 + k).applyMatrix4(mw);
			y += v.y;
		}
		ys[t] = Math.round((y / 3) * 1e6) / 1e6;
	}
	const uniq = Array.from(new Set(ys)).sort((a, b) => a - b);
	const bands = [];
	let start = uniq[0];
	for (let i = 1; i < uniq.length; i++)
		if (uniq[i] - uniq[i - 1] > gap) {
			bands.push([start, uniq[i - 1]]);
			start = uniq[i];
		}
	bands.push([start, uniq[uniq.length - 1]]);
	if (bands.length === 1) return [mesh];
	return bands.map(([lo, hi]) => {
		const idx = [];
		for (let t = 0; t < triCount; t++)
			if (ys[t] >= lo - 1e-9 && ys[t] <= hi + 1e-9) idx.push(t);
		const p = new Float32Array(idx.length * 9),
			n = nrm ? new Float32Array(idx.length * 9) : null;
		idx.forEach((t, j) => {
			for (let k = 0; k < 9; k++) {
				p[j * 9 + k] = pos.array[t * 9 + k];
				if (n) n[j * 9 + k] = nrm.array[t * 9 + k];
			}
		});
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
	});
}

const centerY = (o) =>
	new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).y;

/** Merge meshes into one geometry, baking each world transform (layer groups start at the holder origin). */
function mergeBaked(meshes) {
	const indexed = meshes.every((o) => o.geometry.index);
	const geoms = meshes.map((o) => {
		o.updateMatrixWorld(true);
		const g = indexed
			? o.geometry.clone()
			: o.geometry.index
				? o.geometry.toNonIndexed()
				: o.geometry.clone();
		for (const name of Object.keys(g.attributes))
			if (name !== "position" && name !== "normal") g.deleteAttribute(name);
		g.morphAttributes = {};
		if (!g.attributes.normal) g.computeVertexNormals();
		return g.applyMatrix4(o.matrixWorld);
	});
	const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms);
	if (!merged)
		throw new Error("Could not merge board meshes (incompatible attributes)");
	if (geoms.length > 1) geoms.forEach((g) => g.dispose());
	merged.computeBoundingSphere();
	merged.computeBoundingBox();
	return merged;
}

export function createHoloScene(container, { onHover } = {}) {
	const renderer = new THREE.WebGLRenderer({
		antialias: true,
		powerPreference: "high-performance",
		preserveDrawingBuffer: false,
	});
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	container.appendChild(renderer.domElement);
	renderer.domElement.style.display = "block";
	renderer.domElement.style.touchAction = "none"; // OrbitControls handles pinch/rotate on phones

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

	const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 500);
	camera.position.set(-14, 12, 18);
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.06;
	controls.autoRotate = true;
	controls.autoRotateSpeed = 0.5;
	controls.target.set(0, 3.2, 0);
	controls.minDistance = 1;
	controls.maxDistance = 60;

	const composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0, 0.3, 0.9); // off by default: crisp parts
	bloom.enabled = false;
	composer.addPass(bloom);
	composer.addPass(new OutputPass());

	const shared = {
		uTime: { value: 0 },
		uGlow: { value: 1 },
		uScanY: { value: -99 },
	};

	// projector base
	const base = new THREE.Group();
	scene.add(base);
	const additive = (color, opacity) =>
		new THREE.MeshBasicMaterial({
			color,
			transparent: true,
			opacity,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
			depthWrite: false,
		});
	const polar = new THREE.PolarGridHelper(9, 24, 8, 96, 0x1a6f8a, 0x0d3a4a);
	polar.material.transparent = true;
	polar.material.opacity = 0.3;
	polar.material.blending = THREE.AdditiveBlending;
	base.add(polar);
	for (const [r, o] of [
		[9.05, 0.6],
		[6.4, 0.3],
		[3.2, 0.2],
	]) {
		const ring = new THREE.Mesh(
			new THREE.RingGeometry(r - 0.03, r, 160),
			additive(0x4fe3ff, o),
		);
		ring.rotation.x = -Math.PI / 2;
		base.add(ring);
	}
	const tick = new THREE.Mesh(
		new THREE.RingGeometry(9.25, 9.6, 160, 1, 0, Math.PI * 0.35),
		additive(0xffb547, 0.45),
	);
	tick.rotation.x = -Math.PI / 2;
	base.add(tick);

	const holder = new THREE.Group();
	scene.add(holder);
	let layers = [],
		parts = [],
		style = "kicad",
		explode = 1,
		spacing = 1,
		solo = null,
		resHeight = 0,
		scanT = -1;
	let quality = "auto"; // auto | low | medium | high | ultra
	let autoPr = Math.min(window.devicePixelRatio || 1, 2); // auto mode: adjusted live to hold 60 fps
	let autoCeil = Infinity; // auto mode: lowest pixel ratio that already failed 60 fps
	let disposed = false,
		loadSeq = 0;

	function clearBoard() {
		holder.traverse((o) => {
			if (o.geometry) o.geometry.dispose();
			for (const m of [o.material, o.userData?.metal, o.userData?.holo].flat())
				m?.dispose?.();
		});
		holder.clear();
		layers = [];
		parts = [];
		solo = null;
		hovered = null;
	}

	async function loadGlb(arrayBuffer) {
		const seq = ++loadSeq;
		const gltf = await new GLTFLoader().parseAsync(arrayBuffer, "");
		if (seq !== loadSeq || disposed)
			throw new Error("Superseded by a newer board load");
		clearBoard();
		const root = gltf.scene;
		root.updateMatrixWorld(true);
		const json = gltf.parser.json;

		// classify: board meshes by glTF mesh name suffix, components by top-level node (= reference)
		const boardMeshes = [],
			comps = [];
		root.traverse((o) => {
			if (!o.isMesh) return;
			const a = gltf.parser.associations.get(o);
			const meshName =
				a?.meshes !== undefined ? json.meshes[a.meshes]?.name || "" : "";
			const kind = /_(copper|pad|via|silkscreen|soldermask|PCB)$/.exec(
				meshName,
			)?.[1];
			if (kind) {
				o.userData.kind = kind;
				boardMeshes.push(o);
			}
		});
		for (const top of root.children[0]?.children ?? root.children) {
			let isBoard = false;
			top.traverse((o) => {
				if (o.userData.kind) isBoard = true;
			});
			if (!isBoard && top.name) comps.push(top);
		}

		const split = boardMeshes.flatMap((m) =>
			["copper", "pad", "soldermask", "silkscreen"].includes(m.userData.kind)
				? splitByHeight(m)
				: [m],
		);
		const body = split.find((m) => m.userData.kind === "PCB");
		if (!body)
			throw new Error("3D model has no board body (missing *_PCB mesh)");
		const bb = new THREE.Box3().setFromObject(body);
		const mid = (bb.min.y + bb.max.y) / 2;
		const cu = Array.from(
			new Set(
				split
					.filter((m) => m.userData.kind === "copper")
					.map((m) => Math.round(centerY(m) * 1e5) / 1e5),
			),
		).sort((a, b) => a - b);
		const slotOf = (m) => {
			const k = m.userData.kind,
				y = centerY(m);
			if (k === "silkscreen") return y > mid ? 8 : 0;
			if (k === "soldermask") return y > mid ? 7 : 1;
			if (k === "copper" || k === "pad") {
				const near = cu.reduce(
					(a, c) => (Math.abs(c - y) < Math.abs(a - y) ? c : a),
					cu[0],
				);
				if (Math.abs(near - y) > 1e-4) return 4; // through-hole barrels span the board
				const i = cu.indexOf(near),
					n = cu.length;
				if (i === n - 1) return 6;
				if (i === 0) return 2;
				return i === n - 2 ? 5 : 3;
			}
			return 4;
		};

		const full = new THREE.Box3().setFromObject(root);
		const size = full.getSize(new THREE.Vector3()),
			ctr = full.getCenter(new THREE.Vector3());
		const s = FIT_SIZE / Math.max(size.x, size.z);
		holder.scale.setScalar(s);
		holder.position.set(-ctr.x * s, -full.min.y * s + 1.2, -ctr.z * s);

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
		const holoAlpha = {
			copper: 0.1,
			pad: 0.1,
			via: 0.1,
			silkscreen: 0.3,
			soldermask: 0.035,
			PCB: 0.02,
		};

		// KiCad emits thousands of tiny meshes (~56k draw calls/frame unmerged). Bake each into board space
		// and merge per layer+kind (board) or per component+material (parts) → a few hundred draw calls.
		const buckets = new Map();
		const bucket = (key, init) => {
			if (!buckets.has(key)) buckets.set(key, { ...init, srcs: [] });
			return buckets.get(key);
		};
		for (const m of split) {
			const slot = slotOf(m),
				kind = m.userData.kind;
			bucket(`b|${slot}|${kind}`, { L: groupFor(slot), kind }).srcs.push(m);
		}
		for (const c of comps) {
			const L = groupFor(centerY(c) > mid ? 9 : -1);
			c.traverse((o) => {
				if (!o.isMesh) return;
				const mat = o.material,
					key = `c|${c.name}|${mat.color?.getHexString()}|${mat.opacity ?? 1}`;
				bucket(key, { L, ref: c.name, src: mat }).srcs.push(o);
			});
		}

		for (const b of buckets.values()) {
			const m = new THREE.Mesh(mergeBaked(b.srcs));
			if (b.ref) {
				m.userData.metal = componentMaterial(b.src);
				m.userData.holo = holoMaterial(b.L.holo, 0.05, shared);
				m.userData.ref = b.ref;
				parts.push(m);
			} else {
				m.userData.kind = b.kind;
				m.userData.metal = physical(KICAD_MATERIALS[b.kind]);
				m.userData.holo = holoMaterial(
					b.L.holo,
					holoAlpha[b.kind] ?? 0.1,
					shared,
				);
				if (b.kind === "PCB") {
					// faint outline keeps the stack readable as a projection
					const ls = new THREE.LineSegments(
						new THREE.EdgesGeometry(m.geometry, 35),
						new THREE.LineBasicMaterial({
							color: 0x4fe3ff,
							transparent: true,
							opacity: 0.35,
							depthWrite: false,
							blending: THREE.AdditiveBlending,
						}),
					);
					ls.userData.base = 0.35;
					m.add(ls);
					b.L.lines.push(ls);
				}
			}
			m.material = m.userData.metal;
			b.L.group.add(m);
			b.L.meshes.push(m);
		}
		for (const m of split) m.geometry.dispose(); // split pieces are copies; the glTF originals are dropped with gltf
		[...groups.values()]
			.sort((a, b) => a.slot - b.slot)
			.forEach((L, i) => {
				L.k = i;
			}); // rank from the bottom
		layers = [...groups.values()].sort((a, b) => b.k - a.k);
		for (const L of layers) L.baseY = L.group.position.y;
		applyExplode();
		setStyle(style);
		frameStack();
		return {
			layers: layers.map(({ key, label, k }) => ({
				key,
				label,
				k,
				swatch: layerSwatch(key),
			})),
			parts: comps.length,
			sizeMm: [size.x * 1000, size.z * 1000],
		};
	}

	// Bottom visible layer never moves. Gaps open top-down as `explode` goes 0 → 1, so layers peel off
	// one at a time, each carrying the layers stacked on it. Hidden layers drop out and the stack closes up.
	function applyExplode() {
		const stack = layers.filter((L) => L.visible).sort((a, b) => a.k - b.k);
		const n = stack.length - 1,
			step = (GAP * spacing) / (holder.scale.x || 1);
		let y = 0;
		stack.forEach((L, r) => {
			if (r > 0) y += step * Math.min(1, Math.max(0, explode * n - (n - r)));
			L.targetY = L.baseY + y;
		});
	}
	// aim at the middle of the fully exploded stack and back off far enough to see all of it
	function frameStack() {
		const h = Math.max(0, layers.length - 1) * GAP * spacing,
			k = Math.max(1, (h + 2) / 11);
		controls.target.set(0, 1.2 + h / 2, 0);
		camera.position.set(-14 * k, 1.2 + h / 2 + 8.8 * k, 18 * k);
	}
	function refresh() {
		for (const L of layers)
			L.target =
				L.visible && (!solo || solo === L.key)
					? 1
					: solo && L.visible
						? 0.08
						: 0;
	}
	function setStyle(next) {
		style = next;
		const holo = style === "holo";
		for (const L of layers)
			for (const o of L.meshes)
				o.material = holo ? o.userData.holo : o.userData.metal;
		bloom.strength = holo ? 0.7 : 0;
		bloom.radius = holo ? 0.45 : 0.3;
		bloom.threshold = holo ? 0.12 : 0.9;
		bloom.enabled = bloom.strength > 0; // the pass blurs 5 mip levels per frame even at strength 0
	}

	function targetPixelRatio() {
		const dpr = window.devicePixelRatio || 1;
		if (quality === "auto") return autoPr;
		if (quality === "ultra") return Math.min(dpr * 2, QUALITY.ultra.pr);
		return Math.min(dpr, QUALITY[quality].pr);
	}
	function applySamples() {
		const n = Math.min(
			QUALITY[quality === "auto" ? "high" : quality].samples,
			renderer.capabilities.maxSamples || 0,
		);
		for (const rt of [composer.renderTarget1, composer.renderTarget2])
			if (rt.samples !== n) {
				rt.samples = n;
				rt.dispose();
			}
	}
	// Direct render when bloom is off: skips the post chain and uses the canvas native MSAA.
	const draw = () =>
		bloom.enabled ? composer.render() : renderer.render(scene, camera);

	function resize() {
		const w = container.clientWidth || 1,
			h = container.clientHeight || 1;
		const pr = resHeight ? resHeight / h : targetPixelRatio();
		renderer.setPixelRatio(pr);
		composer.setPixelRatio(pr);
		renderer.setSize(w, h);
		composer.setSize(w, h);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}
	applySamples();
	const ro = new ResizeObserver(resize);
	ro.observe(container);
	resize();

	// hover / tap → reference designator
	const ray = new THREE.Raycaster(),
		ndc = new THREE.Vector2();
	let hovered = null; // reference designator; a part is several merged meshes (one per material)
	const amber = new THREE.Color(0xffb547);
	function highlight(ref, on) {
		if (!ref) return;
		for (const o of parts) {
			if (o.userData.ref !== ref) continue;
			o.userData.holo.uniforms.uBoost.value = on ? 4 : 1;
			const m = o.userData.metal;
			if (on) {
				m.userData.em = [m.emissive.clone(), m.emissiveIntensity];
				m.emissive = amber;
				m.emissiveIntensity = 0.6;
			} else if (m.userData.em)
				[m.emissive, m.emissiveIntensity] = m.userData.em;
		}
	}
	function pick(e) {
		const r = renderer.domElement.getBoundingClientRect();
		ndc.set(
			((e.clientX - r.left) / r.width) * 2 - 1,
			-((e.clientY - r.top) / r.height) * 2 + 1,
		);
		ray.setFromCamera(ndc, camera);
		const vis = new Set(
			layers.filter((L) => L.fade > 0.5).flatMap((L) => L.meshes),
		);
		const hit = ray.intersectObjects(
			parts.filter((p) => vis.has(p)),
			false,
		)[0];
		const ref = hit?.object.userData.ref || null;
		if (hovered !== ref) {
			highlight(hovered, false);
			hovered = ref;
			highlight(hovered, true);
		}
		onHover?.(
			hovered
				? { ref: hovered, x: e.clientX - r.left, y: e.clientY - r.top }
				: null,
		);
	}
	// raycasting every part is costly: pick at most once per frame, and never while orbiting
	let pendingPick = null;
	const onMove = (e) => {
		if (e.pointerType === "mouse" && !e.buttons) pendingPick = e;
	};
	const onTap = (e) => {
		if (e.pointerType !== "mouse") pendingPick = e;
	};
	renderer.domElement.addEventListener("pointermove", onMove);
	renderer.domElement.addEventListener("pointerup", onTap);

	const timer = new THREE.Timer();
	timer.connect(document);
	let perfTime = 0,
		perfFrames = 0;
	renderer.setAnimationLoop((ts) => {
		if (disposed) return;
		timer.update(ts);
		const rawDt = timer.getDelta(),
			dt = Math.min(rawDt, 0.05),
			t = timer.getElapsed();
		shared.uTime.value = t;

		// auto quality: hold 60 fps. Drop resolution when frames are slow; climb back (up to native) when there is headroom,
		// but never retry a level that already failed. rawDt > 0.25 means the tab was hidden/throttled: ignore it.
		if (quality === "auto" && !resHeight && rawDt < 0.25) {
			perfTime += rawDt;
			perfFrames++;
			if (perfTime > 1) {
				const avg = perfTime / perfFrames,
					native = Math.min(window.devicePixelRatio || 1, 2);
				if (avg > 1 / 55 && autoPr > 0.5) {
					autoCeil = autoPr;
					autoPr = Math.max(0.5, autoPr - 0.25);
					resize();
				} else if (
					avg < 1 / 58 &&
					autoPr + 0.25 <= native &&
					autoPr + 0.25 < autoCeil
				) {
					autoPr += 0.25;
					resize();
				}
				perfTime = 0;
				perfFrames = 0;
			}
		}
		if (pendingPick) {
			pick(pendingPick);
			pendingPick = null;
		}

		for (const L of layers) {
			const targetY = L.targetY ?? L.baseY;
			if (
				Math.abs(targetY - L.group.position.y) < 1e-4 &&
				Math.abs(L.target - L.fade) < 1e-3
			) {
				if (L.idle) continue; // settled: nothing to update this frame
				L.group.position.y = targetY;
				L.fade = L.target;
				L.idle = true;
			} else {
				L.idle = false;
				L.group.position.y +=
					(targetY - L.group.position.y) * Math.min(1, dt * 6);
				L.fade += (L.target - L.fade) * Math.min(1, dt * 5);
			}
			for (const o of L.meshes) {
				o.userData.holo.uniforms.uFade.value = L.fade;
				const m = o.userData.metal,
					op = m.userData.op * L.fade,
					tr = op < 0.999;
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
		if (scanT >= 0 && layers.length) {
			scanT += dt / 6;
			const ys = layers.map(
				(L) => L.group.getWorldPosition(new THREE.Vector3()).y,
			);
			const lo = Math.min(...ys) - 0.6,
				hi = Math.max(...ys) + 1.2;
			shared.uScanY.value = lo + (hi - lo) * scanT;
			if (scanT >= 1) {
				scanT = -1;
				shared.uScanY.value = -99;
			}
		}
		tick.rotation.z = t * 0.35;
		polar.rotation.y = -t * 0.05;
		controls.update();
		draw();
	});

	return {
		loadGlb,
		setExplode(v) {
			explode = v;
			applyExplode();
		},
		setSpacing(v) {
			spacing = v;
			applyExplode();
		},
		setStyle(next) {
			setStyle(next);
			for (const L of layers) L.idle = false;
		},
		setGlow(v) {
			if (style === "holo") shared.uGlow.value = v;
			else {
				bloom.strength = v;
				bloom.enabled = v > 0;
			}
		},
		setAutoRotate(on) {
			controls.autoRotate = on;
		},
		setResolution(h) {
			resHeight = h;
			resize();
			return `${renderer.domElement.width} × ${renderer.domElement.height}`;
		},
		/** Graphics preset: auto (holds 60 fps) | low | medium | high | ultra (max device quality). Returns the render size. */
		setQuality(q) {
			quality = QUALITY[q] || q === "auto" ? q : "auto";
			if (quality === "auto") {
				autoPr = Math.min(window.devicePixelRatio || 1, 2);
				autoCeil = Infinity;
			}
			applySamples();
			resize();
			return `${renderer.domElement.width} × ${renderer.domElement.height}`;
		},
		setLayerVisible(key, on) {
			const L = layers.find((x) => x.key === key);
			if (L) {
				L.visible = on;
				refresh();
				applyExplode();
			}
		},
		setSolo(key) {
			solo = key;
			refresh();
		},
		showAll() {
			solo = null;
			layers.forEach((L) => (L.visible = true));
			refresh();
			applyExplode();
		},
		scan() {
			scanT = 0;
		},
		resetView: frameStack,
		/** Render one exact 16:9 frame at `height` px and resolve a PNG blob. */
		capture(height) {
			const h = height || renderer.domElement.height,
				w = Math.round((h * 16) / 9);
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
		},
		dispose() {
			disposed = true;
			ro.disconnect();
			timer.dispose();
			renderer.domElement.removeEventListener("pointermove", onMove);
			renderer.domElement.removeEventListener("pointerup", onTap);
			renderer.setAnimationLoop(null);
			clearBoard();
			controls.dispose();
			pmrem.dispose();
			composer.dispose?.();
			renderer.dispose();
			renderer.domElement.remove();
		},
	};
}
