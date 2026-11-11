import {
	DeleteOutlined,
	ForkOutlined,
	RedoOutlined,
	RotateRightOutlined,
	SaveOutlined,
	SwapOutlined,
	UndoOutlined,
} from "@ant-design/icons";
import { Button, Space, Tabs, Tooltip } from "antd";
import { useCallback, useEffect, useState } from "react";
import PcbCanvas from "./PcbCanvas.jsx";
import PropertiesPanel from "./PropertiesPanel.jsx";
import SchematicCanvas from "./SchematicCanvas.jsx";
import { useEditorDocument } from "./useEditorDocument.js";

const ROOT_STYLE = Object.freeze({
	display: "flex",
	flexDirection: "column",
	width: "100%",
	height: "100%",
	background: "#0b0d12",
	color: "#e6e8ee",
	overflow: "hidden",
});

const HEADER_STYLE = Object.freeze({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: "0 12px",
	background: "#12151c",
	borderBottom: "1px solid #232836",
	minHeight: "44px",
});

const TOOLBAR_CONTAINER_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	gap: "8px",
});

const CONTENT_ROW_STYLE = Object.freeze({
	display: "flex",
	flex: 1,
	minHeight: 0,
	overflow: "hidden",
});

const CANVAS_WRAPPER_STYLE = Object.freeze({
	flex: 1,
	minWidth: 0,
	height: "100%",
	position: "relative",
	padding: "8px",
});

const STATUS_BAR_STYLE = Object.freeze({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: "4px 12px",
	background: "#12151c",
	borderTop: "1px solid #232836",
	fontSize: "12px",
	minHeight: "28px",
});

const TAB_ITEMS = [
	{ key: "schematic", label: "Schematic" },
	{ key: "pcb", label: "PCB" },
];

function formatSelection(doc) {
	const sel = doc?.selection;
	if (!sel || sel.length === 0) return "No selection";
	if (sel.length > 1) return `${sel.length} items selected`;
	const part = doc.ir?.parts?.find((p) => p.id === sel[0]);
	return part ? `Selected: ${part.ref || part.id}` : `Selected: ${sel[0]}`;
}

function StatusBar({ doc, activeTab, dirty }) {
	const gridText = activeTab === "pcb" ? "Grid: 0.25 mm" : "Grid: 1.27 mm";
	const dirtyText = dirty ? "Unsaved changes" : "Saved";
	const dirtyColor = dirty ? "#fbbf24" : "#34d399";
	return (
		<footer role="status" aria-label="Editor status" style={STATUS_BAR_STYLE}>
			<span style={{ color: "#8a91a3" }}>{formatSelection(doc)}</span>
			<div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
				<span style={{ color: dirtyColor }}>● {dirtyText}</span>
				<span style={{ color: "#5d6476" }}>{gridText}</span>
			</div>
		</footer>
	);
}

function HistoryButtons({ canUndo, canRedo, undo, redo }) {
	return (
		<Space size={4}>
			<Tooltip title="Undo (Ctrl+Z)">
				<Button
					icon={<UndoOutlined />}
					disabled={!canUndo}
					onClick={undo}
					size="small"
					aria-label="Undo"
				/>
			</Tooltip>
			<Tooltip title="Redo (Ctrl+Y)">
				<Button
					icon={<RedoOutlined />}
					disabled={!canRedo}
					onClick={redo}
					size="small"
					aria-label="Redo"
				/>
			</Tooltip>
		</Space>
	);
}

function TransformButtons({ hasSelection, rotate, flip }) {
	return (
		<>
			<Tooltip title="Rotate 90° (R)">
				<Button
					icon={<RotateRightOutlined />}
					disabled={!hasSelection}
					onClick={rotate}
					size="small"
					aria-label="Rotate"
				/>
			</Tooltip>
			<Tooltip title="Flip Side (F)">
				<Button
					icon={<SwapOutlined />}
					disabled={!hasSelection}
					onClick={flip}
					size="small"
					aria-label="Flip"
				/>
			</Tooltip>
		</>
	);
}

function DeleteButton({ hasSelection, remove }) {
	return (
		<Tooltip title="Delete (Del)">
			<Button
				danger
				icon={<DeleteOutlined />}
				disabled={!hasSelection}
				onClick={remove}
				size="small"
				aria-label="Delete"
			/>
		</Tooltip>
	);
}

function EditActionButtons({ hasSelection, rotate, flip, remove }) {
	return (
		<Space size={4}>
			<TransformButtons
				hasSelection={hasSelection}
				rotate={rotate}
				flip={flip}
			/>
			<DeleteButton hasSelection={hasSelection} remove={remove} />
		</Space>
	);
}

function ModeButtons({ activeTab, dirty, route, save }) {
	return (
		<Space size={4}>
			<Tooltip title="Route Track (X) - PCB tab">
				<Button
					icon={<ForkOutlined />}
					disabled={activeTab !== "pcb"}
					onClick={route}
					size="small"
					aria-label="Route Track"
				/>
			</Tooltip>
			<Tooltip title="Save (Ctrl+S)">
				<Button
					type="primary"
					icon={<SaveOutlined />}
					disabled={!dirty}
					onClick={save}
					size="small"
					aria-label="Save"
				/>
			</Tooltip>
		</Space>
	);
}

function EditorToolbar({ state, actions }) {
	return (
		<div
			style={TOOLBAR_CONTAINER_STYLE}
			role="toolbar"
			aria-label="Editor tools"
		>
			<HistoryButtons
				canUndo={state.canUndo}
				canRedo={state.canRedo}
				undo={actions.undo}
				redo={actions.redo}
			/>
			<EditActionButtons
				hasSelection={state.hasSelection}
				rotate={actions.rotate}
				flip={actions.flip}
				remove={actions.remove}
			/>
			<ModeButtons
				activeTab={state.activeTab}
				dirty={state.dirty}
				route={actions.route}
				save={actions.save}
			/>
		</div>
	);
}

function useEditorActions({ doc, dispatch, board, onSave, markSaved }) {
	const rotate = useCallback(() => {
		for (const id of doc?.selection ?? []) {
			dispatch({ type: "rotatePart", partId: id, deltaDeg: 90 });
		}
	}, [doc?.selection, dispatch]);

	const flip = useCallback(() => {
		for (const id of doc?.selection ?? []) {
			dispatch({ type: "flipPart", partId: id });
		}
	}, [doc?.selection, dispatch]);

	const remove = useCallback(() => {
		for (const id of doc?.selection ?? []) {
			dispatch({ type: "deletePart", partId: id });
		}
	}, [doc?.selection, dispatch]);

	const save = useCallback(() => {
		onSave?.({ ir: doc.ir, board });
		markSaved();
	}, [doc.ir, board, onSave, markSaved]);

	return { rotate, flip, remove, save };
}

function useSaveShortcut(save) {
	useEffect(() => {
		const onKeyDown = (e) => {
			if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
				e.preventDefault();
				save();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [save]);
}

function triggerPcbRoute() {
	const btn = document.querySelector('[aria-label="Toggle route track (X)"]');
	if (btn) btn.click();
}

function CanvasViewport({ activeTab, editor, board, setBoard }) {
	return (
		<div style={CANVAS_WRAPPER_STYLE}>
			<div
				style={{
					display: activeTab === "schematic" ? "block" : "none",
					width: "100%",
					height: "100%",
				}}
			>
				<SchematicCanvas editor={editor} />
			</div>
			<div
				style={{
					display: activeTab === "pcb" ? "block" : "none",
					width: "100%",
					height: "100%",
				}}
			>
				<PcbCanvas editor={editor} board={board} onBoardChange={setBoard} />
			</div>
		</div>
	);
}

function EditorHeader({ activeTab, onTabChange, toolState, actions }) {
	return (
		<header style={HEADER_STYLE}>
			<Tabs
				activeKey={activeTab}
				onChange={onTabChange}
				items={TAB_ITEMS}
				style={{ marginBottom: 0 }}
				aria-label="Editor views"
			/>
			<EditorToolbar state={toolState} actions={actions} />
		</header>
	);
}

function buildToolState(docState, activeTab) {
	return {
		canUndo: docState.canUndo,
		canRedo: docState.canRedo,
		hasSelection: (docState.doc.selection?.length ?? 0) > 0,
		activeTab,
		dirty: docState.dirty,
	};
}

function EditorBody({ activeTab, docState, curBoard }) {
	return (
		<div style={CONTENT_ROW_STYLE}>
			<CanvasViewport
				activeTab={activeTab}
				editor={docState.editor}
				board={curBoard}
				setBoard={docState.setBoard}
			/>
			<PropertiesPanel doc={docState.doc} dispatch={docState.dispatch} />
		</div>
	);
}

function useScreenController({ ir, board, onSave }) {
	const docState = useEditorDocument({ ir, board });
	const { doc, board: curBoard, dispatch, undo, redo } = docState;
	const { rotate, flip, remove, save } = useEditorActions({
		doc,
		dispatch,
		board: curBoard,
		onSave,
		markSaved: docState.markSaved,
	});
	useSaveShortcut(save);
	return {
		docState,
		curBoard,
		actions: { undo, redo, rotate, flip, remove, route: triggerPcbRoute, save },
	};
}

export default function EditorScreen({ ir, board, onSave }) {
	const [activeTab, setActiveTab] = useState("schematic");
	const { docState, curBoard, actions } = useScreenController({
		ir,
		board,
		onSave,
	});
	const toolState = buildToolState(docState, activeTab);

	return (
		<main style={ROOT_STYLE} aria-label="Editor screen">
			<EditorHeader
				activeTab={activeTab}
				onTabChange={setActiveTab}
				toolState={toolState}
				actions={actions}
			/>
			<EditorBody
				activeTab={activeTab}
				docState={docState}
				curBoard={curBoard}
			/>
			<StatusBar
				doc={docState.doc}
				activeTab={activeTab}
				dirty={docState.dirty}
			/>
		</main>
	);
}
