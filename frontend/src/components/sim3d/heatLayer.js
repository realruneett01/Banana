import * as THREE from "three";
import { clamp, temperatureColor } from "./flowModel.js";

function resolveToScene(fn) {
	if (typeof fn !== "function") {
		return (x, y = 0, z = 0) =>
			Array.isArray(x) ? [x[0], x[1], x[2]] : [x, y, z];
	}
	return (x, y = 0, z = 0) => {
		const px = Array.isArray(x) ? x[0] : x;
		const py = Array.isArray(x) ? x[1] : y;
		const pz = Array.isArray(x) ? x[2] : z;
		const res = fn(px, py, pz);
		if (Array.isArray(res)) return res;
		if (res && typeof res.x === "number") {
			return [res.x, res.y, res.z];
		}
		return [px, py, pz];
	};
}

function createHeatTexture(grid) {
	const cols = grid.cols;
	const rows = grid.rows;
	const data = new Uint8Array(cols * rows * 4);
	for (let i = 0; i < grid.values.length; i++) {
		const [r, g, b] = temperatureColor(grid.values[i]);
		const idx = i * 4;
		data[idx] = Math.round(clamp(r, 0, 1) * 255);
		data[idx + 1] = Math.round(clamp(g, 0, 1) * 255);
		data[idx + 2] = Math.round(clamp(b, 0, 1) * 255);
		data[idx + 3] = 255;
	}
	const tex = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return tex;
}

function buildQuadPositions(c0, c1, c2, c3) {
	const corners = [c0, c1, c2, c2, c1, c3];
	const pos = new Float32Array(18);
	for (let i = 0; i < 6; i++) {
		pos[i * 3] = corners[i][0];
		pos[i * 3 + 1] = corners[i][1];
		pos[i * 3 + 2] = corners[i][2];
	}
	return pos;
}

function createPlaneGeometry(grid, toScene) {
	const w = grid.boardW || grid.cols * (grid.cellMm || 1);
	const h = grid.boardH || grid.rows * (grid.cellMm || 1);
	const zOff = 0.05;
	const c0 = toScene(0, 0, zOff);
	const c1 = toScene(w, 0, zOff);
	const c2 = toScene(0, h, zOff);
	const c3 = toScene(w, h, zOff);
	const positions = buildQuadPositions(c0, c1, c2, c3);
	const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
	return geom;
}

function createPlaneMaterial(texture) {
	return new THREE.MeshBasicMaterial({
		map: texture,
		transparent: true,
		opacity: 0.6,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
}

function createHeatPlane(grid, toScene) {
	if (!grid?.values || grid.cols <= 0 || grid.rows <= 0) {
		return null;
	}
	const geom = createPlaneGeometry(grid, toScene);
	const tex = createHeatTexture(grid);
	const mat = createPlaneMaterial(tex);
	return new THREE.Mesh(geom, mat);
}

function disposeMesh(mesh, parent) {
	if (!mesh) return null;
	parent.remove(mesh);
	mesh.geometry?.dispose();
	mesh.material?.map?.dispose();
	mesh.material?.dispose();
	return null;
}

function createRingTexture() {
	const size = 32;
	const data = new Uint8Array(size * size * 4);
	const center = 15.5;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const idx = (y * size + x) * 4;
			const dist = Math.abs(Math.hypot(x - center, y - center) - 11);
			if (dist < 3.5) {
				const alpha = 1 - dist / 3.5;
				data[idx] = 255;
				data[idx + 1] = 30;
				data[idx + 2] = 30;
				data[idx + 3] = Math.round(alpha * 255);
			}
		}
	}
	const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return tex;
}

function createHotSprite(part, toScene, ringTex, mmScale) {
	const [x, y, z] = toScene(part.x, part.y, 0.15);
	const mat = new THREE.SpriteMaterial({
		map: ringTex,
		transparent: true,
		opacity: 0.85,
		depthWrite: false,
	});
	const sprite = new THREE.Sprite(mat);
	sprite.position.set(x, y, z);
	const radius = Math.max(0.5, Number(part.radiusMm ?? part.radius ?? 5));
	const baseScale = Math.max(0.2, radius * 2.5 * mmScale);
	sprite.scale.set(baseScale, baseScale, 1);
	return { sprite, mat, baseScale };
}

function createHotSprites(grid, toScene, ringTex) {
	const placements = Array.isArray(grid?.placements) ? grid.placements : [];
	const hotParts = placements.filter(
		(p) => Number(p?.tempC ?? p?.temp ?? 0) >= 85,
	);
	const p0 = toScene(0, 0, 0);
	const p10 = toScene(10, 0, 0);
	const mmScale =
		Math.hypot(p10[0] - p0[0], p10[1] - p0[1], p10[2] - p0[2]) / 10 || 0.1;
	const rings = [];
	for (const p of hotParts) {
		rings.push(createHotSprite(p, toScene, ringTex, mmScale));
	}
	return rings;
}

function updateRings(rings, time) {
	const pulse = 0.5 + 0.5 * Math.sin(time * 6);
	for (const r of rings) {
		r.mat.opacity = 0.4 + 0.5 * pulse;
		const s = r.baseScale * (0.85 + 0.3 * pulse);
		r.sprite.scale.set(s, s, 1);
	}
}

function disposeRings(rings, parent) {
	for (const r of rings) {
		parent.remove(r.sprite);
		r.mat.dispose();
	}
	rings.length = 0;
}

function createLayerManager(root, toScene, ringTex) {
	let planeMesh = null;
	const rings = [];
	let animTime = 0;

	const setGrid = (grid) => {
		planeMesh = disposeMesh(planeMesh, root);
		disposeRings(rings, root);
		planeMesh = createHeatPlane(grid, toScene);
		if (planeMesh) root.add(planeMesh);
		const newRings = createHotSprites(grid, toScene, ringTex);
		for (const r of newRings) root.add(r.sprite);
		rings.push(...newRings);
	};

	const update = (dtS) => {
		animTime += typeof dtS === "number" ? dtS : 0.016;
		updateRings(rings, animTime);
	};

	const dispose = () => {
		planeMesh = disposeMesh(planeMesh, root);
		disposeRings(rings, root);
	};

	return { setGrid, update, dispose };
}

export function createHeatLayer(scene, options = {}) {
	const toScene = resolveToScene(options?.boardToScene);
	const root = new THREE.Group();
	scene?.add?.(root);

	const ringTex = createRingTexture();
	const mgr = createLayerManager(root, toScene, ringTex);

	return {
		setGrid: (grid) => mgr.setGrid(grid),
		setVisible: (v) => {
			root.visible = Boolean(v);
		},
		update: (dt) => mgr.update(dt),
		dispose: () => {
			mgr.dispose();
			ringTex.dispose();
			scene?.remove?.(root);
		},
	};
}
