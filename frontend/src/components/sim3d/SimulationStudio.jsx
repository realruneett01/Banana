import { useCallback, useEffect, useMemo, useState } from "react";
import BoardPreview from "../BoardPreview.jsx";
import Board3DScene from "./Board3DScene.jsx";
import StudioSidePanel from "./StudioSidePanel.jsx";
import { useCircuitSim } from "./useCircuitSim.js";

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

function ViewToggleButton({ mode, currentMode, onToggle }) {
	const isActive = currentMode === mode;
	return (
		<button
			type="button"
			onClick={() => onToggle(mode)}
			aria-pressed={isActive}
			style={getViewToggleBtnStyle(isActive)}
		>
			{mode.toUpperCase()}
		</button>
	);
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
			<ViewToggleButton mode="3d" currentMode={viewMode} onToggle={onToggle} />
			<ViewToggleButton mode="2d" currentMode={viewMode} onToggle={onToggle} />
		</div>
	);
}

function StudioBoardView({ ir, board, sim, highlightIds, env, onSelect }) {
	const [viewMode, setViewMode] = useState("3d");
	return (
		<div style={BOARD_VIEW_STYLE}>
			<ViewToggle viewMode={viewMode} onToggle={setViewMode} />
			{viewMode === "3d" ? (
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
			) : (
				<BoardPreview
					ir={ir}
					selectedId={highlightIds?.[0]}
					onSelect={onSelect}
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
