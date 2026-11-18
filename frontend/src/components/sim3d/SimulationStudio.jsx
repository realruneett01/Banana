import { Spin, Tooltip } from "antd";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { API_BASE_URL } from "../../config.js";
import BoardPreview from "../BoardPreview.jsx";
import Board3DScene from "./Board3DScene.jsx";
import StudioSidePanel from "./StudioSidePanel.jsx";
import { useCircuitSim } from "./useCircuitSim.js";

const HoloViewer = lazy(() => import("../holo/HoloViewer.jsx"));

// --- SIMULATION STUDIO PURE HELPERS START ---
export const STUDIO_VIEW_MODES = Object.freeze([
	{ mode: "3d", label: "3D" },
	{ mode: "2d", label: "2D" },
	{ mode: "holo", label: "HOLO", tooltip: "3D hologram of the current board" },
]);

export const VIEW_MODES = STUDIO_VIEW_MODES.map((m) => m.mode);

export function extractPcbTextFromFiles(files) {
	if (!files || typeof files !== "object") return null;
	const entry = Object.entries(files).find(([k]) => k.endsWith(".kicad_pcb"));
	return entry ? entry[1] : null;
}

async function exportViaApi(api, ir, board, signal) {
	const res = await api.editorExport(
		{ ir, board, title: ir?.name },
		{ signal },
	);
	if (!res?.ok || !res?.data?.files) {
		throw new Error(res?.error || "Failed to export PCB");
	}
	return res.data.files;
}

async function exportViaFetch(fetchImpl, baseUrl, payload, signal) {
	const res = await fetchImpl(`${baseUrl}/api/editor/export`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		signal,
		body: JSON.stringify(payload),
	});
	if (!res.ok) {
		throw new Error(`Export failed: ${res.statusText}`);
	}
	const data = await res.json();
	return data?.files;
}

export async function fetchCurrentPcbText({
	api,
	ir,
	board,
	signal,
	fetchImpl = fetch,
	baseUrl = API_BASE_URL,
}) {
	const files =
		typeof api?.editorExport === "function"
			? await exportViaApi(api, ir, board, signal)
			: await exportViaFetch(
					fetchImpl,
					baseUrl,
					{ ir, board, title: ir?.name },
					signal,
				);
	const text = extractPcbTextFromFiles(files);
	if (!text) throw new Error("No .kicad_pcb file in export");
	return text;
}
// --- SIMULATION STUDIO PURE HELPERS END ---

const STUDIO_CONTAINER_STYLE = Object.freeze({
	display: "flex",
	width: "100%",
	height: "100%",
	minHeight: "500px",
	background: "#0a0c14",
	overflow: "hidden",
});

const BOARD_VIEW_STYLE = Object.freeze({
	flex: 1,
	minWidth: "320px",
	height: "100%",
	display: "flex",
	flexDirection: "column",
	padding: "12px",
});

function getViewToggleBtnStyle(isActive) {
	return {
		padding: "4px 10px",
		fontSize: "12px",
		fontWeight: 600,
		borderRadius: "4px",
		border: "1px solid #28304c",
		background: isActive ? "rgba(56, 189, 248, 0.2)" : "#181d2f",
		color: isActive ? "#38bdf8" : "#94a3b8",
		cursor: "pointer",
	};
}

function ViewToggleButton({ mode, currentMode, onToggle, label, tooltip }) {
	const isActive = currentMode === mode;
	const text = label || mode.toUpperCase();
	const btn = (
		<button
			type="button"
			onClick={() => onToggle(mode)}
			aria-pressed={isActive}
			style={getViewToggleBtnStyle(isActive)}
		>
			{text}
		</button>
	);
	return tooltip ? <Tooltip title={tooltip}>{btn}</Tooltip> : btn;
}

function ViewToggle({ viewMode, onToggle }) {
	return (
		<div
			style={{
				display: "flex",
				gap: "4px",
				marginBottom: "8px",
				alignSelf: "flex-start",
			}}
		>
			{STUDIO_VIEW_MODES.map((item) => (
				<ViewToggleButton
					key={item.mode}
					mode={item.mode}
					label={item.label}
					tooltip={item.tooltip}
					currentMode={viewMode}
					onToggle={onToggle}
				/>
			))}
		</div>
	);
}

function useCurrentPcbText({ api, ir, board, enabled }) {
	const [state, setState] = useState({ pcbText: null, loading: false });

	useEffect(() => {
		if (!enabled) return;
		const ctrl = new AbortController();
		setState({ pcbText: null, loading: true });
		fetchCurrentPcbText({ api, ir, board, signal: ctrl.signal })
			.then((text) => setState({ pcbText: text, loading: false }))
			.catch((err) => {
				if (err.name !== "AbortError") {
					setState({ pcbText: null, loading: false });
				}
			});
		return () => ctrl.abort();
	}, [api, ir, board, enabled]);

	return state;
}

function StudioHoloView({ hasBoard, loading, pcbText }) {
	if (loading) {
		return (
			<div style={{ flex: 1, display: "grid", placeContent: "center" }}>
				<Spin />
			</div>
		);
	}
	const source = hasBoard && pcbText ? { pcbText } : null;
	return (
		<div style={{ flex: 1, minHeight: 0, position: "relative" }}>
			<Suspense fallback={<Spin />}>
				<HoloViewer source={source} />
			</Suspense>
		</div>
	);
}

function StudioBoardView({ api, ir, board, sim, highlightIds, env, onSelect }) {
	const [viewMode, setViewMode] = useState("3d");
	const hasBoard = Boolean(board || ir);
	const { pcbText, loading } = useCurrentPcbText({
		api,
		ir,
		board,
		enabled: viewMode === "holo" && hasBoard,
	});

	return (
		<div style={BOARD_VIEW_STYLE}>
			<ViewToggle viewMode={viewMode} onToggle={setViewMode} />
			{viewMode === "3d" && (
				<Board3DScene
					ir={ir}
					board={board}
					result={sim?.result}
					fault={sim?.selectedFault}
					playing={sim?.playing}
					speed={sim?.speed}
					highlightIds={highlightIds}
					env={env}
				/>
			)}
			{viewMode === "2d" && (
				<BoardPreview
					ir={ir}
					selectedId={highlightIds?.[0]}
					onSelect={onSelect}
				/>
			)}
			{viewMode === "holo" && (
				<StudioHoloView
					hasBoard={hasBoard}
					loading={loading}
					pcbText={pcbText}
				/>
			)}
		</div>
	);
}

function resolveHighlightIds({
	selectedPartId,
	selectedCard,
	tourHighlightIds,
}) {
	if (tourHighlightIds && tourHighlightIds.length > 0) {
		return tourHighlightIds;
	}
	if (selectedPartId) {
		return [selectedPartId];
	}
	if (selectedCard) {
		const id = selectedCard.partIds?.[0] || selectedCard.netIds?.[0];
		return id ? [id] : [];
	}
	return [];
}

function useHighlightSelection(selectedPartId, selectedCard) {
	const [tourIds, setTourIds] = useState([]);
	const highlightIds = useMemo(
		() =>
			resolveHighlightIds({
				selectedPartId,
				selectedCard,
				tourHighlightIds: tourIds,
			}),
		[selectedPartId, selectedCard, tourIds],
	);
	return { setTourIds, highlightIds };
}

function useStudioSelection() {
	const [selectedCard, setSelectedCard] = useState(null);
	const [selectedPartId, setSelectedPartId] = useState(null);
	const { setTourIds, highlightIds } = useHighlightSelection(
		selectedPartId,
		selectedCard,
	);

	const onSelectCard = useCallback(
		(card) => {
			setSelectedCard((prev) => (prev?.id === card?.id ? null : card));
			setSelectedPartId(null);
			setTourIds([]);
		},
		[setTourIds],
	);

	const onHighlight = useCallback(
		(ids) => {
			setTourIds(ids || []);
			setSelectedCard(null);
			setSelectedPartId(null);
		},
		[setTourIds],
	);

	return {
		selectedCardId: selectedCard?.id,
		highlightIds,
		onSelectPart: setSelectedPartId,
		onSelectCard,
		onHighlight,
	};
}

function useEditorSync(ir) {
	useEffect(() => {
		if (ir?.parts?.length || typeof document === "undefined") return;
		const saveBtn = document.querySelector("button[aria-label='Save']");
		if (saveBtn && !saveBtn.disabled) {
			saveBtn.click();
		}
	}, [ir]);
}

export default function SimulationStudio({ api, ir, board, onApplyFix }) {
	useEditorSync(ir);
	const sim = useCircuitSim({ api, ir });
	const [env, setEnv] = useState(null);
	const sel = useStudioSelection();

	return (
		<div style={STUDIO_CONTAINER_STYLE}>
			<StudioBoardView
				api={api}
				ir={ir}
				board={board}
				sim={sim}
				highlightIds={sel.highlightIds}
				env={env}
				onSelect={sel.onSelectPart}
			/>
			<StudioSidePanel
				api={api}
				ir={ir}
				sim={sim}
				selectedCardId={sel.selectedCardId}
				onSelectCard={sel.onSelectCard}
				onApplyFix={onApplyFix}
				env={env}
				onSelectEnv={setEnv}
				onHighlight={sel.onHighlight}
			/>
		</div>
	);
}
