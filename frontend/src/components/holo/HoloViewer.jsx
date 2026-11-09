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

function useBoardGlb(source, commit) {
	const [state, setState] = useState({
		status: "idle",
		buffer: null,
		error: null,
	});
	const { repoPath, owner, repo, relativeFilePath, githubToken } = source || {};

	useEffect(() => {
		if (!source || !commit) {
			setState({ status: "idle", buffer: null, error: null });
			return;
		}
		const ctrl = new AbortController();
		setState({ status: "loading", buffer: null, error: null });
		const headers = { "Content-Type": "application/json" };
		if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
		fetch(`${API_BASE_URL}/api/board/glb`, {
			method: "POST",
			headers,
			signal: ctrl.signal,
			body: JSON.stringify({
				repoPath,
				owner,
				repo,
				commit,
				relativeFilePath,
				filePath: relativeFilePath,
			}),
		})
			.then(async (r) => {
				if (!r.ok)
					throw new Error(
						(await r.json().catch(() => ({}))).details || r.statusText,
					);
				return r.arrayBuffer();
			})
			.then((buffer) => setState({ status: "ready", buffer, error: null }))
			.catch((err) => {
				if (err.name !== "AbortError")
					setState({ status: "error", buffer: null, error: err.message });
			});
		return () => ctrl.abort();
	}, [source, commit, repoPath, owner, repo, relativeFilePath, githubToken]);

	return state;
}

/**
 * 3D hologram view of the real board: every copper layer, mask, silkscreen, FR4 core
 * and component model from kicad-cli, stacked so layers can be exploded and inspected.
 */
export default function HoloViewer({ source }) {
	const mountRef = useRef(null);
	const sceneRef = useRef(null);
	const [which, setWhich] = useState("target");
	const commit = which === "base" ? source?.baseCommit : source?.targetCommit;
	const glb = useBoardGlb(source, commit);

	const [board, setBoard] = useState(null);
	const [parseError, setParseError] = useState(null);
	const [hover, setHover] = useState(null);
	const [hidden, setHidden] = useState({});
	const [solo, setSolo] = useState(null);
	const [explode, setExplode] = useState(1);
	const [spacing, setSpacing] = useState(1);
	const [glow, setGlow] = useState(0);
	const [style, setStyle] = useState("kicad");
	const [quality, setQuality] = useState("auto");
	const [res, setRes] = useState(0);
	const [bufferSize, setBufferSize] = useState("");
	const [orbit, setOrbit] = useState(true);
	const [sheetOpen, setSheetOpen] = useState(false);

	useEffect(() => {
		const s = createHoloScene(mountRef.current, { onHover: setHover });
		sceneRef.current = s;
		return () => {
			s.dispose();
			sceneRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (glb.status !== "ready" || !sceneRef.current) return;
		let alive = true;
		setParseError(null);
		sceneRef.current
			.loadGlb(glb.buffer)
			.then((info) => {
				if (!alive) return;
				setBoard(info);
				setHidden({});
				setSolo(null);
				setBufferSize(sceneRef.current.setResolution(res));
			})
			.catch((err) => alive && setParseError(err.message));
		return () => {
			alive = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [glb, res]);

	const s = sceneRef.current;
	// one step = one more layer lifted off the stack (top first) or set back down
	const gaps = Math.max(1, (board?.layers.length ?? 2) - 1);
	const stepLayer = (d) => {
		const v = Math.min(1, Math.max(0, Math.round(explode * gaps + d) / gaps));
		setExplode(v);
		s?.setExplode(v);
	};
	const toggleLayer = (key) => {
		const on = !!hidden[key];
		setHidden({ ...hidden, [key]: !on });
		s?.setLayerVisible(key, on);
	};
	const soloLayer = (key) => {
		const next = solo === key ? null : key;
		setSolo(next);
		s?.setSolo(next);
	};
	const changeStyle = (v) => {
		setStyle(v);
		s?.setStyle(v);
		const g = v === "holo" ? 1 : 0;
		setGlow(g);
		s?.setGlow(g);
	};
	const capture = async () => {
		const blob = await s?.capture(res || undefined);
		if (!blob) return;
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `${(source?.relativeFilePath || "board").split("/").pop().replace(".kicad_pcb", "")}-${which}-${style}.png`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 2000);
	};

	const status = (() => {
		if (!source)
			return {
				title: "No board loaded",
				text: "Load a .kicad_pcb diff from the Controls panel to see it as a 3D hologram.",
			};
		if (glb.status === "loading")
			return {
				title: "Building 3D model…",
				text: "kicad-cli is exporting every layer and component. The first export of a revision takes ~20 s; after that it is cached.",
				spin: true,
			};
		if (glb.status === "error")
			return { title: "3D export failed", text: glb.error };
		if (parseError)
			return { title: "Could not read 3D model", text: parseError };
		return null;
	})();

	return (
		<div className="holo-root">
			<div ref={mountRef} className="holo-canvas" />

			{status && (
				<div className="holo-status">
					{status.spin && <Spin />}
					<div className="holo-status-title">{status.title}</div>
					<div className="holo-status-text">{status.text}</div>
				</div>
			)}

			{hover && (
				<div
					className="holo-tip"
					style={{ left: hover.x + 14, top: hover.y + 10 }}
				>
					◢ {hover.ref}
				</div>
			)}

			{board && (
				<div className="holo-readout">
					{board.sizeMm[0].toFixed(1)} × {board.sizeMm[1].toFixed(1)} mm ·{" "}
					{board.layers.length} layers · {board.parts} parts
					{bufferSize && <> · render {bufferSize}</>}
				</div>
			)}

			<aside className={`holo-panel${sheetOpen ? " is-open" : ""}`}>
				<button
					type="button"
					className="holo-sheet-handle"
					onClick={() => setSheetOpen(!sheetOpen)}
				>
					<AppstoreOutlined /> Layers & view{" "}
					{sheetOpen ? <DownOutlined /> : <UpOutlined />}
				</button>

				<div className="holo-panel-body">
					{source && (
						<Segmented
							block
							size="small"
							value={which}
							onChange={setWhich}
							options={[
								{
									label: `Target ${String(source.targetCommit || "").slice(0, 7)}`,
									value: "target",
								},
								{
									label: `Base ${String(source.baseCommit || "").slice(0, 7)}`,
									value: "base",
								},
							]}
						/>
					)}

					<div className="holo-section-title">Layers</div>
					<div className="holo-layers">
						{(board?.layers ?? []).map((L) => (
							<div
								key={L.key}
								className={`holo-layer${solo === L.key ? " is-solo" : ""}${hidden[L.key] ? " is-off" : ""}`}
								onClick={() => soloLayer(L.key)}
							>
								<span
									className="holo-swatch"
									style={{ background: L.swatch }}
								/>
								<span className="holo-layer-name">{L.label}</span>
								<span className="holo-layer-z">
									{L.k > 0 ? "+" : ""}
									{L.k}
								</span>
								<button
									type="button"
									className="holo-eye"
									aria-label={`Toggle ${L.label}`}
									onClick={(e) => {
										e.stopPropagation();
										toggleLayer(L.key);
									}}
								>
									{hidden[L.key] ? <EyeInvisibleOutlined /> : <EyeOutlined />}
								</button>
							</div>
						))}
						{!board && (
							<div className="holo-empty">
								Layers appear once the board loads.
							</div>
						)}
					</div>

					<label className="holo-row">
						Explode
						<Slider
							min={0}
							max={1}
							step={0.01}
							value={explode}
							onChange={(v) => {
								setExplode(v);
								s?.setExplode(v);
							}}
						/>
					</label>
					<div className="holo-actions">
						<Button
							size="small"
							icon={<UpOutlined />}
							onClick={() => stepLayer(1)}
							disabled={!board || explode >= 1}
						>
							Lift layer
						</Button>
						<Button
							size="small"
							icon={<DownOutlined />}
							onClick={() => stepLayer(-1)}
							disabled={!board || explode <= 0}
						>
							Lower layer
						</Button>
					</div>
					<label className="holo-row">
						Spacing
						<Slider
							min={0.3}
							max={2.5}
							step={0.01}
							value={spacing}
							onChange={(v) => {
								setSpacing(v);
								s?.setSpacing(v);
							}}
						/>
					</label>
					<label className="holo-row">
						Glow
						<Slider
							min={0}
							max={style === "holo" ? 3 : 1.5}
							step={0.01}
							value={glow}
							onChange={(v) => {
								setGlow(v);
								s?.setGlow(v);
							}}
						/>
					</label>
					<label className="holo-row">
						Graphics
						<Select
							size="small"
							value={quality}
							options={QUALITIES}
							popupMatchSelectWidth={false}
							onChange={(v) => {
								setQuality(v);
								setBufferSize(s?.setQuality(v) || "");
							}}
						/>
					</label>
					<label className="holo-row">
						Resolution
						<Select
							size="small"
							value={res}
							options={RESOLUTIONS}
							popupMatchSelectWidth={false}
							onChange={(v) => {
								setRes(v);
								setBufferSize(s?.setResolution(v) || "");
							}}
						/>
					</label>

					<Segmented
						block
						size="small"
						value={style}
						onChange={changeStyle}
						options={[
							{ label: "KiCad metal", value: "kicad" },
							{ label: "Hologram", value: "holo" },
						]}
					/>

					<div className="holo-actions">
						<Tooltip title="Save a PNG at the selected resolution (16:9)">
							<Button
								size="small"
								icon={<CameraOutlined />}
								onClick={capture}
								disabled={!board}
							>
								Capture
							</Button>
						</Tooltip>
						<Button
							size="small"
							icon={<ScanOutlined />}
							onClick={() => s?.scan()}
							disabled={!board}
						>
							Scan
						</Button>
						<Button
							size="small"
							icon={<SyncOutlined spin={orbit} />}
							type={orbit ? "primary" : "default"}
							onClick={() => {
								setOrbit(!orbit);
								s?.setAutoRotate(!orbit);
							}}
						>
							Orbit
						</Button>
						<Button
							size="small"
							icon={<AimOutlined />}
							onClick={() => {
								s?.resetView();
								s?.showAll();
								setHidden({});
								setSolo(null);
							}}
						>
							Reset
						</Button>
					</div>
				</div>
			</aside>
		</div>
	);
}
