import {
	DeleteOutlined,
	DownloadOutlined,
	DownOutlined,
	LeftOutlined,
	PlusOutlined,
	RedoOutlined,
	RightOutlined,
	RotateRightOutlined,
	SaveOutlined,
	SwapOutlined,
	UndoOutlined,
} from "@ant-design/icons";
import {
	App as AntApp,
	Button,
	Dropdown,
	Modal,
	message,
	Radio,
	Select,
	Space,
	Tabs,
	Tooltip,
} from "antd";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import IssuesPanel from "../components/IssuesPanel.jsx";
import { emitCommitCreated } from "../designEvents.js";
import { annotate } from "./annotate.js";
import BoardTools from "./BoardTools.jsx";
import {
	get,
	setCursor,
	setGrid,
	setOrigin,
	setUnits,
	subscribe,
} from "./editorStatus.js";
import { emitEditorTool } from "./editorToolBus.js";
import { summarizeWarnings } from "./exportWarnings.js";
import LibraryBrowser from "./LibraryBrowser.jsx";
import PcbCanvas from "./PcbCanvas.jsx";
import PropertiesPanel from "./PropertiesPanel.jsx";
import SaveCommitDialog from "./SaveCommitDialog.jsx";
import SchematicCanvas from "./SchematicCanvas.jsx";
import ToolPalette from "./ToolPalette.jsx";
import { useEditorDocument } from "./useEditorDocument.js";
import { useLiveChecks } from "./useLiveChecks.js";
import { formatCoord, GRID_PRESETS } from "./viewport.js";

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
	padding: "0 8px",
	background: "#12151c",
	borderBottom: "1px solid #232836",
	minHeight: "44px",
	gap: "8px",
});

const TOOLBAR_CONTAINER_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	gap: "4px",
	flexWrap: "nowrap",
});

const PANEL_TOGGLE_STYLE = Object.freeze({
	position: "absolute",
	top: "12px",
	right: "12px",
	zIndex: 20,
	background: "#181c25",
	borderColor: "#232836",
	color: "#8a91a3",
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

const UNIT_CYCLE = Object.freeze(["mm", "mil", "in"]);

const UNIT_BUTTON_STYLE = Object.freeze({
	background: "transparent",
	border: "none",
	color: "#8a91a3",
	cursor: "pointer",
	padding: 0,
	font: "inherit",
	fontSize: "inherit",
});

const STATUS_COORDS_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	gap: "4px",
	color: "#8a91a3",
});

function nextUnit(current) {
	const idx = UNIT_CYCLE.indexOf(current);
	return UNIT_CYCLE[(idx + 1) % UNIT_CYCLE.length] ?? "mm";
}

function useTabGridSync(activeTab) {
	useEffect(() => {
		setGrid(activeTab === "pcb" ? 0.25 : 1.27);
	}, [activeTab]);
}

function GridSelect({ activeTab, grid, units, onGridChange }) {
	const presets = GRID_PRESETS[activeTab] ?? GRID_PRESETS.schematic;
	const baseOptions = presets.map((g) => ({
		value: g,
		label: formatCoord(g, units),
	}));
	const options = presets.includes(grid)
		? baseOptions
		: [{ value: grid, label: formatCoord(grid, units) }, ...baseOptions];
	return (
		<Select
			size="small"
			style={{ minWidth: 75 }}
			value={grid}
			onChange={onGridChange}
			options={options}
			aria-label="Grid"
		/>
	);
}

function UnitsButton({ units, onCycle }) {
	return (
		<button
			type="button"
			onClick={onCycle}
			style={UNIT_BUTTON_STYLE}
			aria-label={`Current units: ${units}. Click to cycle.`}
		>
			{units}
		</button>
	);
}

function StatusBarSection({ status, activeTab }) {
	const xStr = formatCoord(status.x ?? 0, status.units);
	const yStr = formatCoord(status.y ?? 0, status.units);
	const dxStr = formatCoord(status.dx ?? 0, status.units);
	const dyStr = formatCoord(status.dy ?? 0, status.units);
	const zoomStr = Number((status.zoom ?? 1).toFixed(2));
	const handleCycle = () => setUnits(nextUnit(status.units));
	return (
		<div style={STATUS_COORDS_STYLE}>
			<span>{`X ${xStr} Y ${yStr} | dx ${dxStr} dy ${dyStr} | Z ${zoomStr} | Grid `}</span>
			<GridSelect
				activeTab={activeTab}
				grid={status.grid}
				units={status.units}
				onGridChange={setGrid}
			/>
			<span>{" | "}</span>
			<UnitsButton units={status.units} onCycle={handleCycle} />
		</div>
	);
}

function StatusBar({ doc, activeTab, dirty, problems }) {
	const status = useSyncExternalStore(subscribe, get);
	useOriginShortcut();
	useTabGridSync(activeTab);
	const dirtyText = dirty ? "Unsaved changes" : "Saved";
	const dirtyColor = dirty ? "#fbbf24" : "#34d399";
	return (
		<footer role="status" aria-label="Editor status" style={STATUS_BAR_STYLE}>
			<span style={{ color: "#8a91a3" }}>{formatSelection(doc)}</span>
			<div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
				{problems && <ProblemBadge problems={problems} />}
				<span style={{ color: dirtyColor }}>● {dirtyText}</span>
				<StatusBarSection status={status} activeTab={activeTab} />
			</div>
		</footer>
	);
}

function ToolButton({
	title,
	icon,
	disabled,
	onClick,
	ariaLabel,
	type,
	danger,
	loading,
	text,
}) {
	return (
		<Tooltip title={title}>
			<Button
				icon={icon}
				disabled={disabled}
				onClick={onClick}
				size="small"
				aria-label={ariaLabel || title}
				type={type}
				danger={danger}
				loading={loading}
			>
				{text}
			</Button>
		</Tooltip>
	);
}

function HistoryButtons({ canUndo, canRedo, undo, redo }) {
	const items = [
		{
			title: "Undo (Ctrl+Z)",
			icon: <UndoOutlined />,
			disabled: !canUndo,
			onClick: undo,
			ariaLabel: "Undo",
		},
		{
			title: "Redo (Ctrl+Y)",
			icon: <RedoOutlined />,
			disabled: !canRedo,
			onClick: redo,
			ariaLabel: "Redo",
		},
	];
	return (
		<Space size={4}>
			{items.map((it) => (
				<ToolButton key={it.title} {...it} />
			))}
		</Space>
	);
}

function TransformButtons({ hasSelection, rotate, flip }) {
	const items = [
		{
			title: "Rotate 90° (R)",
			icon: <RotateRightOutlined />,
			disabled: !hasSelection,
			onClick: rotate,
			ariaLabel: "Rotate",
		},
		{
			title: "Flip Side (F)",
			icon: <SwapOutlined />,
			disabled: !hasSelection,
			onClick: flip,
			ariaLabel: "Flip",
		},
	];
	return (
		<>
			{items.map((it) => (
				<ToolButton key={it.title} {...it} />
			))}
		</>
	);
}

function DeleteButton({ hasSelection, remove }) {
	return (
		<ToolButton
			title="Delete (Del)"
			icon={<DeleteOutlined />}
			disabled={!hasSelection}
			onClick={remove}
			ariaLabel="Delete"
			danger
		/>
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

function SaveCommitButton({ dirty, onOpen }) {
	return (
		<ToolButton
			title="Save and commit"
			icon={<SaveOutlined />}
			disabled={!dirty}
			onClick={onOpen}
			ariaLabel="Save and commit"
			text="Save and commit"
		/>
	);
}

function ModeButtons({ dirty, save, openCommit }) {
	return (
		<Space size={4}>
			<ToolButton
				title="Save (Ctrl+S)"
				icon={<SaveOutlined />}
				disabled={!dirty}
				onClick={save}
				ariaLabel="Save"
				type="primary"
			/>
			<SaveCommitButton dirty={dirty} onOpen={openCommit} />
		</Space>
	);
}

function AddPartButton({ onAddPart }) {
	return (
		<ToolButton
			title="Add part (A)"
			icon={<PlusOutlined />}
			onClick={onAddPart}
			ariaLabel="Add part (A)"
			text="Add part"
		/>
	);
}

function buildExportItems(state) {
	return [
		{ key: "kicad", label: "KiCad files", disabled: state.exporting },
		{ key: "bom", label: "BOM", disabled: state.bomLoading },
		{ key: "netlist", label: "Netlist", disabled: state.netlistLoading },
	];
}

function runExportAction(key, actions) {
	if (key === "kicad") actions.exportKiCad?.();
	if (key === "bom") actions.exportBom?.();
	if (key === "netlist") actions.exportNetlist?.();
}

function ExportDropdown({ state, actions }) {
	const isExporting = Boolean(
		state.exporting || state.bomLoading || state.netlistLoading,
	);
	const items = buildExportItems(state);
	const onMenuClick = ({ key }) => runExportAction(key, actions);
	return (
		<Dropdown menu={{ items, onClick: onMenuClick }} disabled={isExporting}>
			<Tooltip title="Export design files">
				<Button
					icon={<DownloadOutlined />}
					size="small"
					loading={isExporting}
					aria-label="Export"
				>
					Export <DownOutlined />
				</Button>
			</Tooltip>
		</Dropdown>
	);
}

const ANNOTATE_LABEL_STYLE = Object.freeze({
	fontSize: 12,
	marginBottom: 4,
	color: "#8a91a3",
});

const ANNOTATE_BODY_STYLE = Object.freeze({
	display: "flex",
	flexDirection: "column",
	gap: 12,
	padding: "8px 0",
});

function AnnotateModeSelect({ mode, onChange }) {
	return (
		<div>
			<div style={ANNOTATE_LABEL_STYLE}>Mode</div>
			<Radio.Group
				value={mode}
				onChange={(e) => onChange(e.target.value)}
				size="small"
			>
				<Radio value="keep">Keep</Radio>
				<Radio value="reset">Reset</Radio>
			</Radio.Group>
		</div>
	);
}

function AnnotateOrderSelect({ order, onChange }) {
	return (
		<div>
			<div style={ANNOTATE_LABEL_STYLE}>Order</div>
			<Radio.Group
				value={order}
				onChange={(e) => onChange(e.target.value)}
				size="small"
			>
				<Radio value="x">X</Radio>
				<Radio value="y">Y</Radio>
			</Radio.Group>
		</div>
	);
}

function AnnotateModal({ open, onCancel, onApply }) {
	const [mode, setMode] = useState("keep");
	const [order, setOrder] = useState("x");
	const handleOk = () => {
		onApply({ mode, order });
		onCancel();
	};
	return (
		<Modal
			open={open}
			title="Annotate schematic"
			onCancel={onCancel}
			onOk={handleOk}
			okText="Apply"
			cancelText="Cancel"
			width={320}
		>
			<div style={ANNOTATE_BODY_STYLE}>
				<AnnotateModeSelect mode={mode} onChange={setMode} />
				<AnnotateOrderSelect order={order} onChange={setOrder} />
			</div>
		</Modal>
	);
}

function AnnotateButton({ onOpen }) {
	return (
		<ToolButton
			title="Annotate schematic"
			onClick={onOpen}
			ariaLabel="Annotate"
			text="Annotate"
		/>
	);
}

function AnnotateAction({ onApply }) {
	const [open, setOpen] = useState(false);
	const close = useCallback(() => setOpen(false), []);
	const openModal = useCallback(() => setOpen(true), []);
	return (
		<>
			<AnnotateButton onOpen={openModal} />
			<AnnotateModal open={open} onCancel={close} onApply={onApply} />
		</>
	);
}

function ActionGroup({ state, actions }) {
	return (
		<>
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
		</>
	);
}

function EditorToolbar({ state, actions }) {
	const isPcb = state.activeTab === "pcb";
	return (
		<div
			style={TOOLBAR_CONTAINER_STYLE}
			role="toolbar"
			aria-label="Editor tools"
		>
			<ActionGroup state={state} actions={actions} />
			<ModeButtons
				dirty={state.dirty}
				save={actions.save}
				openCommit={actions.openCommit}
			/>
			<div style={{ display: !isPcb ? "flex" : "none", alignItems: "center" }}>
				<AnnotateAction onApply={actions.annotate} />
			</div>
			<div style={{ display: isPcb ? "flex" : "none", alignItems: "center" }}>
				<BoardTools
					ir={state.ir}
					board={state.board}
					onChange={actions.onBoardToolsChange}
					disabled={!isPcb}
				/>
			</div>
			<ExportDropdown state={state} actions={actions} />
		</div>
	);
}

function dispatchSelectionActions(selection, dispatch, actionBuilder) {
	for (const id of selection ?? []) {
		dispatch(actionBuilder(id));
	}
}

function useEditorActions({ doc, dispatch, board, onSave, markSaved }) {
	const applySelection = useCallback(
		(builder) => dispatchSelectionActions(doc?.selection, dispatch, builder),
		[doc?.selection, dispatch],
	);

	const rotate = useCallback(() => {
		applySelection((partId) => ({ type: "rotatePart", partId, deltaDeg: 90 }));
	}, [applySelection]);

	const flip = useCallback(() => {
		applySelection((partId) => ({ type: "flipPart", partId }));
	}, [applySelection]);

	const remove = useCallback(() => {
		applySelection((partId) => ({ type: "deletePart", partId }));
	}, [applySelection]);

	const save = useCallback(() => {
		onSave?.({ ir: doc.ir, board });
		markSaved();
	}, [doc.ir, board, onSave, markSaved]);

	return { rotate, flip, remove, save };
}

function isSaveShortcut(e) {
	const isModifier = Boolean(e.ctrlKey || e.metaKey);
	const isKeyS = e.key === "s" || e.key === "S";
	return isModifier && isKeyS;
}

function useSaveShortcut(save) {
	useEffect(() => {
		const onKeyDown = (e) => {
			if (isSaveShortcut(e)) {
				e.preventDefault();
				save();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [save]);
}

const MODIFIER_PROPS = ["ctrlKey", "metaKey", "altKey"];
const EDITABLE_INPUT_TAGS = new Set(["INPUT", "TEXTAREA"]);

function hasActiveModifiers(e) {
	return MODIFIER_PROPS.some((prop) => Boolean(e[prop]));
}

function isEditableElement(target) {
	if (!target) return false;
	return (
		EDITABLE_INPUT_TAGS.has(target.tagName) || Boolean(target.isContentEditable)
	);
}

function isKeyA(e) {
	return e.key === "a" || e.key === "A";
}

function isAddShortcut(e) {
	if (hasActiveModifiers(e)) return false;
	if (!isKeyA(e)) return false;
	return !isEditableElement(e.target);
}

function useAddPartShortcut(openLibrary) {
	useEffect(() => {
		const onKeyDown = (e) => {
			if (isAddShortcut(e)) {
				e.preventDefault();
				openLibrary();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [openLibrary]);
}

function isOriginShortcut(e) {
	if (hasActiveModifiers(e)) return false;
	if (e.code === "Space") return !isEditableElement(e.target);
	if (e.key === " ") return !isEditableElement(e.target);
	return false;
}

function useOriginShortcut() {
	useEffect(() => {
		const onKeyDown = (e) => {
			if (isOriginShortcut(e)) {
				e.preventDefault();
				setOrigin();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
}

function useLibraryState() {
	const [libraryOpen, setLibraryOpen] = useState(false);
	const openLibrary = useCallback(() => setLibraryOpen(true), []);
	const closeLibrary = useCallback(() => setLibraryOpen(false), []);
	useAddPartShortcut(openLibrary);
	return { libraryOpen, openLibrary, closeLibrary };
}

function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

function downloadFile(filename, text) {
	downloadBlob(
		new Blob([text], { type: "text/plain;charset=utf-8" }),
		filename,
	);
}

function downloadFiles(files) {
	if (!files || typeof files !== "object") return;
	for (const [name, content] of Object.entries(files)) {
		downloadFile(name, content);
	}
}

async function runDownloadAction(fetcher, filename, defaultErr) {
	try {
		const res = await fetcher();
		if (res?.ok && res.blob) {
			downloadBlob(res.blob, filename);
			return;
		}
		message.error(res?.error || defaultErr);
	} catch (err) {
		message.error(err?.message || defaultErr);
	}
}

function useBomExport({ api, ir }) {
	const [bomLoading, setBomLoading] = useState(false);
	const exportBom = useCallback(async () => {
		if (typeof api?.editorBom !== "function") return;
		setBomLoading(true);
		try {
			await runDownloadAction(
				() => api.editorBom({ ir, name: ir?.name }),
				`${ir?.name || "design"}-bom.csv`,
				"Failed to export BOM",
			);
		} finally {
			setBomLoading(false);
		}
	}, [api, ir]);
	return { exportBom, bomLoading };
}

function useNetlistExport({ api, ir }) {
	const [netlistLoading, setNetlistLoading] = useState(false);
	const exportNetlist = useCallback(async () => {
		if (typeof api?.editorNetlist !== "function") return;
		setNetlistLoading(true);
		try {
			await runDownloadAction(
				() => api.editorNetlist({ ir, name: ir?.name }),
				`${ir?.name || "design"}.net`,
				"Failed to export Netlist",
			);
		} finally {
			setNetlistLoading(false);
		}
	}, [api, ir]);
	return { exportNetlist, netlistLoading };
}

function useDownloadActions({ api, ir }) {
	const bom = useBomExport({ api, ir });
	const netlist = useNetlistExport({ api, ir });
	return {
		exportBom: bom.exportBom,
		bomLoading: bom.bomLoading,
		exportNetlist: netlist.exportNetlist,
		netlistLoading: netlist.netlistLoading,
	};
}

// The export route returns writer warnings (missing symbols, pin offsets, unfilled zones).
function showExportWarnings(toast, warnings) {
	const summary = summarizeWarnings(warnings);
	if (!summary) return;
	toast.warning({
		duration: 8,
		content: (
			<div style={{ textAlign: "left" }}>
				<div>{`Exported with ${summary.total} warnings:`}</div>
				{summary.lines.map((line) => (
					<div key={line}>{line}</div>
				))}
			</div>
		),
	});
}

function useExportAction({ api, ir, board }) {
	const { message: toast } = AntApp.useApp();
	const [exporting, setExporting] = useState(false);
	const exportKiCad = useCallback(async () => {
		if (typeof api?.editorExport !== "function") return;
		setExporting(true);
		try {
			const res = await api.editorExport({ ir, board, title: ir?.name });
			if (res?.ok && res.data?.files) {
				downloadFiles(res.data.files);
				showExportWarnings(toast, res.data.warnings);
			}
		} finally {
			setExporting(false);
		}
	}, [api, ir, board, toast]);
	return { exportKiCad, exporting };
}

function useDesignExports({ api, ir, board }) {
	const exp = useExportAction({ api, ir, board });
	const dl = useDownloadActions({ api, ir });
	return {
		exportKiCad: exp.exportKiCad,
		exporting: exp.exporting,
		exportBom: dl.exportBom,
		bomLoading: dl.bomLoading,
		exportNetlist: dl.exportNetlist,
		netlistLoading: dl.netlistLoading,
	};
}

function applyAnnotateChanges(dispatch, changes) {
	for (const change of changes) {
		dispatch({
			type: "setPartField",
			partId: change.id,
			field: "ref",
			value: change.to,
		});
	}
}

function useAnnotateAction({ ir, dispatch }) {
	return useCallback(
		({ mode, order }) => {
			const res = annotate(ir, { mode, order });
			const changes = res?.changes ?? [];
			if (changes.length === 0) {
				message.success("Nothing to annotate");
				return;
			}
			applyAnnotateChanges(dispatch, changes);
			message.success(`Annotated ${changes.length} parts`);
		},
		[ir, dispatch],
	);
}

async function fetchEntity(api, method, dataKey, id) {
	if (typeof api?.[method] !== "function") return null;
	const res = await api[method](id);
	return res?.ok ? (res.data?.[dataKey] ?? null) : null;
}

// Symbols embedded in the opened file win; the library is the fallback.
function useCanvasFetchers(api, symbols) {
	const fetchSymbol = useCallback(
		(libId) =>
			symbols?.[libId]
				? Promise.resolve(symbols[libId])
				: fetchEntity(api, "getSymbol", "symbol", libId),
		[api, symbols],
	);

	const fetchFootprint = useCallback(
		(libId) => fetchEntity(api, "getFootprint", "footprint", libId),
		[api],
	);

	return { fetchSymbol, fetchFootprint };
}

function toToolItem(libraryPayload) {
	const symbol = libraryPayload?.symbol ?? "";
	const footprint = libraryPayload?.footprint ?? "";
	const ref = libraryPayload?.ref || libraryPayload?.prefix || "";
	const value = libraryPayload?.value ?? "";
	return {
		id: symbol || footprint,
		label: value || ref,
		symbol,
		footprint,
		ref,
		value,
	};
}

function usePlacePartCallback(activeTab) {
	return useCallback(
		(payload) => {
			const tool = activeTab === "pcb" ? "placeFootprint" : "placeSymbol";
			emitEditorTool({ tab: activeTab, tool, item: toToolItem(payload) });
		},
		[activeTab],
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

function useFocusItem(focusItemId, onSelect) {
	const lastRef = useRef(null);
	useEffect(() => {
		const isString = typeof focusItemId === "string" && focusItemId.length > 0;
		if (isString && focusItemId !== lastRef.current) {
			onSelect?.(focusItemId);
		}
		lastRef.current = focusItemId;
	}, [focusItemId, onSelect]);
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

function PanelToggleButton({ open, onToggle }) {
	return (
		<Tooltip title={open ? "Collapse board summary" : "Toggle board summary"}>
			<Button
				size="small"
				onClick={onToggle}
				aria-expanded={open}
				aria-label="Toggle board summary"
				icon={open ? <RightOutlined /> : <LeftOutlined />}
				style={PANEL_TOGGLE_STYLE}
			/>
		</Tooltip>
	);
}

function useCollapsiblePanel(selection) {
	const [panelOpen, setPanelOpen] = useState(false);
	const prevSelectedRef = useRef(null);
	const selectedId = selection?.[0] ?? null;

	useEffect(() => {
		if (selectedId && selectedId !== prevSelectedRef.current) {
			setPanelOpen(true);
		}
		prevSelectedRef.current = selectedId;
	}, [selectedId]);

	const togglePanel = useCallback(() => setPanelOpen((prev) => !prev), []);
	return { panelOpen, togglePanel };
}

function SchematicViewportTab({ visible, docState, fetchers, problems }) {
	return (
		<CanvasTab visible={visible}>
			<SchematicCanvas
				editor={docState.editor}
				fetchSymbol={fetchers.fetchSymbol}
				problems={problems}
				onCursorMove={setCursor}
			/>
		</CanvasTab>
	);
}

function PcbViewportTab({ visible, docState, curBoard, fetchers, markers }) {
	return (
		<CanvasTab visible={visible}>
			<PcbCanvas
				editor={docState.editor}
				board={curBoard}
				onBoardChange={docState.setBoard}
				fetchFootprint={fetchers.fetchFootprint}
				visible={visible}
				markers={markers}
				onCursorMove={setCursor}
			/>
		</CanvasTab>
	);
}

function CanvasViewport(props) {
	const { activeTab, docState, curBoard, fetchers, markers, problems } = props;
	return (
		<div style={CANVAS_WRAPPER_STYLE}>
			<PanelToggleButton
				open={props.panelOpen}
				onToggle={props.onTogglePanel}
			/>
			<SchematicViewportTab
				visible={activeTab === "schematic"}
				docState={docState}
				fetchers={fetchers}
				problems={problems}
			/>
			<PcbViewportTab
				visible={activeTab === "pcb"}
				docState={docState}
				curBoard={curBoard}
				fetchers={fetchers}
				markers={markers}
			/>
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
				style={{ marginBottom: 0, flexShrink: 0 }}
				aria-label="Editor views"
			/>
			<EditorToolbar state={toolState} actions={actions} />
		</header>
	);
}

function buildToolState(docState, activeTab, exports = {}) {
	return {
		canUndo: docState.canUndo,
		canRedo: docState.canRedo,
		hasSelection: (docState.doc.selection?.length ?? 0) > 0,
		activeTab,
		dirty: docState.dirty,
		exporting: exports.exporting,
		bomLoading: exports.bomLoading,
		netlistLoading: exports.netlistLoading,
		ir: docState.ir,
		board: docState.board,
	};
}

function EditorBody(props) {
	const { activeTab, ctrl, onOpenLibrary, panelOpen, onTogglePanel } = props;
	const openLib = onOpenLibrary ?? ctrl?.actions?.openLibrary;
	return (
		<div style={CONTENT_ROW_STYLE}>
			<ToolPalette tab={activeTab} onOpenLibrary={openLib} />
			<CanvasViewport
				activeTab={activeTab}
				docState={ctrl.docState}
				curBoard={ctrl.curBoard}
				fetchers={ctrl.fetchers}
				markers={ctrl.liveChecks.markers}
				problems={ctrl.liveChecks.issues}
				panelOpen={panelOpen}
				onTogglePanel={onTogglePanel}
			/>
			{panelOpen && (
				<PropertiesPanel
					doc={ctrl.docState.doc}
					dispatch={ctrl.docState.dispatch}
				/>
			)}
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
	return { ...editActions, undo, redo, ...extra };
}

function useBoardToolsChange(docState) {
	return useCallback(
		({ ir: nextIr, board: nextBoard }) => {
			if (nextBoard !== undefined) {
				docState.setBoard(nextBoard);
			}
			if (nextIr) {
				docState.replaceIr(nextIr);
			}
		},
		[docState],
	);
}

function useScreenController({
	ir,
	board,
	onSave,
	api,
	openCommit,
	symbols,
	activeTab,
}) {
	const docState = useEditorDocument({ ir, board });
	const lib = useLibraryState();
	const fetchers = useCanvasFetchers(api, symbols);
	const { doc, board: curBoard, dispatch } = docState;
	const onPlace = usePlacePartCallback(activeTab);
	const onSelectIssue = useIssueSelector(dispatch);
	const exports = useDesignExports({ api, ir: doc.ir, board: curBoard });
	const annotate = useAnnotateAction({ ir: doc.ir, dispatch });
	const liveChecks = useLiveChecks({ api, ir: doc.ir, board: curBoard });
	const onBoardToolsChange = useBoardToolsChange(docState);
	const actions = useScreenActions(docState, onSave, {
		openLibrary: lib.openLibrary,
		exportKiCad: exports.exportKiCad,
		exportBom: exports.exportBom,
		exportNetlist: exports.exportNetlist,
		annotate,
		onBoardToolsChange,
		openCommit,
	});
	return {
		docState,
		curBoard,
		fetchers,
		lib,
		onPlace,
		onSelectIssue,
		actions,
		exports,
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

function EditorMainContent(props) {
	const { ctrl, activeTab, toolState, onTabChange, panelOpen, onTogglePanel } =
		props;
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
				ctrl={ctrl}
				onOpenLibrary={ctrl.actions.openLibrary}
				panelOpen={panelOpen}
				onTogglePanel={onTogglePanel}
			/>
		</>
	);
}

function useCommitController(save, getContext) {
	const [open, setOpen] = useState(false);
	const saveRef = useRef(save);
	saveRef.current = save;
	const contextRef = useRef(getContext);
	contextRef.current = getContext;
	const openCommit = useCallback(() => setOpen(true), []);
	const closeCommit = useCallback(() => setOpen(false), []);
	const onCommitted = useCallback((data) => {
		saveRef.current?.();
		setOpen(false);
		const ctx = contextRef.current?.() ?? {};
		emitCommitCreated({
			repoPath: ctx.repoPath,
			filePath: ctx.filePath,
			commit: data?.commit,
		});
	}, []);
	return { open, openCommit, closeCommit, onCommitted };
}

function CommitDialog(props) {
	const { commit, ir, docIr, board, docBoard, api, repo } = props;
	return (
		<SaveCommitDialog
			open={commit.open}
			onClose={commit.closeCommit}
			beforeIr={ir}
			afterIr={docIr}
			beforeBoard={board}
			afterBoard={docBoard}
			api={api}
			repo={repo}
			onCommitted={commit.onCommitted}
		/>
	);
}

function useScreenCommit(saveFn, repo, activeTab) {
	return useCommitController(saveFn, () => ({
		repoPath: repo?.repoPath,
		filePath: activeTab === "pcb" ? repo?.pcbPath : repo?.schPath,
	}));
}

function useProblemsState(issues) {
	const [problemsOpen, setProblemsOpen] = useState(false);
	const toggle = useCallback(() => setProblemsOpen((p) => !p), []);
	const problems = { count: issues?.length ?? 0, open: problemsOpen, toggle };
	return { problemsOpen, problems };
}

function useEditorScreen(props) {
	const [activeTab, setActiveTab] = useState(
		props.initialTab === "pcb" ? "pcb" : "schematic",
	);
	const commit = useScreenCommit(
		() => ctrl.actions.save(),
		props.repo,
		activeTab,
	);
	const ctrl = useScreenController({
		...props,
		openCommit: commit.openCommit,
		activeTab,
	});
	useFocusItem(props.focusItemId, ctrl.onSelectIssue);
	const toolState = buildToolState(ctrl.docState, activeTab, ctrl.exports);
	const { problemsOpen, problems } = useProblemsState(ctrl.liveChecks.issues);
	const panel = useCollapsiblePanel(ctrl.docState.doc?.selection);
	return {
		activeTab,
		setActiveTab,
		problemsOpen,
		ctrl,
		toolState,
		problems,
		commit,
		panel,
	};
}

function EditorView({ s, ir, board, api, repo }) {
	return (
		<main style={ROOT_STYLE} aria-label="Editor screen">
			<EditorMainContent
				ctrl={s.ctrl}
				activeTab={s.activeTab}
				toolState={s.toolState}
				onTabChange={s.setActiveTab}
				panelOpen={s.panel.panelOpen}
				onTogglePanel={s.panel.togglePanel}
			/>
			<EditorPanels problemsOpen={s.problemsOpen} ctrl={s.ctrl} api={api} />
			<CommitDialog
				commit={s.commit}
				ir={ir}
				docIr={s.ctrl.docState.ir}
				board={board}
				docBoard={s.ctrl.curBoard}
				api={api}
				repo={repo}
			/>
			<StatusBar
				doc={s.ctrl.docState.doc}
				activeTab={s.activeTab}
				dirty={s.ctrl.docState.dirty}
				problems={s.problems}
			/>
		</main>
	);
}

export default function EditorScreen({
	ir,
	board,
	onSave,
	api,
	focusItemId,
	repo,
	initialTab,
	symbols,
}) {
	const s = useEditorScreen({
		ir,
		board,
		onSave,
		api,
		focusItemId,
		repo,
		initialTab,
		symbols,
	});
	return <EditorView s={s} ir={ir} board={board} api={api} repo={repo} />;
}
