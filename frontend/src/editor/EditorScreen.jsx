import {
	DeleteOutlined,
	DownloadOutlined,
	ForkOutlined,
	PlusOutlined,
	RedoOutlined,
	RotateRightOutlined,
	SaveOutlined,
	SwapOutlined,
	UndoOutlined,
} from "@ant-design/icons";
import { Button, Space, Tabs, Tooltip } from "antd";
import { useCallback, useEffect, useState } from "react";
import IssuesPanel from "../components/IssuesPanel.jsx";
import LibraryBrowser from "./LibraryBrowser.jsx";
import PcbCanvas from "./PcbCanvas.jsx";
import PropertiesPanel from "./PropertiesPanel.jsx";
import SchematicCanvas from "./SchematicCanvas.jsx";
import { useEditorDocument } from "./useEditorDocument.js";
import { useLiveChecks } from "./useLiveChecks.js";

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

const PROBLEMS_PANEL_STYLE = Object.freeze({
	height: "200px",
	width: "100%",
	borderTop: "1px solid #232836",
	background: "#0f121d",
	flexShrink: 0,
	display: "flex",
	flexDirection: "column",
});

const PROBLEM_BADGE_STYLE = Object.freeze({
	background: "transparent",
	border: "none",
	cursor: "pointer",
	display: "flex",
	alignItems: "center",
	gap: "6px",
	fontSize: "12px",
	padding: "2px 6px",
	borderRadius: "4px",
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

function ProblemBadge({ problems }) {
	const { count = 0, open = false, toggle } = problems ?? {};
	const text = `${count} ${count === 1 ? "problem" : "problems"}`;
	const dotColor = count > 0 ? "#fb7185" : "#34d399";
	const textColor = count > 0 ? "#fb7185" : "#8a91a3";
	return (
		<button
			type="button"
			onClick={toggle}
			aria-expanded={open}
			aria-label={`Toggle problems (${text})`}
			style={{ ...PROBLEM_BADGE_STYLE, color: textColor }}
		>
			<span style={{ color: dotColor }}>●</span>
			<span>{text}</span>
		</button>
	);
}

function StatusBar({ doc, activeTab, dirty, problems }) {
	const gridText = activeTab === "pcb" ? "Grid: 0.25 mm" : "Grid: 1.27 mm";
	const dirtyText = dirty ? "Unsaved changes" : "Saved";
	const dirtyColor = dirty ? "#fbbf24" : "#34d399";
	return (
		<footer role="status" aria-label="Editor status" style={STATUS_BAR_STYLE}>
			<span style={{ color: "#8a91a3" }}>{formatSelection(doc)}</span>
			<div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
				{problems && <ProblemBadge problems={problems} />}
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

function AddPartButton({ onAddPart }) {
	return (
		<Tooltip title="Add part (A)">
			<Button
				icon={<PlusOutlined />}
				onClick={onAddPart}
				size="small"
				aria-label="Add part (A)"
			>
				Add part
			</Button>
		</Tooltip>
	);
}

function ExportButton({ onExport, loading }) {
	return (
		<Tooltip title="Export KiCad files">
			<Button
				icon={<DownloadOutlined />}
				loading={loading}
				onClick={onExport}
				size="small"
				aria-label="Export KiCad files"
			>
				Export KiCad files
			</Button>
		</Tooltip>
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
			<AddPartButton onAddPart={actions.openLibrary} />
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
			<ExportButton onExport={actions.exportKiCad} loading={state.exporting} />
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

function useAddPartShortcut(openLibrary) {
	useEffect(() => {
		const onKeyDown = (e) => {
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			if (e.key !== "a" && e.key !== "A") return;
			const tag = e.target?.tagName;
			if (
				tag === "INPUT" ||
				tag === "TEXTAREA" ||
				e.target?.isContentEditable
			) {
				return;
			}
			e.preventDefault();
			openLibrary();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [openLibrary]);
}

function useLibraryState() {
	const [libraryOpen, setLibraryOpen] = useState(false);
	const openLibrary = useCallback(() => setLibraryOpen(true), []);
	const closeLibrary = useCallback(() => setLibraryOpen(false), []);
	useAddPartShortcut(openLibrary);
	return { libraryOpen, openLibrary, closeLibrary };
}

function downloadFile(filename, text) {
	const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

function downloadFiles(files) {
	if (!files || typeof files !== "object") return;
	for (const [name, content] of Object.entries(files)) {
		downloadFile(name, content);
	}
}

function useExportAction({ api, ir, board }) {
	const [exporting, setExporting] = useState(false);
	const exportKiCad = useCallback(async () => {
		if (typeof api?.editorExport !== "function") return;
		setExporting(true);
		try {
			const res = await api.editorExport({ ir, board, title: ir?.name });
			if (res?.ok && res.data?.files) {
				downloadFiles(res.data.files);
			}
		} finally {
			setExporting(false);
		}
	}, [api, ir, board]);
	return { exportKiCad, exporting };
}

function getNextRef(parts, rawPrefix) {
	const prefix = (rawPrefix || "U").replace(/[?#]+$/, "") || "U";
	const usedNumbers = new Set();
	const regex = new RegExp(`^${prefix}(\\d+)$`, "i");
	for (const p of parts ?? []) {
		const match = p.ref?.match(regex);
		if (match) {
			usedNumbers.add(Number(match[1]));
		}
	}
	let nextNum = 1;
	while (usedNumbers.has(nextNum)) {
		nextNum++;
	}
	return `${prefix}${nextNum}`;
}

function useCanvasFetchers(api) {
	const fetchSymbol = useCallback(
		async (libId) => {
			if (typeof api?.getSymbol !== "function") return null;
			const res = await api.getSymbol(libId);
			return res.ok ? (res.data?.symbol ?? null) : null;
		},
		[api],
	);

	const fetchFootprint = useCallback(
		async (libId) => {
			if (typeof api?.getFootprint !== "function") return null;
			const res = await api.getFootprint(libId);
			return res.ok ? (res.data?.footprint ?? null) : null;
		},
		[api],
	);

	return { fetchSymbol, fetchFootprint };
}

function usePlacePartCallback(doc, dispatch) {
	return useCallback(
		(item) => {
			const prefix = item.ref || item.prefix || "U";
			const nextRef = getNextRef(doc.ir?.parts, prefix);
			dispatch({
				type: "addPart",
				part: {
					ref: nextRef,
					value: item.value || "",
					symbol: item.symbol || "",
					footprint: item.footprint || "",
					placement: { x: 0, y: 0, rot: 0, side: "F" },
				},
			});
		},
		[doc.ir?.parts, dispatch],
	);
}

function useIssueSelector(dispatch) {
	return useCallback(
		(itemId, issue) => {
			const targetId = itemId ?? issue?.itemIds?.[0];
			if (targetId) {
				dispatch({ type: "select", ids: [targetId] });
			}
		},
		[dispatch],
	);
}

function triggerPcbRoute() {
	const btn = document.querySelector('[aria-label="Toggle route track (X)"]');
	if (btn) btn.click();
}

function CanvasTab({ visible, children }) {
	return (
		<div
			style={{
				display: visible ? "block" : "none",
				width: "100%",
				height: "100%",
			}}
		>
			{children}
		</div>
	);
}

function CanvasViewport({ activeTab, docState, curBoard, fetchers, markers }) {
	return (
		<div style={CANVAS_WRAPPER_STYLE}>
			<CanvasTab visible={activeTab === "schematic"}>
				<SchematicCanvas
					editor={docState.editor}
					fetchSymbol={fetchers.fetchSymbol}
					markers={markers}
				/>
			</CanvasTab>
			<CanvasTab visible={activeTab === "pcb"}>
				<PcbCanvas
					editor={docState.editor}
					board={curBoard}
					onBoardChange={docState.setBoard}
					fetchFootprint={fetchers.fetchFootprint}
					markers={markers}
				/>
			</CanvasTab>
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

function buildToolState(docState, activeTab, exporting) {
	return {
		canUndo: docState.canUndo,
		canRedo: docState.canRedo,
		hasSelection: (docState.doc.selection?.length ?? 0) > 0,
		activeTab,
		dirty: docState.dirty,
		exporting,
	};
}

function EditorBody({ activeTab, docState, curBoard, fetchers, markers }) {
	return (
		<div style={CONTENT_ROW_STYLE}>
			<CanvasViewport
				activeTab={activeTab}
				docState={docState}
				curBoard={curBoard}
				fetchers={fetchers}
				markers={markers}
			/>
			<PropertiesPanel doc={docState.doc} dispatch={docState.dispatch} />
		</div>
	);
}

function useScreenActions(docState, onSave, extra) {
	const { doc, board, dispatch, undo, redo, markSaved } = docState;
	const editActions = useEditorActions({
		doc,
		dispatch,
		board,
		onSave,
		markSaved,
	});
	useSaveShortcut(editActions.save);
	return { ...editActions, undo, redo, route: triggerPcbRoute, ...extra };
}

function useScreenController({ ir, board, onSave, api }) {
	const docState = useEditorDocument({ ir, board });
	const lib = useLibraryState();
	const fetchers = useCanvasFetchers(api);
	const { doc, board: curBoard, dispatch } = docState;
	const onPlace = usePlacePartCallback(doc, dispatch);
	const onSelectIssue = useIssueSelector(dispatch);
	const exp = useExportAction({ api, ir: doc.ir, board: curBoard });
	const liveChecks = useLiveChecks({ api, ir: doc.ir, board: curBoard });
	const actions = useScreenActions(docState, onSave, {
		openLibrary: lib.openLibrary,
		exportKiCad: exp.exportKiCad,
	});
	return {
		docState,
		curBoard,
		fetchers,
		lib,
		onPlace,
		onSelectIssue,
		actions,
		exporting: exp.exporting,
		liveChecks,
	};
}

function EditorPanels({ problemsOpen, ctrl, api }) {
	return (
		<>
			{problemsOpen && (
				<section style={PROBLEMS_PANEL_STYLE} aria-label="Problems panel">
					<IssuesPanel
						issues={ctrl.liveChecks.issues}
						onSelectItem={ctrl.onSelectIssue}
					/>
				</section>
			)}
			<LibraryBrowser
				api={api}
				open={ctrl.lib.libraryOpen}
				onClose={ctrl.lib.closeLibrary}
				onPlace={ctrl.onPlace}
			/>
		</>
	);
}

function EditorMainContent({ ctrl, activeTab, toolState, onTabChange }) {
	return (
		<>
			<EditorHeader
				activeTab={activeTab}
				onTabChange={onTabChange}
				toolState={toolState}
				actions={ctrl.actions}
			/>
			<EditorBody
				activeTab={activeTab}
				docState={ctrl.docState}
				curBoard={ctrl.curBoard}
				fetchers={ctrl.fetchers}
				markers={ctrl.liveChecks.markers}
			/>
		</>
	);
}

export default function EditorScreen({ ir, board, onSave, api }) {
	const [activeTab, setActiveTab] = useState("schematic");
	const [problemsOpen, setProblemsOpen] = useState(false);
	const toggle = useCallback(() => setProblemsOpen((p) => !p), []);
	const ctrl = useScreenController({ ir, board, onSave, api });
	const toolState = buildToolState(ctrl.docState, activeTab, ctrl.exporting);
	const problems = {
		count: ctrl.liveChecks.issues.length,
		open: problemsOpen,
		toggle,
	};

	return (
		<main style={ROOT_STYLE} aria-label="Editor screen">
			<EditorMainContent
				ctrl={ctrl}
				activeTab={activeTab}
				toolState={toolState}
				onTabChange={setActiveTab}
			/>
			<EditorPanels problemsOpen={problemsOpen} ctrl={ctrl} api={api} />
			<StatusBar
				doc={ctrl.docState.doc}
				activeTab={activeTab}
				dirty={ctrl.docState.dirty}
				problems={problems}
			/>
		</main>
	);
}
