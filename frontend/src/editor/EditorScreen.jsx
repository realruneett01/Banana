import {
	AppstoreOutlined,
	DeleteOutlined,
	DownloadOutlined,
	DownOutlined,
	EllipsisOutlined,
	LeftOutlined,
	PlayCircleOutlined,
	PlusOutlined,
	RedoOutlined,
	RightOutlined,
	RotateRightOutlined,
	SaveOutlined,
	SwapOutlined,
	TableOutlined,
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
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { emitCommitCreated } from "../designEvents.js";
import AssignFootprints from "./AssignFootprints.jsx";
import { annotate } from "./annotate.js";
import BoardTools from "./BoardTools.jsx";
import ChecksPanel from "./ChecksPanel.jsx";
import { countViolations, runDrc, runErc } from "./checksApi.js";
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
import { downloadFiles, requestFabOutputs } from "./fabExport.js";
import LibraryBrowser from "./LibraryBrowser.jsx";
import PcbCanvas from "./PcbCanvas.jsx";
import PropertiesPanel from "./PropertiesPanel.jsx";
import SaveCommitDialog from "./SaveCommitDialog.jsx";
import SchematicCanvas from "./SchematicCanvas.jsx";
import SymbolFieldsTable from "./SymbolFieldsTable.jsx";
import {
	breadcrumb,
	createNavState,
	enterSheet,
	jumpTo,
	leaveSheet,
} from "./sheetNav.js";
import ToolPalette from "./ToolPalette.jsx";
import { useEditorDocument } from "./useEditorDocument.js";
import { useLiveChecks } from "./useLiveChecks.js";
import { formatCoord, GRID_PRESETS } from "./viewport.js";

// --- PURE TOOLBAR OVERFLOW HELPERS (NO JSX) ---
export const DEFAULT_TOOLBAR_PRIORITIES = Object.freeze({
	undo: 100,
	redo: 95,
	addPart: 90,
	save: 85,
	saveCommit: 60,
	rotate: 50,
	flip: 45,
	delete: 40,
	annotate: 30,
	boardTools: 20,
	boardSetup: 20,
	assignFootprints: 15,
	symbolFields: 10,
	checks: 5,
	drc: 5,
	erc: 5,
	export: 1,
});

export const DEFAULT_ITEM_WIDTHS = Object.freeze({
	undo: 32,
	redo: 32,
	addPart: 92,
	rotate: 32,
	flip: 32,
	delete: 32,
	save: 32,
	saveCommit: 140,
	annotate: 76,
	symbolFields: 32,
	assignFootprints: 32,
	boardTools: 236,
	boardSetup: 236,
	checks: 32,
	export: 92,
});

function resolvePriority(id, itemPri, priorities) {
	if (typeof itemPri === "number") return itemPri;
	if (priorities && typeof priorities[id] === "number") {
		return priorities[id];
	}
	return DEFAULT_TOOLBAR_PRIORITIES[id] ?? 50;
}

function normalizeToolbarItems(itemsInput, prioritiesInput) {
	if (!itemsInput) return [];
	if (Array.isArray(itemsInput)) {
		return itemsInput.map((it) => ({
			id: typeof it === "string" ? it : it.id,
			width: typeof it === "object" ? (it.width ?? 32) : 32,
			priority: resolvePriority(
				typeof it === "string" ? it : it.id,
				it?.priority,
				prioritiesInput,
			),
		}));
	}
	return Object.entries(itemsInput).map(([id, width]) => ({
		id,
		width: typeof width === "number" ? width : 32,
		priority: resolvePriority(id, undefined, prioritiesInput),
	}));
}

function calcRequiredWidth(items, hasMore, moreWidth, gap) {
	const count = items.length;
	if (count === 0) return hasMore ? moreWidth : 0;
	let sum = 0;
	for (let i = 0; i < count; i++) {
		sum += items[i].width;
	}
	const totalGaps = count - 1 + (hasMore ? 1 : 0);
	const moreExtra = hasMore ? moreWidth : 0;
	return sum + totalGaps * gap + moreExtra;
}

function findLowestPriorityIndex(items) {
	let minIdx = -1;
	let minPri = Infinity;
	for (let i = items.length - 1; i >= 0; i--) {
		if (items[i].priority < minPri) {
			minPri = items[i].priority;
			minIdx = i;
		}
	}
	return minIdx;
}

function isOptionsBag(val) {
	if (!val || typeof val !== "object") return false;
	if (Array.isArray(val)) return false;
	return ["containerWidth", "items", "itemWidths"].some((k) => k in val);
}

function parseOptionsBag(opts) {
	return {
		items: normalizeToolbarItems(
			opts.items || opts.itemWidths,
			opts.priorities,
		),
		containerWidth: opts.containerWidth,
		moreWidth: opts.moreWidth ?? 32,
		gap: opts.gap ?? 4,
	};
}

function parsePositionalArgs(itemsInput, width, priorities, extraOpts) {
	const opts = extraOpts && typeof extraOpts === "object" ? extraOpts : {};
	return {
		items: normalizeToolbarItems(itemsInput, priorities),
		containerWidth: width,
		moreWidth: opts.moreWidth ?? 32,
		gap: opts.gap ?? 4,
	};
}

function extractOverflowConfig(arg1, arg2, arg3, arg4) {
	if (isOptionsBag(arg1)) {
		return parseOptionsBag(arg1);
	}
	return parsePositionalArgs(arg1, arg2, arg3, arg4);
}

export function computeToolbarOverflow(arg1, arg2, arg3, arg4) {
	const { items, containerWidth, moreWidth, gap } = extractOverflowConfig(
		arg1,
		arg2,
		arg3,
		arg4,
	);
	const allIds = items.map((it) => it.id);
	if (containerWidth == null || containerWidth === Infinity) {
		return {
			visible: allIds,
			overflow: [],
			more: [],
			visibleIds: allIds,
			overflowIds: [],
		};
	}
	if (calcRequiredWidth(items, false, moreWidth, gap) <= containerWidth) {
		return {
			visible: allIds,
			overflow: [],
			more: [],
			visibleIds: allIds,
			overflowIds: [],
		};
	}
	const visibleItems = [...items];
	const overflowItems = [];
	while (visibleItems.length > 0) {
		if (
			calcRequiredWidth(visibleItems, true, moreWidth, gap) <= containerWidth
		) {
			break;
		}
		const lowestIdx = findLowestPriorityIndex(visibleItems);
		if (lowestIdx === -1) break;
		const [removed] = visibleItems.splice(lowestIdx, 1);
		overflowItems.unshift(removed);
	}
	const visible = visibleItems.map((it) => it.id);
	const overflow = overflowItems.map((it) => it.id);
	return {
		visible,
		overflow,
		more: overflow,
		visibleIds: visible,
		overflowIds: overflow,
	};
}

export const partitionToolbarItems = computeToolbarOverflow;
export const resolveToolbarOverflow = computeToolbarOverflow;
// --- END PURE TOOLBAR OVERFLOW HELPERS ---

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
	minWidth: 0,
	overflow: "hidden",
	flex: 1,
	justifyContent: "flex-end",
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

const BREADCRUMB_BAR_STYLE = Object.freeze({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: "4px 8px",
	background: "#12151c",
	borderBottom: "1px solid #232836",
	fontSize: "12px",
	minHeight: "28px",
});

const BREADCRUMB_LIST_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	gap: "6px",
	flexWrap: "wrap",
});

const BREADCRUMB_BUTTON_STYLE = Object.freeze({
	background: "transparent",
	border: "none",
	cursor: "pointer",
	padding: "2px 4px",
	borderRadius: "4px",
	font: "inherit",
	fontSize: "inherit",
	color: "#38bdf8",
});

const BREADCRUMB_CURRENT_STYLE = Object.freeze({
	background: "transparent",
	border: "none",
	padding: "2px 4px",
	font: "inherit",
	fontSize: "inherit",
	color: "#e6e8ee",
	fontWeight: 600,
	cursor: "default",
});

const SCHEMATIC_VIEWPORT_STYLE = Object.freeze({
	display: "flex",
	flexDirection: "column",
	width: "100%",
	height: "100%",
});

const SCHEMATIC_CANVAS_HOLDER_STYLE = Object.freeze({
	flex: 1,
	minHeight: 0,
	width: "100%",
	position: "relative",
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

function HistoryButtons({ canUndo, canRedo, undo, redo, visibleIds }) {
	const showUndo = !visibleIds || visibleIds.includes("undo");
	const showRedo = !visibleIds || visibleIds.includes("redo");
	if (!showUndo && !showRedo) return null;
	return (
		<Space size={4}>
			{showUndo && (
				<ToolButton
					title="Undo (Ctrl+Z)"
					icon={<UndoOutlined />}
					disabled={!canUndo}
					onClick={undo}
					ariaLabel="Undo"
				/>
			)}
			{showRedo && (
				<ToolButton
					title="Redo (Ctrl+Y)"
					icon={<RedoOutlined />}
					disabled={!canRedo}
					onClick={redo}
					ariaLabel="Redo"
				/>
			)}
		</Space>
	);
}

function TransformButtons({ hasSelection, rotate, flip, visibleIds }) {
	const showRotate = !visibleIds || visibleIds.includes("rotate");
	const showFlip = !visibleIds || visibleIds.includes("flip");
	if (!showRotate && !showFlip) return null;
	return (
		<Space size={4} style={{ display: "inline-flex" }}>
			{showRotate && (
				<ToolButton
					title="Rotate 90° (R)"
					icon={<RotateRightOutlined />}
					disabled={!hasSelection}
					onClick={rotate}
					ariaLabel="Rotate"
				/>
			)}
			{showFlip && (
				<ToolButton
					title="Flip Side (F)"
					icon={<SwapOutlined />}
					disabled={!hasSelection}
					onClick={flip}
					ariaLabel="Flip"
				/>
			)}
		</Space>
	);
}

function DeleteButton({ hasSelection, remove, visible = true }) {
	if (visible === false) return null;
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

function EditActionButtons({ hasSelection, rotate, flip, remove, visibleIds }) {
	const isVisible = (id) => !visibleIds || visibleIds.includes(id);
	const showDelete = isVisible("delete");
	const showTransform = isVisible("rotate") || isVisible("flip");
	if (!showDelete && !showTransform) return null;
	return (
		<Space size={4}>
			<TransformButtons
				hasSelection={hasSelection}
				rotate={rotate}
				flip={flip}
				visibleIds={visibleIds}
			/>
			<DeleteButton
				hasSelection={hasSelection}
				remove={remove}
				visible={showDelete}
			/>
		</Space>
	);
}

function SaveCommitButton({ dirty, onOpen, visible = true }) {
	if (visible === false) return null;
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

function ModeButtons({ dirty, save, openCommit, visibleIds }) {
	const showSave = !visibleIds || visibleIds.includes("save");
	const showCommit = !visibleIds || visibleIds.includes("saveCommit");
	if (!showSave && !showCommit) return null;
	return (
		<Space size={4}>
			{showSave && (
				<ToolButton
					title="Save (Ctrl+S)"
					icon={<SaveOutlined />}
					disabled={!dirty}
					onClick={save}
					ariaLabel="Save"
					type="primary"
				/>
			)}
			<SaveCommitButton
				dirty={dirty}
				onOpen={openCommit}
				visible={showCommit}
			/>
		</Space>
	);
}

function AddPartButton({ onAddPart, visible = true }) {
	if (visible === false) return null;
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

const FAB_EXPORT_ITEMS = [
	{
		key: "fab-gerbers",
		label: "Gerbers + drill",
		outputs: ["gerbers", "drill"],
	},
	{ key: "fab-pos", label: "Pick and place", outputs: ["pos"] },
	{ key: "fab-pdf", label: "PDF plot", outputs: ["pdf"] },
	{ key: "fab-step", label: "3D STEP", outputs: ["step"] },
	{
		key: "fab-all",
		label: "Fabrication package",
		outputs: ["gerbers", "drill", "pos", "pdf", "step"],
	},
];

function buildExportItems(state) {
	const items = [
		{ key: "kicad", label: "KiCad files", disabled: state.exporting },
		{ key: "bom", label: "BOM", disabled: state.bomLoading },
		{ key: "netlist", label: "Netlist", disabled: state.netlistLoading },
	];
	if (state.activeTab === "pcb") {
		for (const item of FAB_EXPORT_ITEMS) {
			items.push({
				key: item.key,
				label: item.label,
				disabled: state.fabLoading,
			});
		}
	}
	return items;
}

function runExportAction(key, actions) {
	if (key === "kicad") actions.exportKiCad?.();
	if (key === "bom") actions.exportBom?.();
	if (key === "netlist") actions.exportNetlist?.();
	const fabItem = FAB_EXPORT_ITEMS.find((item) => item.key === key);
	if (fabItem) actions.exportFab?.(fabItem.outputs);
}

function ExportDropdown({ state, actions, visible = true }) {
	if (visible === false) return null;
	const isExporting = Boolean(
		state.exporting ||
			state.bomLoading ||
			state.netlistLoading ||
			state.fabLoading,
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

function AnnotateButton({ onOpen, visible = true }) {
	if (visible === false) return null;
	return (
		<ToolButton
			title="Annotate schematic"
			onClick={onOpen}
			ariaLabel="Annotate"
			text="Annotate"
		/>
	);
}

function AnnotateAction({ onApply, onOpenRef, visible = true }) {
	const [open, setOpen] = useState(false);
	const close = useCallback(() => setOpen(false), []);
	const openModal = useCallback(() => setOpen(true), []);
	useEffect(() => {
		if (onOpenRef) onOpenRef.current = openModal;
	}, [onOpenRef, openModal]);
	return (
		<>
			<AnnotateButton onOpen={openModal} visible={visible} />
			<AnnotateModal open={open} onCancel={close} onApply={onApply} />
		</>
	);
}

function EditSymbolFieldsButton({ onOpen, visible = true }) {
	if (visible === false) return null;
	return (
		<ToolButton
			title="Edit symbol fields"
			icon={<TableOutlined />}
			onClick={onOpen}
			ariaLabel="Edit symbol fields"
		/>
	);
}

function AssignFootprintsButton({ onOpen, visible = true }) {
	if (visible === false) return null;
	return (
		<ToolButton
			title="Assign footprints"
			icon={<AppstoreOutlined />}
			onClick={onOpen}
			ariaLabel="Assign footprints"
		/>
	);
}

function SymbolFieldsAction({ ir, onApply, onOpenRef, visible = true }) {
	const [open, setOpen] = useState(false);
	const close = useCallback(() => setOpen(false), []);
	const openModal = useCallback(() => setOpen(true), []);
	useEffect(() => {
		if (onOpenRef) onOpenRef.current = openModal;
	}, [onOpenRef, openModal]);
	const handleApply = useCallback(
		(cmd) => {
			onApply?.(cmd);
			close();
		},
		[onApply, close],
	);
	return (
		<>
			<EditSymbolFieldsButton onOpen={openModal} visible={visible} />
			<SymbolFieldsTable
				open={open}
				ir={ir}
				onApply={handleApply}
				onClose={close}
			/>
		</>
	);
}

function AssignFootprintsAction({ ir, onApply, onOpenRef, visible = true }) {
	const [open, setOpen] = useState(false);
	const close = useCallback(() => setOpen(false), []);
	const openModal = useCallback(() => setOpen(true), []);
	useEffect(() => {
		if (onOpenRef) onOpenRef.current = openModal;
	}, [onOpenRef, openModal]);
	const handleApply = useCallback(
		(cmd) => {
			onApply?.(cmd);
			close();
		},
		[onApply, close],
	);
	return (
		<>
			<AssignFootprintsButton onOpen={openModal} visible={visible} />
			<AssignFootprints
				open={open}
				ir={ir}
				onApply={handleApply}
				onClose={close}
			/>
		</>
	);
}

function SchematicTools({ state, actions, visible, visibleIds, actionRefs }) {
	const isVisible = (id) => !visibleIds || visibleIds.includes(id);
	const style = {
		display: visible ? "flex" : "none",
		alignItems: "center",
		gap: 4,
	};
	return (
		<div style={style}>
			<AnnotateAction
				onApply={actions.annotate}
				onOpenRef={actionRefs?.annotate}
				visible={isVisible("annotate")}
			/>
			<SymbolFieldsAction
				ir={state.ir}
				onApply={actions.applyModelCommand}
				onOpenRef={actionRefs?.symbolFields}
				visible={isVisible("symbolFields")}
			/>
			<AssignFootprintsAction
				ir={state.ir}
				onApply={actions.applyModelCommand}
				onOpenRef={actionRefs?.assignFootprints}
				visible={isVisible("assignFootprints")}
			/>
		</div>
	);
}

function ActionGroup({ state, actions, visibleIds }) {
	const isVisible = (id) => !visibleIds || visibleIds.includes(id);
	return (
		<>
			<HistoryButtons
				canUndo={state.canUndo}
				canRedo={state.canRedo}
				undo={actions.undo}
				redo={actions.redo}
				visibleIds={visibleIds}
			/>
			<AddPartButton
				onAddPart={actions.openLibrary}
				visible={isVisible("addPart")}
			/>
			<EditActionButtons
				hasSelection={state.hasSelection}
				rotate={actions.rotate}
				flip={actions.flip}
				remove={actions.remove}
				visibleIds={visibleIds}
			/>
		</>
	);
}

function RunDrcButton({ loading, onRun }) {
	return (
		<ToolButton
			title="Check the board for manufacturing problems"
			icon={<PlayCircleOutlined />}
			disabled={loading}
			loading={loading}
			onClick={onRun}
			ariaLabel="Run DRC"
		/>
	);
}

function RunErcButton({ loading, onRun }) {
	return (
		<ToolButton
			title="Check the schematic for wiring mistakes"
			icon={<PlayCircleOutlined />}
			disabled={loading}
			loading={loading}
			onClick={onRun}
			ariaLabel="Run ERC"
		/>
	);
}

function ChecksAction({ activeTab, loading, onRun, visible = true }) {
	if (visible === false) return null;
	if (activeTab === "pcb") {
		return <RunDrcButton loading={loading} onRun={onRun} />;
	}
	return <RunErcButton loading={loading} onRun={onRun} />;
}

function useToolbarWidth(ref) {
	const [width, setWidth] = useState(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const update = (entries) => {
			const entry = entries?.[0];
			if (entry?.contentRect) {
				setWidth(entry.contentRect.width);
			} else {
				setWidth(el.getBoundingClientRect().width);
			}
		};
		update([{ contentRect: { width: el.getBoundingClientRect().width } }]);
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	}, [ref]);

	return width;
}

function createExportMenuItem(state, actions) {
	return {
		key: "export",
		label: "Export",
		icon: <DownloadOutlined />,
		children: buildExportItems(state).map((it) => ({
			key: `export-${it.key}`,
			label: it.label,
			disabled: it.disabled,
			onClick: () => runExportAction(it.key, actions),
		})),
	};
}

function createEditMoreItem(id, state, actions) {
	const map = {
		undo: {
			key: "undo",
			label: "Undo (Ctrl+Z)",
			icon: <UndoOutlined />,
			disabled: !state.canUndo,
			onClick: actions.undo,
		},
		redo: {
			key: "redo",
			label: "Redo (Ctrl+Y)",
			icon: <RedoOutlined />,
			disabled: !state.canRedo,
			onClick: actions.redo,
		},
		addPart: {
			key: "addPart",
			label: "Add part (A)",
			icon: <PlusOutlined />,
			onClick: actions.openLibrary,
		},
		rotate: {
			key: "rotate",
			label: "Rotate 90° (R)",
			icon: <RotateRightOutlined />,
			disabled: !state.hasSelection,
			onClick: actions.rotate,
		},
		flip: {
			key: "flip",
			label: "Flip Side (F)",
			icon: <SwapOutlined />,
			disabled: !state.hasSelection,
			onClick: actions.flip,
		},
		delete: {
			key: "delete",
			label: "Delete (Del)",
			icon: <DeleteOutlined />,
			disabled: !state.hasSelection,
			onClick: actions.remove,
			danger: true,
		},
	};
	return map[id] ?? null;
}

function createSaveMoreItem(id, state, actions) {
	if (id === "save") {
		return {
			key: "save",
			label: "Save (Ctrl+S)",
			icon: <SaveOutlined />,
			disabled: !state.dirty,
			onClick: actions.save,
		};
	}
	if (id === "saveCommit") {
		return {
			key: "saveCommit",
			label: "Save and commit",
			icon: <SaveOutlined />,
			disabled: !state.dirty,
			onClick: actions.openCommit,
		};
	}
	return null;
}

function createToolMoreItem(id, state, actions, actionRefs) {
	const isPcb = state.activeTab === "pcb";
	if (id === "annotate")
		return {
			key: "annotate",
			label: "Annotate",
			onClick: () => actionRefs?.annotate?.current?.(),
		};
	if (id === "symbolFields")
		return {
			key: "symbolFields",
			label: "Edit symbol fields",
			icon: <TableOutlined />,
			onClick: () => actionRefs?.symbolFields?.current?.(),
		};
	if (id === "assignFootprints")
		return {
			key: "assignFootprints",
			label: "Assign footprints",
			icon: <AppstoreOutlined />,
			onClick: () => actionRefs?.assignFootprints?.current?.(),
		};
	if (id === "checks")
		return {
			key: "checks",
			label: isPcb ? "Run DRC" : "Run ERC",
			icon: <PlayCircleOutlined />,
			disabled: state.checksLoading,
			onClick: actions.runChecks,
		};
	if (id === "export") return createExportMenuItem(state, actions);
	return null;
}

function createMoreMenuItem(id, state, actions, actionRefs) {
	return (
		createEditMoreItem(id, state, actions) ||
		createSaveMoreItem(id, state, actions) ||
		createToolMoreItem(id, state, actions, actionRefs)
	);
}

function buildMoreMenuItems(overflowIds, state, actions, actionRefs) {
	const items = [];
	for (const id of overflowIds) {
		const item = createMoreMenuItem(id, state, actions, actionRefs);
		if (item) items.push(item);
	}
	return items;
}

function MoreDropdown({ items }) {
	if (!items || items.length === 0) return null;
	return (
		<Dropdown menu={{ items }} trigger={["click"]}>
			<Tooltip title="More actions">
				<Button
					icon={<EllipsisOutlined />}
					size="small"
					aria-label="More actions"
				/>
			</Tooltip>
		</Dropdown>
	);
}

function getTabItemIds(isPcb) {
	if (isPcb) {
		return [
			"undo",
			"redo",
			"addPart",
			"rotate",
			"flip",
			"delete",
			"save",
			"saveCommit",
			"boardTools",
			"checks",
			"export",
		];
	}
	return [
		"undo",
		"redo",
		"addPart",
		"rotate",
		"flip",
		"delete",
		"save",
		"saveCommit",
		"annotate",
		"symbolFields",
		"assignFootprints",
		"checks",
		"export",
	];
}

function buildToolbarItemsForTab(isPcb) {
	const ids = getTabItemIds(isPcb);
	return ids.map((id) => ({
		id,
		width: DEFAULT_ITEM_WIDTHS[id] ?? 32,
		priority: DEFAULT_TOOLBAR_PRIORITIES[id] ?? 50,
	}));
}

function useToolbarState(state, actions) {
	const isPcb = state.activeTab === "pcb";
	const containerRef = useRef(null);
	const width = useToolbarWidth(containerRef);
	const annotateRef = useRef(null);
	const symbolFieldsRef = useRef(null);
	const assignFootprintsRef = useRef(null);
	const actionRefs = useMemo(
		() => ({
			annotate: annotateRef,
			symbolFields: symbolFieldsRef,
			assignFootprints: assignFootprintsRef,
		}),
		[],
	);
	const items = useMemo(() => buildToolbarItemsForTab(isPcb), [isPcb]);
	const { visible, overflow } = useMemo(
		() =>
			computeToolbarOverflow({
				items,
				containerWidth: width,
				moreWidth: 32,
				gap: 4,
			}),
		[items, width],
	);
	const moreItems = useMemo(
		() => buildMoreMenuItems(overflow, state, actions, actionRefs),
		[overflow, state, actions, actionRefs],
	);
	return { containerRef, visible, moreItems, actionRefs, isPcb };
}

function EditorToolbar({ state, actions }) {
	const { containerRef, visible, moreItems, actionRefs, isPcb } =
		useToolbarState(state, actions);
	const isVis = (id) => visible.includes(id);

	return (
		<div
			ref={containerRef}
			style={TOOLBAR_CONTAINER_STYLE}
			role="toolbar"
			aria-label="Editor tools"
		>
			<ActionGroup state={state} actions={actions} visibleIds={visible} />
			<ModeButtons
				dirty={state.dirty}
				save={actions.save}
				openCommit={actions.openCommit}
				visibleIds={visible}
			/>
			<SchematicTools
				state={state}
				actions={actions}
				visible={!isPcb}
				visibleIds={visible}
				actionRefs={actionRefs}
			/>
			<div
				style={{
					display: isPcb && isVis("boardTools") ? "flex" : "none",
					alignItems: "center",
				}}
			>
				<BoardTools
					ir={state.ir}
					board={state.board}
					onChange={actions.onBoardToolsChange}
					disabled={!isPcb}
				/>
			</div>
			<ChecksAction
				activeTab={state.activeTab}
				loading={state.checksLoading}
				onRun={actions.runChecks}
				visible={isVis("checks")}
			/>
			<ExportDropdown
				state={state}
				actions={actions}
				visible={isVis("export")}
			/>
			<MoreDropdown items={moreItems} />
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

function isLeaveSheetShortcut(e) {
	if (isEditableElement(e.target)) return false;
	return Boolean(e.altKey && (e.key === "Backspace" || e.code === "Backspace"));
}

function useLeaveSheetShortcut(leaveSheet, enabled) {
	useEffect(() => {
		if (!enabled) return;
		const onKeyDown = (e) => {
			if (isLeaveSheetShortcut(e)) {
				e.preventDefault();
				leaveSheet();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [leaveSheet, enabled]);
}

function useSheetNav(initialName = "Root") {
	const [navState, setNavState] = useState(() => createNavState(initialName));

	const enter = useCallback((sheet) => {
		setNavState((prev) => enterSheet(prev, sheet));
	}, []);

	const leave = useCallback(() => {
		setNavState((prev) => leaveSheet(prev));
	}, []);

	const jump = useCallback((index) => {
		setNavState((prev) => jumpTo(prev, index));
	}, []);

	const items = useMemo(() => breadcrumb(navState), [navState]);
	const canLeave = navState.stack.length > 1;

	return {
		navState,
		enterSheet: enter,
		leaveSheet: leave,
		jumpTo: jump,
		items,
		canLeave,
	};
}

function useEditorScreenNav(irName, activeTab) {
	const nav = useSheetNav(irName || "Root");
	useLeaveSheetShortcut(
		nav.leaveSheet,
		activeTab === "schematic" && nav.canLeave,
	);
	return nav;
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

function downloadKiCadFiles(files) {
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
				downloadKiCadFiles(res.data.files);
				showExportWarnings(toast, res.data.warnings);
			}
		} finally {
			setExporting(false);
		}
	}, [api, ir, board, toast]);
	return { exportKiCad, exporting };
}

async function exportDesignFile({ api, ir, board, ext, fileLabel }) {
	if (typeof api?.editorExport !== "function") {
		throw new Error("KiCad export is not available");
	}
	const res = await api.editorExport({ ir, board, title: ir?.name });
	if (!res?.ok || !res?.data?.files) {
		throw new Error(res?.error || `Failed to generate KiCad ${fileLabel}`);
	}
	const entry = Object.entries(res.data.files).find(([k]) => k.endsWith(ext));
	if (!entry) {
		throw new Error(`No ${ext} file found in export`);
	}
	return entry[1];
}

async function exportPcbText(api, ir, board) {
	return exportDesignFile({
		api,
		ir,
		board,
		ext: ".kicad_pcb",
		fileLabel: "PCB",
	});
}

async function exportSchText(api, ir, board) {
	return exportDesignFile({
		api,
		ir,
		board,
		ext: ".kicad_sch",
		fileLabel: "schematic",
	});
}

function resolveFabOutputs(outputs) {
	if (Array.isArray(outputs)) return outputs;
	const match = FAB_EXPORT_ITEMS.find(
		(item) => item.key === outputs || item.key === `fab-${outputs}`,
	);
	return match ? match.outputs : [outputs];
}

async function runFabExport({ api, ir, board, outputs }) {
	const pcbText = await exportPcbText(api, ir, board);
	const targetOutputs = resolveFabOutputs(outputs);
	const files = await requestFabOutputs({
		pcbText,
		name: ir?.name || "board",
		outputs: targetOutputs,
	});
	downloadFiles(files);
	return files.length;
}

function useFabExportAction({ api, ir, board }) {
	const [fabLoading, setFabLoading] = useState(false);
	const exportFab = useCallback(
		async (outputs) => {
			setFabLoading(true);
			const hide = message.loading("Exporting fabrication outputs...", 0);
			try {
				const count = await runFabExport({ api, ir, board, outputs });
				hide();
				message.success(
					`Exported ${count} fabrication file${count === 1 ? "" : "s"}`,
				);
			} catch (err) {
				hide();
				message.error(err?.message || "Fabrication export failed");
			} finally {
				setFabLoading(false);
			}
		},
		[api, ir, board],
	);
	return { exportFab, fabLoading };
}

function useDesignExports({ api, ir, board }) {
	const exp = useExportAction({ api, ir, board });
	const dl = useDownloadActions({ api, ir });
	const fab = useFabExportAction({ api, ir, board });
	return {
		exportKiCad: exp.exportKiCad,
		exporting: exp.exporting,
		exportBom: dl.exportBom,
		bomLoading: dl.bomLoading,
		exportNetlist: dl.exportNetlist,
		netlistLoading: dl.netlistLoading,
		exportFab: fab.exportFab,
		fabLoading: fab.fabLoading,
	};
}

async function executePcbDrc(api, ir, board) {
	const pcbText = await exportPcbText(api, ir, board);
	return await runDrc({ pcbText, name: ir?.name || "board" });
}

async function executeSchErc(api, ir, board) {
	const schText = await exportSchText(api, ir, board);
	return await runErc({ schText, name: ir?.name || "schematic" });
}

async function executeTabCheck(targetTab, { api, ir, board }) {
	if (targetTab === "pcb") {
		return await executePcbDrc(api, ir, board);
	}
	return await executeSchErc(api, ir, board);
}

const INITIAL_CHECKS_STATE = Object.freeze({
	pcb: Object.freeze({ result: null, loading: false }),
	schematic: Object.freeze({ result: null, loading: false }),
});

function getResultProblemCount(result) {
	if (!result) return null;
	const counts = result.counts ?? countViolations(result.violations);
	return (counts?.error ?? 0) + (counts?.warning ?? 0);
}

function updateTabChecksState(prev, tab, updates) {
	return {
		...prev,
		[tab]: { ...prev[tab], ...updates },
	};
}

function resolveProblemCount(result, fallbackIssues) {
	const count = getResultProblemCount(result);
	return count ?? fallbackIssues?.length ?? 0;
}

function useTabChecks({ api, ir, board, activeTab, issues }) {
	const [checksState, setChecksState] = useState(INITIAL_CHECKS_STATE);
	const [checksOpen, setChecksOpen] = useState(false);
	const toggleChecks = useCallback(() => setChecksOpen((p) => !p), []);
	const handleFocus = useCallback(() => {}, []);

	const runChecks = useCallback(
		async (target) => {
			const targetTab = typeof target === "string" ? target : activeTab;
			setChecksOpen(true);
			setChecksState((prev) =>
				updateTabChecksState(prev, targetTab, { loading: true }),
			);
			try {
				const result = await executeTabCheck(targetTab, { api, ir, board });
				setChecksState((prev) =>
					updateTabChecksState(prev, targetTab, { result, loading: false }),
				);
			} catch (err) {
				setChecksState((prev) =>
					updateTabChecksState(prev, targetTab, { loading: false }),
				);
				message.error(err?.message || "Check failed");
			}
		},
		[activeTab, api, ir, board],
	);

	const activeState = checksState[activeTab] ?? checksState.schematic;
	const problemCount = resolveProblemCount(activeState.result, issues);
	const problems = {
		count: problemCount,
		open: checksOpen,
		toggle: toggleChecks,
	};

	return {
		checksState,
		checksOpen,
		runChecks,
		problems,
		handleFocus,
		activeState,
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

function SheetBreadcrumb({ items, canLeave, onJump, onLeave }) {
	return (
		<nav
			style={BREADCRUMB_BAR_STYLE}
			aria-label="Hierarchical sheet navigation"
		>
			<div style={BREADCRUMB_LIST_STYLE}>
				{items.map((it, idx) => {
					const isLast = idx === items.length - 1;
					return (
						<span
							key={it.index}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: "6px",
							}}
						>
							{idx > 0 && <span style={{ color: "#64748b" }}>&gt;</span>}
							<button
								type="button"
								onClick={() => onJump(it.index)}
								style={
									isLast ? BREADCRUMB_CURRENT_STYLE : BREADCRUMB_BUTTON_STYLE
								}
								aria-current={isLast ? "page" : undefined}
							>
								{it.label}
							</button>
						</span>
					);
				})}
			</div>
			<Tooltip title="Leave sheet (Alt+Backspace)">
				<Button
					size="small"
					icon={<LeftOutlined />}
					disabled={!canLeave}
					onClick={onLeave}
					aria-label="Leave sheet (Alt+Backspace)"
				>
					Leave sheet
				</Button>
			</Tooltip>
		</nav>
	);
}

function SchematicViewportTab({
	visible,
	docState,
	fetchers,
	problems,
	sheetNav,
}) {
	return (
		<CanvasTab visible={visible}>
			<div style={SCHEMATIC_VIEWPORT_STYLE}>
				<SheetBreadcrumb
					items={sheetNav.items}
					canLeave={sheetNav.canLeave}
					onJump={sheetNav.jumpTo}
					onLeave={sheetNav.leaveSheet}
				/>
				<div style={SCHEMATIC_CANVAS_HOLDER_STYLE}>
					<SchematicCanvas
						editor={docState.editor}
						fetchSymbol={fetchers.fetchSymbol}
						problems={problems}
						onCursorMove={setCursor}
						onEnterSheet={sheetNav.enterSheet}
					/>
				</div>
			</div>
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
	const {
		activeTab,
		docState,
		curBoard,
		fetchers,
		markers,
		problems,
		sheetNav,
	} = props;
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
				sheetNav={sheetNav}
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

function buildToolState(
	docState,
	activeTab,
	exports = {},
	checksLoading = false,
) {
	return {
		canUndo: docState.canUndo,
		canRedo: docState.canRedo,
		hasSelection: (docState.doc.selection?.length ?? 0) > 0,
		activeTab,
		dirty: docState.dirty,
		exporting: exports.exporting,
		bomLoading: exports.bomLoading,
		netlistLoading: exports.netlistLoading,
		fabLoading: exports.fabLoading,
		checksLoading,
		ir: docState.ir,
		board: docState.board,
	};
}

function EditorBody(props) {
	const { activeTab, ctrl, onOpenLibrary, panelOpen, onTogglePanel, sheetNav } =
		props;
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
				sheetNav={sheetNav}
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

function dispatchModelCommand(dispatch, command) {
	if (!command) return false;
	try {
		const res = dispatch(command);
		const errorMsg = res?.error || (res?.ok === false ? res?.message : null);
		if (errorMsg) {
			message.error(errorMsg);
			return false;
		}
		return true;
	} catch (err) {
		message.error(err?.message || "Command failed");
		return false;
	}
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
	const applyModelCommand = useCallback(
		(cmd) => dispatchModelCommand(dispatch, cmd),
		[dispatch],
	);
	return {
		...editActions,
		undo,
		redo,
		applyModelCommand,
		dispatchCommand: applyModelCommand,
		...extra,
	};
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

function useScreenController(props) {
	const { ir, board, onSave, api, openCommit, symbols, activeTab } = props;
	const docState = useEditorDocument({ ir, board });
	const lib = useLibraryState();
	const fetchers = useCanvasFetchers(api, symbols);
	const { doc, board: curBoard, dispatch } = docState;
	const exports = useDesignExports({ api, ir: doc.ir, board: curBoard });
	const annotate = useAnnotateAction({ ir: doc.ir, dispatch });
	const liveChecks = useLiveChecks({ api, ir: doc.ir, board: curBoard });
	const onBoardToolsChange = useBoardToolsChange(docState);
	const checks = useTabChecks({
		api,
		ir: doc.ir,
		board: curBoard,
		activeTab,
		issues: liveChecks.issues,
	});
	const actions = useScreenActions(docState, onSave, {
		openLibrary: lib.openLibrary,
		...exports,
		annotate,
		onBoardToolsChange,
		openCommit,
		runChecks: checks.runChecks,
	});
	return {
		docState,
		curBoard,
		fetchers,
		lib,
		onPlace: usePlacePartCallback(activeTab),
		onSelectIssue: useIssueSelector(dispatch),
		actions,
		exports,
		liveChecks,
		checks,
	};
}

function DockedChecksPanel({ checks, activeTab }) {
	if (!checks?.checksOpen) return null;
	const isPcb = activeTab === "pcb";
	const state = checks.activeState;
	return (
		<div style={PROBLEMS_PANEL_STYLE}>
			<ChecksPanel
				result={state?.result}
				loading={state?.loading ?? false}
				onRun={() => checks.runChecks(activeTab)}
				onFocus={checks.handleFocus}
				kind={isPcb ? "drc" : "erc"}
			/>
		</div>
	);
}

function EditorPanels(props) {
	const { checks, activeTab, ctrl, api } = props;
	return (
		<>
			<DockedChecksPanel checks={checks} activeTab={activeTab} />
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
	const {
		ctrl,
		activeTab,
		toolState,
		onTabChange,
		panelOpen,
		onTogglePanel,
		sheetNav,
	} = props;
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
				sheetNav={sheetNav}
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

function useEditorScreen(props) {
	const [activeTab, setActiveTab] = useState(
		props.initialTab === "pcb" ? "pcb" : "schematic",
	);
	const sheetNav = useEditorScreenNav(props.ir?.name, activeTab);
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
	const toolState = buildToolState(
		ctrl.docState,
		activeTab,
		ctrl.exports,
		ctrl.checks.activeState?.loading,
	);
	const panel = useCollapsiblePanel(ctrl.docState.doc?.selection);
	return {
		activeTab,
		setActiveTab,
		ctrl,
		toolState,
		commit,
		panel,
		sheetNav,
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
				sheetNav={s.sheetNav}
			/>
			<EditorPanels
				checks={s.ctrl.checks}
				activeTab={s.activeTab}
				ctrl={s.ctrl}
				api={api}
			/>
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
				problems={s.ctrl.checks.problems}
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
