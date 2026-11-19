import * as THREE from "three";
import { createFlowState, stepFlow } from "./flowModel.js";

function resolveToScene(fn) {
	if (typeof fn !== "function") {
		return (pt) => (Array.isArray(pt) ? [pt[0], pt[1], pt[2]] : [0, 0, 0]);
	}
	return (pt) => {
		const res = fn(pt[0], pt[1], pt[2]);
		if (Array.isArray(res)) return res;
		if (res && typeof res.x === "number") {
			return [res.x, res.y, res.z];
		}
		return [pt[0], pt[1], pt[2]];
	};
}

function createPathLine(path, toScene) {
	const points = path?.points;
	if (!Array.isArray(points) || points.length < 2) return null;
	const pts = points.map((p) => {
		const [x, y, z] = toScene(p);
		return new THREE.Vector3(x, y, z);
	});
	const geom = new THREE.BufferGeometry().setFromPoints(pts);
	const c = path.color || [0, 0.5, 1];
	const mat = new THREE.LineBasicMaterial({
		color: new THREE.Color(c[0], c[1], c[2]),
		transparent: true,
		opacity: 0.25,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	return new THREE.Line(geom, mat);
}

function createPathLines(paths, toScene) {
	if (!Array.isArray(paths)) return [];
	const lines = [];
	for (const p of paths) {
		const line = createPathLine(p, toScene);
		if (line) lines.push(line);
	}
	return lines;
}

function disposeLines(lines, parent) {
	for (const line of lines) {
		parent.remove(line);
		line.geometry?.dispose();
		line.material?.dispose();
	}
	lines.length = 0;
}

function createParticleMesh(particles, toScene) {
	const count = particles.length;
	if (count === 0) return null;
	const geom = new THREE.SphereGeometry(0.08, 8, 8);
	const mat = new THREE.MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		opacity: 0.9,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	const mesh = new THREE.InstancedMesh(geom, mat, count);
	const dummy = new THREE.Object3D();
	const color = new THREE.Color();
	for (let i = 0; i < count; i++) {
		const p = particles[i];
		const [x, y, z] = toScene(p.position);
		dummy.position.set(x, y, z);
		dummy.updateMatrix();
		mesh.setMatrixAt(i, dummy.matrix);
		color.setRGB(p.color[0], p.color[1], p.color[2]);
		mesh.setColorAt(i, color);
	}
	mesh.instanceMatrix.needsUpdate = true;
	mesh.instanceColor.needsUpdate = true;
	return mesh;
}

function updateParticleMatrices(particles, mesh, dummy, toScene) {
	for (let i = 0; i < particles.length; i++) {
		const [x, y, z] = toScene(particles[i].position);
		dummy.position.set(x, y, z);
		dummy.updateMatrix();
		mesh.setMatrixAt(i, dummy.matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;
}

function disposeParticleMesh(mesh, parent) {
	if (!mesh) return null;
	parent.remove(mesh);
	mesh.geometry?.dispose();
	mesh.material?.dispose();
	return null;
}

function createPathManager(root, toScene) {
	const lines = [];
	let mesh = null;
	let state = null;
	const setPaths = (paths) => {
		disposeLines(lines, root);
		mesh = disposeParticleMesh(mesh, root);
		const newLines = createPathLines(paths, toScene);
		for (const l of newLines) root.add(l);
		lines.push(...newLines);
		state = createFlowState(paths);
		mesh = createParticleMesh(state.particles, toScene);
		if (mesh) root.add(mesh);
	};
	const update = (dt, dummy) => {
		if (!state || !mesh) return;
		state = stepFlow(state, dt);
		updateParticleMatrices(state.particles, mesh, dummy, toScene);
	};
	const dispose = () => {
		disposeLines(lines, root);
		mesh = disposeParticleMesh(mesh, root);
	};
	return { setPaths, update, dispose };
}

function initSparkVelocities(count) {
	const velocities = [];
	for (let i = 0; i < count; i++) {
		const theta = Math.random() * Math.PI * 2;
		const phi = (Math.random() - 0.5) * Math.PI;
		const spd = 0.6 + Math.random() * 1.4;
		velocities.push({
			x: Math.cos(phi) * Math.cos(theta) * spd,
			y: Math.sin(phi) * spd + 0.4,
			z: Math.cos(phi) * Math.sin(theta) * spd,
		});
	}
	return velocities;
}

function createSparkPoints(count, [cx, cy, cz]) {
	const pos = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		pos[i * 3] = cx;
		pos[i * 3 + 1] = cy;
		pos[i * 3 + 2] = cz;
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
	const mat = new THREE.PointsMaterial({
		color: 0xffbb33,
		size: 0.12,
		transparent: true,
		opacity: 1.0,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	return { geom, mat };
}

function createSparkEffect(effect, toScene) {
	const [cx, cy, cz] = toScene(effect.position || [0, 0, 0]);
	const count = 20;
	const { geom, mat } = createSparkPoints(count, [cx, cy, cz]);
	return {
		kind: "spark",
		center: [cx, cy, cz],
		count,
		velocities: initSparkVelocities(count),
		geom,
		mat,
		object: new THREE.Points(geom, mat),
		time: 0,
		intensity: effect.intensity ?? 1.0,
	};
}

function updateSparkEffect(spark, dt) {
	spark.time = (spark.time + dt) % 2.0;
	if (spark.time > 0.6) {
		spark.object.visible = false;
		return;
	}
	spark.object.visible = true;
	const t = spark.time / 0.6;
	spark.mat.opacity = (1 - t) * spark.intensity;
	const pos = spark.geom.attributes.position.array;
	const [cx, cy, cz] = spark.center;
	for (let i = 0; i < spark.count; i++) {
		const v = spark.velocities[i];
		pos[i * 3] = cx + v.x * spark.time;
		pos[i * 3 + 1] = cy + v.y * spark.time;
		pos[i * 3 + 2] = cz + v.z * spark.time;
	}
	spark.geom.attributes.position.needsUpdate = true;
}

function disposeSpark(spark, parent) {
	parent.remove(spark.object);
	spark.geom.dispose();
	spark.mat.dispose();
}

function createFlashSphere() {
	const geom = new THREE.SphereGeometry(0.12, 12, 12);
	const mat = new THREE.MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		opacity: 0.85,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	return { geom, mat, sphere: new THREE.Mesh(geom, mat) };
}

function createFlashEffect(effect, toScene) {
	const [cx, cy, cz] = toScene(effect.position || [0, 0, 0]);
	const intensity = effect.intensity ?? 1.0;
	const group = new THREE.Group();
	group.position.set(cx, cy, cz);
	const light = new THREE.PointLight(0xfffae0, 2 * intensity, 6);
	const { geom, mat, sphere } = createFlashSphere();
	group.add(light);
	group.add(sphere);
	return {
		kind: "flash",
		group,
		object: group,
		light,
		sphere,
		geom,
		mat,
		intensity,
		time: 0,
	};
}

function updateFlashEffect(flash, dt) {
	flash.time += dt;
	const pulse = 0.5 + 0.5 * Math.sin(flash.time * 12);
	flash.light.intensity = (0.5 + pulse * 2.5) * flash.intensity;
	flash.mat.opacity = (0.3 + pulse * 0.7) * flash.intensity;
	const s = 0.8 + pulse * 0.4;
	flash.sphere.scale.set(s, s, s);
}

function disposeFlash(flash, parent) {
	parent.remove(flash.group);
	flash.geom.dispose();
	flash.mat.dispose();
}

function createSmokeTexture() {
	if (typeof document === "undefined") return null;
	const canvas = document.createElement("canvas");
	canvas.width = 32;
	canvas.height = 32;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
	g.addColorStop(0, "rgba(160, 160, 160, 0.6)");
	g.addColorStop(0.6, "rgba(120, 120, 120, 0.25)");
	g.addColorStop(1, "rgba(90, 90, 90, 0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 32, 32);
	return new THREE.CanvasTexture(canvas);
}

function initSmokeSprites(group, texture, count) {
	const sprites = [];
	for (let i = 0; i < count; i++) {
		const mat = new THREE.SpriteMaterial({
			map: texture,
			color: 0x999999,
			transparent: true,
			opacity: 0.4,
			depthWrite: false,
		});
		const sprite = new THREE.Sprite(mat);
		group.add(sprite);
		sprites.push({
			sprite,
			mat,
			age: (i / count) * 2.0,
			ox: (Math.random() - 0.5) * 0.2,
			oz: (Math.random() - 0.5) * 0.2,
		});
	}
	return sprites;
}

function createSmokeEffect(effect, toScene, texture) {
	const [cx, cy, cz] = toScene(effect.position || [0, 0, 0]);
	const group = new THREE.Group();
	group.position.set(cx, cy, cz);
	const count = 5;
	const sprites = initSmokeSprites(group, texture, count);
	return {
		kind: "smoke",
		group,
		object: group,
		sprites,
		intensity: effect.intensity ?? 1.0,
	};
}

function updateSmokeEffect(smoke, dt) {
	for (const item of smoke.sprites) {
		item.age = (item.age + dt) % 2.0;
		const progress = item.age / 2.0;
		item.sprite.position.y = progress * 1.2;
		item.sprite.position.x = item.ox * (1 + progress * 2);
		item.sprite.position.z = item.oz * (1 + progress * 2);
		item.mat.opacity = (1 - progress) * 0.45 * smoke.intensity;
		const s = 0.25 + progress * 0.35;
		item.sprite.scale.set(s, s, s);
	}
}

function disposeSmoke(smoke, parent) {
	parent.remove(smoke.group);
	for (const item of smoke.sprites) {
		item.mat.dispose();
	}
}

function createSingleEffect(effect, toScene, smokeTex) {
	if (effect?.kind === "spark") {
		return createSparkEffect(effect, toScene);
	}
	if (effect?.kind === "flash") {
		return createFlashEffect(effect, toScene);
	}
	if (effect?.kind === "smoke") {
		return createSmokeEffect(effect, toScene, smokeTex);
	}
	return null;
}

function updateSingleEffect(eff, dt) {
	if (eff.kind === "spark") updateSparkEffect(eff, dt);
	else if (eff.kind === "flash") updateFlashEffect(eff, dt);
	else if (eff.kind === "smoke") updateSmokeEffect(eff, dt);
}

function disposeSingleEffect(eff, parent) {
	if (eff.kind === "spark") disposeSpark(eff, parent);
	else if (eff.kind === "flash") disposeFlash(eff, parent);
	else if (eff.kind === "smoke") disposeSmoke(eff, parent);
}

function disposeAllEffects(effects, parent) {
	for (const eff of effects) {
		disposeSingleEffect(eff, parent);
	}
	effects.length = 0;
}

function createEffectsManager(root, toScene, smokeTex) {
	const list = [];
	const setEffects = (effects) => {
		disposeAllEffects(list, root);
		if (!Array.isArray(effects)) return;
		for (const eff of effects) {
			const item = createSingleEffect(eff, toScene, smokeTex);
			if (item) {
				root.add(item.object);
				list.push(item);
			}
		}
	};
	const update = (dt) => {
		for (const eff of list) updateSingleEffect(eff, dt);
	};
	const dispose = () => {
		disposeAllEffects(list, root);
		smokeTex?.dispose();
	};
	return { setEffects, update, dispose };
}

export function createFlowLayer(scene, options = {}) {
	const toScene = resolveToScene(options?.boardToScene);
	const root = new THREE.Group();
	scene?.add?.(root);
	const dummy = new THREE.Object3D();
	const pathsMgr = createPathManager(root, toScene);
	const fxMgr = createEffectsManager(root, toScene, createSmokeTexture());

	return {
		setPaths: (paths) => pathsMgr.setPaths(paths),
		setEffects: (effects) => fxMgr.setEffects(effects),
		update: (dtS) => {
			const dt = typeof dtS === "number" ? dtS : 0.016;
			pathsMgr.update(dt, dummy);
			fxMgr.update(dt);
		},
		setVisible: (bool) => {
			root.visible = Boolean(bool);
		},
		dispose: () => {
			pathsMgr.dispose();
			fxMgr.dispose();
			scene?.remove?.(root);
		},
	};
}
