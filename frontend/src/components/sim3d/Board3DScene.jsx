import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
	boardSize,
	netCurrentsFromParts,
	netSegments,
	partPowers,
} from "./boardGeometry.js";
import { envBadges, envToVisuals, worstCaseAmbient } from "./envVisuals.js";
import { createFlowLayer } from "./flowLayer.js";
import { buildFlowPaths, faultEffects } from "./flowModel.js";
import { createHeatLayer } from "./heatLayer.js";
import { heatGrid, legendStops, partTemperatures } from "./heatModel.js";
import { cloneModel, loadModel } from "./stepModels.js";

const CONTAINER_STYLE = Object.freeze({
	position: "relative",
	width: "100%",
	height: "100%",
	minHeight: "450px",
	overflow: "hidden",
	background: "#0a0c14",
	borderRadius: "8px",
	border: "1px solid #23283e",
});

function makeBoardToScene(w, h) {
	return (x, y = 0, z = 0) => {
		const px = Array.isArray(x) ? x[0] : x;
		const py = Array.isArray(x) ? x[1] : y;
		const pz = Array.isArray(x) ? (x[2] ?? 0) : z;
		return [px - w / 2, pz, py - h / 2];
	};
}

function createBoardMesh(w, h, frost = false) {
	const geom = new THREE.BoxGeometry(w, 1.6, h);
	const color = frost ? 0x3b7d80 : 0x164e2e;
	const mat = new THREE.MeshStandardMaterial({
		color,
		roughness: frost ? 0.9 : 0.8,
		metalness: 0.1,
	});
	const mesh = new THREE.Mesh(geom, mat);
	mesh.position.set(0, -0.8, 0);
	return mesh;
}

function drawTextCanvas(canvas, text) {
	const ctx = canvas.getContext("2d");
	if (!ctx) return false;
	ctx.clearRect(0, 0, 128, 64);
	ctx.font = "bold 26px sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = "#f1f5f9";
	ctx.fillText(text, 64, 32);
	return true;
}

function createTextSprite(text) {
	if (typeof document === "undefined" || !text) return null;
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 64;
	if (!drawTextCanvas(canvas, text)) return null;
	const texture = new THREE.CanvasTexture(canvas);
	const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
	const sprite = new THREE.Sprite(mat);
	sprite.scale.set(3, 1.5, 1);
	return sprite;
}

function isHighlighted(id, highlightIds) {
	if (!id || !highlightIds) return false;
	if (highlightIds instanceof Set) return highlightIds.has(id);
	if (Array.isArray(highlightIds)) return highlightIds.includes(id);
	return highlightIds === id;
}

function createPartMesh(part, isHigh, toScene) {
	const pw = part.props?.sizeMm?.w ?? 5;
	const ph = part.props?.sizeMm?.h ?? 5;
	const geom = new THREE.BoxGeometry(pw, 1.5, ph);
	const mat = new THREE.MeshStandardMaterial(
		isHigh
			? { color: 0xfadb14, emissive: 0xfadb14, emissiveIntensity: 0.6 }
			: { color: 0x1e222d, roughness: 0.6, metalness: 0.2 },
	);
	const mesh = new THREE.Mesh(geom, mat);
	const pl = part.placement ?? { x: 0, y: 0, rot: 0 };
	const [sx, sy, sz] = toScene(pl.x, pl.y, 0.75);
	mesh.position.set(sx, sy, sz);
	mesh.rotation.y = -((pl.rot || 0) * Math.PI) / 180;
	const sprite = createTextSprite(part.ref);
	if (sprite) {
		sprite.position.set(sx, 1.5 + 0.6, sz);
		mesh.add(sprite);
	}
	return mesh;
}

function resolvePartFootprint(part) {
	return part?.footprint || part?.fp || part?.props?.footprint || null;
}

function attachPartModel(group, mesh, part, toScene) {
	const fp = resolvePartFootprint(part);
	if (!fp) return;
	loadModel(fp)
		.then((modelGroup) => {
			if (!modelGroup || mesh.parent !== group) return;
			const clone = cloneModel(modelGroup);
			if (!clone) return;
			const pl = part.placement ?? { x: 0, y: 0, rot: 0 };
			const [sx, sy, sz] = toScene(pl.x, pl.y, 0);
			clone.position.set(sx, sy, sz);
			clone.rotation.y = -((pl.rot || 0) * Math.PI) / 180;
			disposeHierarchy(mesh);
			group.add(clone);
		})
		.catch(() => {});
}

function createPartsGroup(parts, highlightIds, toScene) {
	const group = new THREE.Group();
	for (const part of parts) {
		const high = isHighlighted(part.id, highlightIds);
		const mesh = createPartMesh(part, high, toScene);
		group.add(mesh);
		attachPartModel(group, mesh, part, toScene);
	}
	return group;
}

function disposeHierarchy(node) {
	if (!node) return;
	for (let i = node.children.length - 1; i >= 0; i--) {
		disposeHierarchy(node.children[i]);
	}
	node.geometry?.dispose();
	const mats = Array.isArray(node.material) ? node.material : [node.material];
	for (const m of mats) {
		m?.map?.dispose();
		m?.dispose();
	}
	node.parent?.remove(node);
}

function createDroplets(count, w, h) {
	if (!count || count <= 0) return null;
	const geom = new THREE.BufferGeometry();
	const positions = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		positions[i * 3] = (Math.random() - 0.5) * (w + 40);
		positions[i * 3 + 1] = Math.random() * 50;
		positions[i * 3 + 2] = (Math.random() - 0.5) * (h + 40);
	}
	geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	const mat = new THREE.PointsMaterial({
		color: 0x93c5fd,
		size: 1.2,
		transparent: true,
		opacity: 0.75,
	});
	return new THREE.Points(geom, mat);
}

function updateDroplets(droplets, dt) {
	if (!droplets) return;
	const pos = droplets.geometry.attributes.position.array;
	const speed = 40;
	for (let i = 1; i < pos.length; i += 3) {
		pos[i] -= speed * dt;
		if (pos[i] < -2) pos[i] = 50;
	}
	droplets.geometry.attributes.position.needsUpdate = true;
}

function buildNetTemps(nets, partTemps) {
	const netTemps = { ...partTemps };
	for (const net of nets ?? []) {
		let maxT = 25;
		for (const pin of net.pins ?? []) {
			const t = partTemps[pin.partId];
			if (typeof t === "number" && t > maxT) maxT = t;
		}
		netTemps[net.id] = maxT;
	}
	return netTemps;
}

function buildHeatPlacements(parts, partTemps) {
	const placements = [];
	for (const part of parts ?? []) {
		const pl = part.placement;
		if (typeof pl?.x === "number" && typeof pl?.y === "number") {
			const w = part.props?.sizeMm?.w ?? 5;
			const h = part.props?.sizeMm?.h ?? 5;
			placements.push({
				x: pl.x,
				y: pl.y,
				tempC: partTemps[part.id] ?? 25,
				radiusMm: Math.max(w, h) / 2,
			});
		}
	}
	return placements;
}

function syncLayers(flowLayer, heatLayer, ctx) {
	const { ir, board, result, fault, size, env } = ctx;
	const segments = netSegments(ir, board);
	const netCurrents = netCurrentsFromParts(ir, result?.partCurrents);
	const powers = partPowers(ir, result?.partCurrents, result?.nodeVoltages);
	const ambientC = env ? worstCaseAmbient(env) : undefined;
	const partTemps = partTemperatures({ ir, partPowers: powers, ambientC });
	const netTemps = buildNetTemps(ir?.nets, partTemps);
	const paths = buildFlowPaths({ segments, netCurrents, netTemps });
	flowLayer.setPaths(paths);
	const faults = fault ? (Array.isArray(fault) ? fault : [fault]) : [];
	flowLayer.setEffects(faultEffects(faults, paths));
	const placements = buildHeatPlacements(ir?.parts, partTemps);
	heatLayer.setGrid(
		heatGrid({
			boardW: size.w,
			boardH: size.h,
			cellMm: 2,
			placements,
			ambientC,
		}),
	);
}

function setupRenderer(container) {
	const renderer = new THREE.WebGLRenderer({ antialias: true });
	const w = container.clientWidth || 400;
	const h = container.clientHeight || 450;
	renderer.setSize(w, h);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.domElement.style.display = "block";
	container.appendChild(renderer.domElement);
	return renderer;
}

function setupLights(scene) {
	const ambient = new THREE.AmbientLight(0xffffff, 0.7);
	scene.add(ambient);
	const dir = new THREE.DirectionalLight(0xffffff, 0.8);
	dir.position.set(30, 60, 40);
	scene.add(dir);
	return { ambient, dir };
}

function initThree(container, toSceneRef) {
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0a0c14);
	const renderer = setupRenderer(container);
	const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	const lights = setupLights(scene);
	const boardGroup = new THREE.Group();
	scene.add(boardGroup);
	const flow = createFlowLayer(boardGroup, {
		boardToScene: (...a) => toSceneRef.current(...a),
	});
	const heat = createHeatLayer(boardGroup, {
		boardToScene: (...a) => toSceneRef.current(...a),
	});
	return { scene, renderer, camera, controls, flow, heat, lights, boardGroup };
}

function cleanupThree(three) {
	three.controls.dispose();
	three.flow.dispose();
	three.heat.dispose();
	three.renderer.dispose();
	three.renderer.domElement.remove();
}

function handleResize(entries, camera, renderer) {
	if (!renderer || !camera) return;
	for (const entry of entries) {
		const { width, height } = entry.contentRect;
		if (width <= 0 || height <= 0) continue;
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		renderer.setSize(width, height);
	}
}

function useResizeHandler(containerRef, threeRef) {
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const three = threeRef.current;
			if (three) handleResize(entries, three.camera, three.renderer);
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [containerRef, threeRef]);
}

function useThreeScene(containerRef, toSceneRef) {
	const threeRef = useRef(null);
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const three = initThree(container, toSceneRef);
		threeRef.current = three;
		return () => {
			cleanupThree(three);
			threeRef.current = null;
		};
	}, [containerRef, toSceneRef]);
	useResizeHandler(containerRef, threeRef);
	return threeRef;
}

function applyEnvToScene(three, env) {
	if (!three) return;
	if (!env) {
		three.scene.background = new THREE.Color(0x0a0c14);
		three.scene.fog = null;
		three.lights.ambient.color.set(0xffffff);
		three.lights.ambient.intensity = 0.7;
		return;
	}
	const vis = envToVisuals(env);
	three.scene.background = new THREE.Color(vis.skyColor);
	three.scene.fog =
		vis.fogDensity > 0 ? new THREE.FogExp2(vis.skyColor, vis.fogDensity) : null;
	three.lights.ambient.color.set(vis.lightColor);
	three.lights.ambient.intensity = vis.lightIntensity;
}

function updateBoardAndParts(three, toScene, meshes, opts) {
	disposeHierarchy(meshes.board);
	disposeHierarchy(meshes.parts);
	disposeHierarchy(meshes.droplets);
	const size = boardSize(opts.ir);
	meshes.board = createBoardMesh(size.w, size.h, opts.frost);
	meshes.parts = createPartsGroup(
		opts.ir?.parts ?? [],
		opts.highlightIds,
		toScene,
	);
	three.boardGroup.add(meshes.board);
	three.boardGroup.add(meshes.parts);
	meshes.droplets = createDroplets(opts.droplets, size.w, size.h);
	if (meshes.droplets) three.scene.add(meshes.droplets);
	return size;
}

function updateCameraTarget(camera, controls, size) {
	const maxDim = Math.max(size.w, size.h, 20);
	camera?.position.set(0, maxDim * 1.2, maxDim * 1.2);
	camera?.lookAt(0, 0, 0);
	controls?.target.set(0, 0, 0);
}

function syncBoardScene(ctx, three, toSceneRef, meshes) {
	const { ir, board, result, fault, highlightIds, env } = ctx;
	const visuals = env ? envToVisuals(env) : null;
	applyEnvToScene(three, env);
	const size = boardSize(ir);
	const toScene = makeBoardToScene(size.w, size.h);
	toSceneRef.current = toScene;
	updateBoardAndParts(three, toScene, meshes, {
		ir,
		highlightIds,
		frost: Boolean(visuals?.frost),
		droplets: visuals?.droplets ?? 0,
	});
	updateCameraTarget(three.camera, three.controls, size);
	syncLayers(three.flow, three.heat, { ir, board, result, fault, size, env });
}

function useBoardObjects(threeRef, toSceneRef, props, meshesRef) {
	const { ir, board, result, fault, highlightIds, env } = props;

	useEffect(() => {
		const three = threeRef.current;
		if (!three) return;
		const ctx = { ir, board, result, fault, highlightIds, env };
		syncBoardScene(ctx, three, toSceneRef, meshesRef.current);
	}, [
		threeRef,
		toSceneRef,
		ir,
		board,
		result,
		fault,
		highlightIds,
		env,
		meshesRef,
	]);
}

function applyBoardShake(boardGroup, shake, heatShimmer, time) {
	const hasShake = Boolean(shake?.amplitudeMm > 0 && shake?.frequencyHz > 0);
	if (hasShake) {
		const offset =
			Math.sin(time * 2 * Math.PI * shake.frequencyHz) * shake.amplitudeMm;
		boardGroup.position.y = offset;
	} else {
		boardGroup.position.y = 0;
	}
	if (heatShimmer) {
		const wobble = 1 + 0.006 * Math.sin(time * 6.0);
		boardGroup.scale.set(wobble, 1, 1 / wobble);
	} else {
		boardGroup.scale.set(1, 1, 1);
	}
}

function stepAnimation(three, state, rawDt, meshes) {
	if (state.playing) {
		const dt = rawDt * (state.speed || 1);
		state.time = (state.time || 0) + dt;
		three.flow.update(dt);
		three.heat.update(dt);
		updateDroplets(meshes.droplets, dt);
		applyBoardShake(
			three.boardGroup,
			state.visuals?.shake,
			state.visuals?.heatShimmer,
			state.time,
		);
	} else {
		three.boardGroup.position.set(0, 0, 0);
		three.boardGroup.scale.set(1, 1, 1);
	}
	three.controls.update();
	three.renderer.render(three.scene, three.camera);
}

function useAnimationLoop(threeRef, opts, meshesRef) {
	const { playing, speed, env } = opts;
	const visuals = useMemo(() => (env ? envToVisuals(env) : null), [env]);
	const stateRef = useRef({ playing, speed, visuals, time: 0 });
	stateRef.current = { playing, speed, visuals, time: stateRef.current.time };

	useEffect(() => {
		let animId = null;
		let lastTime = performance.now();
		const animate = (now) => {
			animId = requestAnimationFrame(animate);
			const rawDt = Math.min((now - lastTime) / 1000, 0.1);
			lastTime = now;
			const three = threeRef.current;
			if (three)
				stepAnimation(three, stateRef.current, rawDt, meshesRef.current);
		};
		animId = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(animId);
	}, [threeRef, meshesRef]);
}

function LegendItem({ stop }) {
	const [r, g, b] = stop.color;
	const rgb = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
	return (
		<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
			<span
				style={{
					width: "10px",
					height: "10px",
					borderRadius: "2px",
					background: rgb,
					flexShrink: 0,
				}}
			/>
			<span style={{ color: "#cbd5e1" }}>
				{stop.tempC}°C - {stop.label}
			</span>
		</div>
	);
}

const OVERLAY_STYLE = Object.freeze({
	position: "absolute",
	bottom: "12px",
	left: "12px",
	background: "rgba(13, 15, 24, 0.85)",
	border: "1px solid #23283e",
	borderRadius: "6px",
	padding: "8px 10px",
	fontSize: "11px",
	display: "flex",
	flexDirection: "column",
	gap: "4px",
	pointerEvents: "none",
	backdropFilter: "blur(4px)",
});

const NOTE_STYLE = Object.freeze({
	marginTop: "4px",
	paddingTop: "4px",
	borderTop: "1px solid #1e2438",
	color: "#38bdf8",
	fontWeight: 600,
});

const ENV_SECTION_STYLE = Object.freeze({
	borderBottom: "1px solid #1e2438",
	paddingBottom: "6px",
	marginBottom: "4px",
	display: "flex",
	flexDirection: "column",
	gap: "4px",
});

const ENV_LABEL_STYLE = Object.freeze({
	fontWeight: 600,
	color: "#e2e8f0",
	fontSize: "11px",
	lineHeight: "1.3",
});

const BADGES_ROW_STYLE = Object.freeze({
	display: "flex",
	flexWrap: "wrap",
	gap: "4px",
	marginTop: "2px",
});

const BADGE_CHIP_STYLE = Object.freeze({
	background: "#1e293b",
	color: "#38bdf8",
	border: "1px solid #334155",
	borderRadius: "4px",
	padding: "1px 5px",
	fontSize: "10px",
	fontWeight: 600,
});

function EnvOverlaySection({ visuals, badges }) {
	return (
		<div style={ENV_SECTION_STYLE}>
			<div style={ENV_LABEL_STYLE}>{visuals.label}</div>
			{badges.length > 0 && (
				<div style={BADGES_ROW_STYLE}>
					{badges.map((b) => (
						<span key={b} style={BADGE_CHIP_STYLE}>
							{b}
						</span>
					))}
				</div>
			)}
		</div>
	);
}

function LegendOverlay({ env }) {
	const ambient = env ? worstCaseAmbient(env) : 25;
	const stops = useMemo(() => legendStops(ambient, ambient + 80), [ambient]);
	const visuals = useMemo(() => (env ? envToVisuals(env) : null), [env]);
	const badges = useMemo(() => (env ? envBadges(env) : []), [env]);
	const showEnv = Boolean(env && visuals);

	return (
		<div style={OVERLAY_STYLE}>
			{showEnv && <EnvOverlaySection visuals={visuals} badges={badges} />}
			<div style={{ fontWeight: 700, color: "#94a3b8", marginBottom: "2px" }}>
				Temperature
			</div>
			{stops.map((s) => (
				<LegendItem key={s.tempC} stop={s} />
			))}
			<div style={NOTE_STYLE}>brighter, faster dots = more current</div>
		</div>
	);
}

export default function Board3DScene(props) {
	const containerRef = useRef(null);
	const toSceneRef = useRef((x, y, z) => [x, y, z]);
	const meshesRef = useRef({ board: null, parts: null, droplets: null });
	const threeRef = useThreeScene(containerRef, toSceneRef);
	useBoardObjects(threeRef, toSceneRef, props, meshesRef);
	useAnimationLoop(
		threeRef,
		{ playing: props.playing, speed: props.speed, env: props.env },
		meshesRef,
	);

	return (
		<div style={CONTAINER_STYLE} ref={containerRef}>
			<LegendOverlay env={props.env} />
		</div>
	);
}
