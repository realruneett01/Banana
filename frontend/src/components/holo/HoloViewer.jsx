import {
	AimOutlined,
	AppstoreOutlined,
	CameraOutlined,
	DownOutlined,
	EyeInvisibleOutlined,
	EyeOutlined,
	ScanOutlined,
	SyncOutlined,
	UpOutlined,
} from "@ant-design/icons";
import { Button, Segmented, Select, Slider, Spin, Tooltip } from "antd";
import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../../config.js";
import { createFlowLayer } from "../sim3d/flowLayer.js";
import { buildFlowPaths, faultEffects } from "../sim3d/flowModel.js";
import { createHoloScene } from "./holoScene.js";
import "./HoloViewer.css";

const RESOLUTIONS = [
	{ value: 720, label: "720p" },
	{ value: 1080, label: "1080p" },
	{ value: 2160, label: "4K" },
	{ value: 0, label: "Native" },
];
const QUALITIES = [
	{ value: "auto", label: "Auto (60 fps)" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "ultra", label: "Ultra (max)" },
];
const STYLE_OPTIONS = [
	{ label: "KiCad metal", value: "kicad" },
	{ label: "Hologram", value: "holo" },
];

async function fetchBoardGlb(source, commit, signal) {
	const { repoPath, owner, repo, relativeFilePath, githubToken } = source;
	const headers = { "Content-Type": "application/json" };
	if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
	const res = await fetch(`${API_BASE_URL}/api/board/glb`, {
		method: "POST",
		headers,
		signal,
		body: JSON.stringify({
			repoPath,
			owner,
			repo,
			commit,
			relativeFilePath,
			filePath: relativeFilePath,
		}),
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(data.details || res.statusText);
	}
	return res.arrayBuffer();
}

function useBoardGlb(source, commit) {
	const [state, setState] = useState({
		status: "idle",
		buffer: null,
		error: null,
	});
	const { repoPath, owner, repo, relativeFilePath, githubToken } = source || {};

	// biome-ignore lint/correctness/useExhaustiveDependencies: tracking source properties ensures re-fetch when fields change
	useEffect(() => {
		if (!source || !commit) {
			setState({ status: "idle", buffer: null, error: null });
			return;
		}
		const ctrl = new AbortController();
		setState({ status: "loading", buffer: null, error: null });
		fetchBoardGlb(source, commit, ctrl.signal)
			.then((buffer) => setState({ status: "ready", buffer, error: null }))
			.catch((err) => {
				if (err.name !== "AbortError") {
					setState({ status: "error", buffer: null, error: err.message });
				}
			});
		return () => ctrl.abort();
	}, [source, commit, repoPath, owner, repo, relativeFilePath, githubToken]);

	return state;
}

function getCaptureFileName(filePath, which, style) {
	const base = (filePath || "board").split("/").pop().replace(".kicad_pcb", "");
	return `${base}-${which}-${style}.png`;
}

function triggerDownload(blob, filename) {
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function captureScene(scene, res, meta) {
	const blob = await scene?.capture(res || undefined);
	if (!blob) return;
	const filename = getCaptureFileName(meta.filePath, meta.which, meta.style);
	triggerDownload(blob, filename);
}

function resetHoloView(scene, resetLayers) {
	scene?.resetView();
	scene?.showAll();
	resetLayers();
}

// one step = one more layer lifted off the stack (top first) or set back down
function calcStepExplode(explode, layerCount, delta) {
	const gaps = Math.max(1, (layerCount ?? 2) - 1);
	return Math.min(1, Math.max(0, Math.round(explode * gaps + delta) / gaps));
}

function getStatus(source, glb, parseError) {
	if (!source) {
		return {
			title: "No board loaded",
			text: "Load a .kicad_pcb diff from the Controls panel to see it as a 3D hologram.",
		};
	}
	if (glb.status === "loading") {
		return {
			title: "Building 3D model…",
			text: "kicad-cli is exporting every layer and component. The first export of a revision takes ~20 s; after that it is cached.",
			spin: true,
		};
	}
	if (glb.status === "error") {
		return { title: "3D export failed", text: glb.error };
	}
	if (parseError) {
		return { title: "Could not read 3D model", text: parseError };
	}
	return null;
}

function HoloStatusOverlay({ status }) {
	if (!status) return null;
	return (
		<div className="holo-status">
			{status.spin && <Spin />}
			<div className="holo-status-title">{status.title}</div>
			<div className="holo-status-text">{status.text}</div>
		</div>
	);
}

function HoloTip({ hover }) {
	if (!hover) return null;
	return (
		<div className="holo-tip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
			◢ {hover.ref}
		</div>
	);
}

function HoloReadout({ board, bufferSize }) {
	if (!board) return null;
	return (
		<div className="holo-readout">
			{board.sizeMm[0].toFixed(1)} × {board.sizeMm[1].toFixed(1)} mm ·{" "}
			{board.layers.length} layers · {board.parts} parts
			{bufferSize && <> · render {bufferSize}</>}
		</div>
	);
}

function HoloSliderRow({ label, min, max, step = 0.01, value, onChange }) {
	return (
		<div className="holo-row">
			<span>{label}</span>
			<Slider
				aria-label={label}
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={onChange}
			/>
		</div>
	);
}

function HoloSelectRow({ label, value, options, onChange }) {
	return (
		<div className="holo-row">
			<span>{label}</span>
			<Select
				aria-label={label}
				size="small"
				value={value}
				options={options}
				popupMatchSelectWidth={false}
				onChange={onChange}
			/>
		</div>
	);
}

function formatCommitLabel(name, hash) {
	return `${name} ${String(hash || "").slice(0, 7)}`;
}

function HoloCommitSelector({ source, which, onChange }) {
	if (!source) return null;
	const options = [
		{
			label: formatCommitLabel("Target", source.targetCommit),
			value: "target",
		},
		{
			label: formatCommitLabel("Base", source.baseCommit),
			value: "base",
		},
	];
	return (
		<Segmented
			block
			size="small"
			value={which}
			onChange={onChange}
			options={options}
		/>
	);
}

function HoloLayerItem({ layer, isSolo, isHidden, onSolo, onToggle }) {
	const zText = layer.k > 0 ? `+${layer.k}` : layer.k;
	const cls = `holo-layer${isSolo ? " is-solo" : ""}${isHidden ? " is-off" : ""}`;
	const icon = isHidden ? <EyeInvisibleOutlined /> : <EyeOutlined />;
	return (
		// biome-ignore lint/a11y/useSemanticElements: row contains a nested eye <button>; a <button> cannot nest another button
		<div
			className={cls}
			role="button"
			tabIndex={0}
			onClick={() => onSolo(layer.key)}
			onKeyDown={(e) => {
				if (
					e.target === e.currentTarget &&
					(e.key === "Enter" || e.key === " ")
				) {
					e.preventDefault();
					onSolo(layer.key);
				}
			}}
		>
			<span className="holo-swatch" style={{ background: layer.swatch }} />
			<span className="holo-layer-name">{layer.label}</span>
			<span className="holo-layer-z">{zText}</span>
			<button
				type="button"
				className="holo-eye"
				aria-label={`Toggle ${layer.label}`}
				onClick={(e) => {
					e.stopPropagation();
					onToggle(layer.key);
				}}
			>
				{icon}
			</button>
		</div>
	);
}

function HoloLayersList({ board, layers }) {
	const list = board?.layers ?? [];
	return (
		<div className="holo-layers">
			{list.map((L) => (
				<HoloLayerItem
					key={L.key}
					layer={L}
					isSolo={layers.solo === L.key}
					isHidden={Boolean(layers.hidden[L.key])}
					onSolo={layers.soloLayer}
					onToggle={layers.toggleLayer}
				/>
			))}
			{!board && (
				<div className="holo-empty">Layers appear once the board loads.</div>
			)}
		</div>
	);
}

function HoloLayerActions({ disabled, explode, onStep }) {
	return (
		<div className="holo-actions">
			<Button
				size="small"
				icon={<UpOutlined />}
				onClick={() => onStep(1)}
				disabled={disabled || explode >= 1}
			>
				Lift layer
			</Button>
			<Button
				size="small"
				icon={<DownOutlined />}
				onClick={() => onStep(-1)}
				disabled={disabled || explode <= 0}
			>
				Lower layer
			</Button>
		</div>
	);
}

function HoloExplodeControls({ hasBoard, explode, spacing, onSpacing }) {
	return (
		<>
			<HoloSliderRow
				label="Explode"
				min={0}
				max={1}
				value={explode.explode}
				onChange={explode.updateExplode}
			/>
			<HoloLayerActions
				disabled={!hasBoard}
				explode={explode.explode}
				onStep={explode.stepLayer}
			/>
			<HoloSliderRow
				label="Spacing"
				min={0.3}
				max={2.5}
				value={spacing}
				onChange={onSpacing}
			/>
		</>
	);
}

function HoloGlowRow({ glow, style, scene, setGlow }) {
	const max = style === "holo" ? 3 : 1.5;
	return (
		<HoloSliderRow
			label="Glow"
			min={0}
			max={max}
			value={glow}
			onChange={(v) => {
				setGlow(v);
				scene?.setGlow(v);
			}}
		/>
	);
}

function HoloRenderSelects({ scene, renderProps, setBufferSize }) {
	return (
		<>
			<HoloSelectRow
				label="Graphics"
				value={renderProps.quality}
				options={QUALITIES}
				onChange={(v) => {
					renderProps.setQuality(v);
					setBufferSize(scene?.setQuality(v) || "");
				}}
			/>
			<HoloSelectRow
				label="Resolution"
				value={renderProps.res}
				options={RESOLUTIONS}
				onChange={(v) => {
					renderProps.setRes(v);
					setBufferSize(scene?.setResolution(v) || "");
				}}
			/>
		</>
	);
}

function HoloStyleSelector({ style, onChange }) {
	return (
		<Segmented
			block
			size="small"
			value={style}
			onChange={onChange}
			options={STYLE_OPTIONS}
		/>
	);
}

function HoloCaptureButton({ scene, res, meta, disabled }) {
	return (
		<Tooltip title="Save a PNG at the selected resolution (16:9)">
			<Button
				size="small"
				icon={<CameraOutlined />}
				onClick={() => captureScene(scene, res, meta)}
				disabled={disabled}
			>
				Capture
			</Button>
		</Tooltip>
	);
}

function HoloOrbitButton({ orbit, onToggle }) {
	return (
		<Button
			size="small"
			icon={<SyncOutlined spin={orbit} />}
			type={orbit ? "primary" : "default"}
			onClick={onToggle}
		>
			Orbit
		</Button>
	);
}

function HoloViewActions({ disabled, scene, renderProps, layers, meta }) {
	const onReset = () => resetHoloView(scene, layers.resetLayers);
	return (
		<div className="holo-actions">
			<HoloCaptureButton
				scene={scene}
				res={renderProps.res}
				meta={meta}
				disabled={disabled}
			/>
			<Button
				size="small"
				icon={<ScanOutlined />}
				onClick={() => scene?.scan()}
				disabled={disabled}
			>
				Scan
			</Button>
			<HoloOrbitButton
				orbit={renderProps.orbit}
				onToggle={renderProps.toggleOrbit}
			/>
			<Button size="small" icon={<AimOutlined />} onClick={onReset}>
				Reset
			</Button>
		</div>
	);
}

export function makeBoardToScene(board) {
	const sx = board?.sizeMm?.[0] || 100;
	const sy = board?.sizeMm?.[1] || 100;
	const maxDim = Math.max(sx, sy) || 100;
	const s = 10 / maxDim;
	const cx = sx / 2;
	const cz = sy / 2;
	return (x, y = 0, z = 0) => {
		const px = Array.isArray(x) ? x[0] : (x ?? 0);
		const py = Array.isArray(x) ? x[1] : (y ?? 0);
		const pz = Array.isArray(x) ? x[2] : (z ?? 0);
		return [(px - cx) * s, 1.2 + (pz ?? 0) * s, (py - cz) * s];
	};
}

function resolveBoardToScene(sceneRef, board) {
	return (x, y, z) => {
		const pt = sceneRef?.current?.boardToScene?.(x, y, z);
		if (pt != null) return pt;
		return makeBoardToScene(board)(x, y, z);
	};
}

function useHoloScene(onFrameRef) {
	const mountRef = useRef(null);
	const sceneRef = useRef(null);
	const [threeScene, setThreeScene] = useState(null);
	const [hover, setHover] = useState(null);

	useEffect(() => {
		if (!mountRef.current) return;
		const s = createHoloScene(mountRef.current, {
			onHover: setHover,
			onFrame: (dt) => onFrameRef?.current?.(dt),
		});
		sceneRef.current = s;
		setThreeScene(s.scene);
		return () => {
			s.dispose();
			sceneRef.current = null;
			setThreeScene(null);
		};
	}, [onFrameRef]);

	return { mountRef, sceneRef, threeScene, hover };
}

function useGlbLoader(sceneRef, glb, res, onLoaded) {
	const [board, setBoard] = useState(null);
	const [parseError, setParseError] = useState(null);
	const [bufferSize, setBufferSize] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: glb and res determine when to reload; onLoaded is an unstable callback
	useEffect(() => {
		if (glb.status !== "ready" || !sceneRef.current) return;
		let alive = true;
		setParseError(null);
		sceneRef.current
			.loadGlb(glb.buffer)
			.then((info) => {
				if (!alive) return;
				setBoard(info);
				onLoaded();
				setBufferSize(sceneRef.current.setResolution(res));
			})
			.catch((err) => alive && setParseError(err.message));
		return () => {
			alive = false;
		};
	}, [glb, res]);

	return { board, parseError, bufferSize, setBufferSize };
}

function useLayerVisibility(sceneRef) {
	const [hidden, setHidden] = useState({});
	const [solo, setSolo] = useState(null);

	const resetLayers = () => {
		setHidden({});
		setSolo(null);
	};

	const toggleLayer = (key) => {
		const on = !!hidden[key];
		setHidden({ ...hidden, [key]: !on });
		sceneRef.current?.setLayerVisible(key, on);
	};

	const soloLayer = (key) => {
		const next = solo === key ? null : key;
		setSolo(next);
		sceneRef.current?.setSolo(next);
	};

	return { hidden, solo, resetLayers, toggleLayer, soloLayer };
}

function useLayerExplode(sceneRef, board) {
	const [explode, setExplode] = useState(1);

	const updateExplode = (v) => {
		setExplode(v);
		sceneRef.current?.setExplode(v);
	};

	const stepLayer = (delta) => {
		const v = calcStepExplode(explode, board?.layers?.length, delta);
		updateExplode(v);
	};

	return { explode, updateExplode, stepLayer };
}

function useViewerStyle(sceneRef) {
	const [style, setStyle] = useState("kicad");
	const [glow, setGlow] = useState(0);

	const changeStyle = (v) => {
		setStyle(v);
		sceneRef.current?.setStyle(v);
		const g = v === "holo" ? 1 : 0;
		setGlow(g);
		sceneRef.current?.setGlow(g);
	};

	return { style, glow, setGlow, changeStyle };
}

function useRenderSettings(sceneRef) {
	const [spacing, setSpacing] = useState(1);
	const [quality, setQuality] = useState("auto");
	const [res, setRes] = useState(0);
	const [orbit, setOrbit] = useState(true);

	const updateSpacing = (v) => {
		setSpacing(v);
		sceneRef.current?.setSpacing(v);
	};

	const toggleOrbit = () => {
		setOrbit(!orbit);
		sceneRef.current?.setAutoRotate(!orbit);
	};

	return {
		spacing,
		updateSpacing,
		quality,
		setQuality,
		res,
		setRes,
		orbit,
		toggleOrbit,
	};
}

function HoloLayersSection({
	source,
	which,
	onWhichChange,
	board,
	layers,
	explode,
	spacing,
	onSpacing,
}) {
	return (
		<>
			<HoloCommitSelector
				source={source}
				which={which}
				onChange={onWhichChange}
			/>
			<div className="holo-section-title">Layers</div>
			<HoloLayersList board={board} layers={layers} />
			<HoloExplodeControls
				hasBoard={Boolean(board)}
				explode={explode}
				spacing={spacing}
				onSpacing={onSpacing}
			/>
		</>
	);
}

function HoloViewSection({
	scene,
	styling,
	render,
	layers,
	meta,
	board,
	onBufferSize,
}) {
	return (
		<>
			<HoloGlowRow
				glow={styling.glow}
				style={styling.style}
				scene={scene}
				setGlow={styling.setGlow}
			/>
			<HoloRenderSelects
				scene={scene}
				renderProps={render}
				setBufferSize={onBufferSize}
			/>
			<HoloStyleSelector style={styling.style} onChange={styling.changeStyle} />
			<HoloViewActions
				disabled={!board}
				scene={scene}
				renderProps={render}
				layers={layers}
				meta={meta}
			/>
		</>
	);
}

function HoloPanelContent({ state }) {
	const {
		source,
		which,
		setWhich,
		loader,
		layers,
		explode,
		styling,
		render,
		sceneRef,
	} = state;
	const meta = {
		filePath: source?.relativeFilePath,
		which,
		style: styling.style,
	};

	return (
		<>
			<HoloLayersSection
				source={source}
				which={which}
				onWhichChange={setWhich}
				board={loader.board}
				layers={layers}
				explode={explode}
				spacing={render.spacing}
				onSpacing={render.updateSpacing}
			/>
			<HoloViewSection
				scene={sceneRef.current}
				styling={styling}
				render={render}
				layers={layers}
				meta={meta}
				board={loader.board}
				onBufferSize={loader.setBufferSize}
			/>
		</>
	);
}

function HoloPanel({ state }) {
	const [sheetOpen, setSheetOpen] = useState(false);
	const cls = `holo-panel${sheetOpen ? " is-open" : ""}`;
	const icon = sheetOpen ? <DownOutlined /> : <UpOutlined />;

	return (
		<aside className={cls}>
			<button
				type="button"
				className="holo-sheet-handle"
				onClick={() => setSheetOpen(!sheetOpen)}
			>
				<AppstoreOutlined /> Layers & view {icon}
			</button>
			<div className="holo-panel-body">
				<HoloPanelContent state={state} />
			</div>
		</aside>
	);
}

function useFlowLayerLifecycle({ flow, faults, threeScene, board, sceneRef }) {
	const layerRef = useRef(null);
	useEffect(() => {
		if (!flow || !threeScene) {
			layerRef.current?.dispose();
			layerRef.current = null;
			return;
		}
		layerRef.current?.dispose();
		const boardToScene = resolveBoardToScene(sceneRef, board);
		const layer = createFlowLayer(threeScene, { boardToScene });
		layerRef.current = layer;
		const paths = buildFlowPaths(flow);
		layer.setPaths(paths);
		layer.setEffects(faultEffects(faults, paths));
	}, [flow, faults, threeScene, board, sceneRef]);

	useEffect(() => {
		return () => {
			layerRef.current?.dispose();
			layerRef.current = null;
		};
	}, []);
	return layerRef;
}

function useFlowAnimationLoop(layerRef, playing, onFrameRef) {
	useEffect(() => {
		onFrameRef.current = (dt) => {
			if (playing && layerRef.current) {
				layerRef.current.update(dt);
			}
		};
		return () => {
			onFrameRef.current = null;
		};
	}, [playing, onFrameRef, layerRef]);
}

function useFlowSync({
	flow,
	faults,
	playing,
	threeScene,
	board,
	sceneRef,
	onFrameRef,
}) {
	const layerRef = useFlowLayerLifecycle({
		flow,
		faults,
		threeScene,
		board,
		sceneRef,
	});
	useFlowAnimationLoop(layerRef, playing, onFrameRef);
}

function useHoloViewState(source, onFrameRef) {
	const [which, setWhich] = useState("target");
	const commit = which === "base" ? source?.baseCommit : source?.targetCommit;
	const glb = useBoardGlb(source, commit);
	const holo = useHoloScene(onFrameRef);
	const layers = useLayerVisibility(holo.sceneRef);
	const styling = useViewerStyle(holo.sceneRef);
	const render = useRenderSettings(holo.sceneRef);
	const loader = useGlbLoader(
		holo.sceneRef,
		glb,
		render.res,
		layers.resetLayers,
	);
	const explode = useLayerExplode(holo.sceneRef, loader.board);
	const status = getStatus(source, glb, loader.parseError);
	return {
		which,
		setWhich,
		glb,
		holo,
		layers,
		styling,
		render,
		loader,
		explode,
		status,
	};
}

function buildPanelState(source, s) {
	return {
		source,
		which: s.which,
		setWhich: s.setWhich,
		loader: s.loader,
		layers: s.layers,
		explode: s.explode,
		styling: s.styling,
		render: s.render,
		sceneRef: s.holo.sceneRef,
	};
}

/**
 * 3D hologram view of the real board: every copper layer, mask, silkscreen, FR4 core
 * and component model from kicad-cli, stacked so layers can be exploded and inspected.
 */
export default function HoloViewer({
	source,
	flow,
	faults = [],
	playing = true,
}) {
	const onFrameRef = useRef(null);
	const s = useHoloViewState(source, onFrameRef);
	useFlowSync({
		flow,
		faults,
		playing,
		threeScene: s.holo.threeScene,
		board: s.loader.board,
		sceneRef: s.holo.sceneRef,
		onFrameRef,
	});

	return (
		<div className="holo-root">
			<div ref={s.holo.mountRef} className="holo-canvas" />
			<HoloStatusOverlay status={s.status} />
			<HoloTip hover={s.holo.hover} />
			<HoloReadout board={s.loader.board} bufferSize={s.loader.bufferSize} />
			<HoloPanel state={buildPanelState(source, s)} />
		</div>
	);
}
