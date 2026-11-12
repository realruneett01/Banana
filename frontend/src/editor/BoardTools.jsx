import { BorderOutlined, SyncOutlined } from "@ant-design/icons";
import {
	Button,
	Checkbox,
	InputNumber,
	Modal,
	message,
	Select,
	Space,
	Tooltip,
} from "antd";
import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import { outlineToPolygon, polygonBBox } from "./boardOutline.js";
import { removeOrphans, syncBoardFromIr } from "./syncModel.js";
import { addZone, rectZonePoints, validateZone } from "./zoneModel.js";

const EMPTY_BOARD = Object.freeze({
	outline: null,
	tracks: [],
	vias: [],
	zones: [],
});

const LAYER_OPTIONS = [
	{ value: "F.Cu", label: "F.Cu" },
	{ value: "B.Cu", label: "B.Cu" },
];

const DEFAULT_OUTLINE_TOOL = Object.freeze({
	activeTool: null,
	radius: 1,
});

let outlineToolState = DEFAULT_OUTLINE_TOOL;
const outlineListeners = new Set();

function notifyOutlineTool() {
	for (const listener of outlineListeners) {
		listener(outlineToolState);
	}
}

export function getOutlineTool() {
	return outlineToolState;
}

export function subscribeOutlineTool(listener) {
	outlineListeners.add(listener);
	return () => {
		outlineListeners.delete(listener);
	};
}

export function setOutlineTool(patch) {
	const next = typeof patch === "function" ? patch(outlineToolState) : patch;
	outlineToolState = { ...outlineToolState, ...next };
	notifyOutlineTool();
}

export function useOutlineTool() {
	return useSyncExternalStore(subscribeOutlineTool, getOutlineTool);
}

function getSafeBoard(board) {
	if (!board) return EMPTY_BOARD;
	return {
		outline: board.outline ?? null,
		tracks: Array.isArray(board.tracks) ? board.tracks : [],
		vias: Array.isArray(board.vias) ? board.vias : [],
		zones: Array.isArray(board.zones) ? board.zones : [],
	};
}

function getPoint(pt) {
	const x = Array.isArray(pt) ? pt[0] : pt?.x;
	const y = Array.isArray(pt) ? pt[1] : pt?.y;
	if (typeof x !== "number" || !Number.isFinite(x)) return null;
	if (typeof y !== "number" || !Number.isFinite(y)) return null;
	return [x, y];
}

function getShapeBounds(outline) {
	const res = outlineToPolygon(outline);
	if (!res.ok) return null;
	const b = polygonBBox(res.polygon);
	return [
		[b.minX, b.minY],
		[b.maxX, b.maxY],
	];
}

function getPointsBounds(outline) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const pt of outline) {
		const coords = getPoint(pt);
		if (!coords) continue;
		minX = Math.min(minX, coords[0]);
		maxX = Math.max(maxX, coords[0]);
		minY = Math.min(minY, coords[1]);
		maxY = Math.max(maxY, coords[1]);
	}
	if (!Number.isFinite(minX) || minX >= maxX || minY >= maxY) return null;
	return [
		[minX, minY],
		[maxX, maxY],
	];
}

function getOutlineBounds(outline) {
	if (!Array.isArray(outline) || outline.length < 3) return null;
	if (outline[0]?.type) return getShapeBounds(outline);
	return getPointsBounds(outline);
}

function getPartsBounds(parts, margin = 5) {
	if (!Array.isArray(parts) || parts.length === 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let found = false;
	for (const p of parts) {
		const coords = getPoint(p?.placement);
		if (!coords) continue;
		found = true;
		minX = Math.min(minX, coords[0]);
		maxX = Math.max(maxX, coords[0]);
		minY = Math.min(minY, coords[1]);
		maxY = Math.max(maxY, coords[1]);
	}
	if (!found) return null;
	return [
		[minX - margin, minY - margin],
		[maxX + margin, maxY + margin],
	];
}

function getPourBounds(board, ir) {
	const outlineBounds = getOutlineBounds(board?.outline);
	if (outlineBounds) return outlineBounds;
	return getPartsBounds(ir?.parts, 5);
}

function getDefaultNetId(nets) {
	if (!Array.isArray(nets) || nets.length === 0) return "";
	const gnd = nets.find((n) => {
		const label = n?.name || n?.id;
		return typeof label === "string" && label.toLowerCase() === "gnd";
	});
	if (gnd) return gnd.id ?? gnd.name ?? "";
	const first = nets[0];
	return first?.id ?? first?.name ?? "";
}

function hasOrphans(report) {
	if (!report) return false;
	const t = report.orphanTracks?.length ?? 0;
	const v = report.orphanVias?.length ?? 0;
	const z = report.orphanZones?.length ?? 0;
	return t > 0 || v > 0 || z > 0;
}

function SyncReportContent({ report }) {
	if (!report) return null;
	const placed = report.placed?.length ?? 0;
	const tracks = report.orphanTracks?.length ?? 0;
	const vias = report.orphanVias?.length ?? 0;
	const zones = report.orphanZones?.length ?? 0;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
			<p>{report.summary}</p>
			<ul style={{ margin: 0, paddingLeft: "20px" }}>
				<li>Newly placed parts: {placed}</li>
				<li>Orphan tracks: {tracks}</li>
				<li>Orphan vias: {vias}</li>
				<li>Orphan zones: {zones}</li>
			</ul>
		</div>
	);
}

function SyncModalFooter({ onCancel, onApply, onApplyRemove, canRemove }) {
	return (
		<Space>
			<Button onClick={onCancel}>Cancel</Button>
			{canRemove && (
				<Button onClick={onApplyRemove}>Apply and remove leftovers</Button>
			)}
			<Button type="primary" onClick={onApply}>
				Apply
			</Button>
		</Space>
	);
}

function SyncModal({ open, result, onCancel, onApply, onApplyRemove }) {
	return (
		<Modal
			open={open}
			title="Update PCB from schematic"
			onCancel={onCancel}
			footer={
				<SyncModalFooter
					onCancel={onCancel}
					onApply={onApply}
					onApplyRemove={onApplyRemove}
					canRemove={hasOrphans(result?.report)}
				/>
			}
		>
			<SyncReportContent report={result?.report} />
		</Modal>
	);
}

function PourModalContent({
	netOptions,
	selectedNet,
	onNetChange,
	selectedLayer,
	onLayerChange,
	keepout,
	onKeepoutChange,
}) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "12px",
				marginTop: "16px",
			}}
		>
			<div>
				<label
					htmlFor="net-select"
					style={{ display: "block", marginBottom: "4px" }}
				>
					Net:
				</label>
				<Select
					id="net-select"
					style={{ width: "100%" }}
					options={netOptions}
					value={selectedNet || undefined}
					placeholder="Select net"
					onChange={onNetChange}
					disabled={keepout}
				/>
			</div>
			<div>
				<label
					htmlFor="layer-select"
					style={{ display: "block", marginBottom: "4px" }}
				>
					Layer:
				</label>
				<Select
					id="layer-select"
					style={{ width: "100%" }}
					options={LAYER_OPTIONS}
					value={selectedLayer}
					onChange={onLayerChange}
				/>
			</div>
			<Checkbox checked={keepout} onChange={onKeepoutChange}>
				Keep-out area (no copper)
			</Checkbox>
		</div>
	);
}

function PourModal({ open, onCancel, onOk, formProps }) {
	return (
		<Modal
			open={open}
			title="Add copper pour"
			onCancel={onCancel}
			onOk={onOk}
			okText="OK"
			cancelText="Cancel"
		>
			<PourModalContent {...formProps} />
		</Modal>
	);
}

function buildPourZone({ board, ir, net, layer, keepout }) {
	const bounds = getPourBounds(board, ir);
	if (!bounds) return { error: "Requires board outline or placed parts" };
	const points = rectZonePoints(bounds[0], bounds[1]);
	const safe = getSafeBoard(board);
	const updated = addZone(safe, {
		netId: keepout ? "" : net,
		layer,
		points,
		keepout,
	});
	const newZone = updated.zones?.[updated.zones.length - 1];
	const problem = validateZone(newZone);
	if (problem) return { error: problem };
	return { board: updated };
}

function ToolButton({ title, icon, disabled, onClick, ariaLabel, text }) {
	return (
		<Tooltip title={title}>
			<Button
				icon={icon}
				disabled={disabled}
				onClick={onClick}
				size="small"
				aria-label={ariaLabel || title}
			>
				{text}
			</Button>
		</Tooltip>
	);
}

function useBoardSync({ ir, board, onChange }) {
	const [result, setResult] = useState(null);
	const [open, setOpen] = useState(false);
	const onUpdate = useCallback(() => {
		const safe = getSafeBoard(board);
		const syncRes = syncBoardFromIr(ir, safe);
		if (syncRes.report.inSync) {
			message.info(syncRes.report.summary);
			return;
		}
		setResult(syncRes);
		setOpen(true);
	}, [ir, board]);
	const close = useCallback(() => setOpen(false), []);
	const apply = useCallback(() => {
		onChange?.({ ir: result?.ir, board: result?.board });
		close();
	}, [result, onChange, close]);
	const applyRemove = useCallback(() => {
		const nextBoard = removeOrphans(result?.board, result?.report);
		onChange?.({ ir: result?.ir, board: nextBoard });
		close();
	}, [result, onChange, close]);
	return { result, open, onUpdate, close, apply, applyRemove };
}

function useCopperPour({ board, ir, onChange }) {
	const [open, setOpen] = useState(false);
	const [net, setNet] = useState("");
	const [layer, setLayer] = useState("B.Cu");
	const [keepout, setKeepout] = useState(false);
	const defaultNet = useMemo(() => getDefaultNetId(ir?.nets), [ir?.nets]);
	const onOpen = useCallback(() => {
		setNet(defaultNet);
		setLayer("B.Cu");
		setKeepout(false);
		setOpen(true);
	}, [defaultNet]);
	const close = useCallback(() => setOpen(false), []);
	const submit = useCallback(() => {
		const res = buildPourZone({ board, ir, net, layer, keepout });
		if (res.error) {
			message.error(res.error);
			return;
		}
		onChange?.({ board: res.board });
		message.success("Copper pour added");
		close();
	}, [board, ir, net, layer, keepout, onChange, close]);
	return {
		open,
		net,
		setNet,
		layer,
		setLayer,
		keepout,
		setKeepout,
		onOpen,
		close,
		submit,
	};
}

function SyncAction({ disabled, sync }) {
	return (
		<>
			<ToolButton
				title="Update PCB from schematic"
				icon={<SyncOutlined />}
				disabled={disabled}
				onClick={sync.onUpdate}
				ariaLabel="Update PCB from schematic"
				text="Update PCB from schematic"
			/>
			<SyncModal
				open={sync.open}
				result={sync.result}
				onCancel={sync.close}
				onApply={sync.apply}
				onApplyRemove={sync.applyRemove}
			/>
		</>
	);
}

function PourAction({ disabled, pour, board, ir }) {
	const canPour = Boolean(getPourBounds(board, ir));
	const pourTooltip = canPour
		? "Add copper pour"
		: "Add copper pour: requires board outline or placed parts";
	const netOptions = useMemo(
		() =>
			(ir?.nets ?? []).map((n) => ({
				value: n.id ?? n.name,
				label: n.name || n.id,
			})),
		[ir?.nets],
	);
	return (
		<>
			<ToolButton
				title={pourTooltip}
				icon={<BorderOutlined />}
				disabled={disabled || !canPour}
				onClick={pour.onOpen}
				ariaLabel="Add copper pour"
				text="Add copper pour"
			/>
			<PourModal
				open={pour.open}
				onCancel={pour.close}
				onOk={pour.submit}
				formProps={{
					netOptions,
					selectedNet: pour.net,
					onNetChange: pour.setNet,
					selectedLayer: pour.layer,
					onLayerChange: pour.setLayer,
					keepout: pour.keepout,
					onKeepoutChange: (e) => pour.setKeepout(e.target.checked),
				}}
			/>
		</>
	);
}

function OutlineRectButton({ disabled, active, onClick }) {
	return (
		<Tooltip title="Draw rectangle board outline">
			<Button
				size="small"
				type={active ? "primary" : "default"}
				disabled={disabled}
				onClick={onClick}
				aria-label="Rectangle board outline"
			>
				Rectangle
			</Button>
		</Tooltip>
	);
}

function OutlineRoundedButton({ disabled, active, onClick }) {
	return (
		<Tooltip title="Draw rounded rectangle board outline">
			<Button
				size="small"
				type={active ? "primary" : "default"}
				disabled={disabled}
				onClick={onClick}
				aria-label="Rounded rectangle board outline"
			>
				Rounded rectangle
			</Button>
		</Tooltip>
	);
}

function OutlineRadiusInput({ disabled, value, onChange }) {
	return (
		<Tooltip title="Corner radius (default 1 mm)">
			<InputNumber
				size="small"
				min={0.1}
				step={0.5}
				value={value}
				disabled={disabled}
				onChange={onChange}
				style={{ width: 60 }}
				aria-label="Corner radius"
			/>
		</Tooltip>
	);
}

function OutlineToolGroup({ disabled, toolState }) {
	const { activeTool, radius } = toolState;
	const toggleRect = useCallback(() => {
		setOutlineTool((s) => ({
			...s,
			activeTool: s.activeTool === "rect" ? null : "rect",
		}));
	}, []);
	const toggleRounded = useCallback(() => {
		setOutlineTool((s) => ({
			...s,
			activeTool: s.activeTool === "rounded_rect" ? null : "rounded_rect",
		}));
	}, []);
	const handleRadiusChange = useCallback((val) => {
		setOutlineTool((s) => ({ ...s, radius: Number(val) || 1 }));
	}, []);

	return (
		<Space size={4} aria-label="Board outline">
			<span style={{ fontSize: "12px", color: "#8a91a3" }}>Board outline:</span>
			<OutlineRectButton
				disabled={disabled}
				active={activeTool === "rect"}
				onClick={toggleRect}
			/>
			<OutlineRoundedButton
				disabled={disabled}
				active={activeTool === "rounded_rect"}
				onClick={toggleRounded}
			/>
			<OutlineRadiusInput
				disabled={disabled}
				value={radius}
				onChange={handleRadiusChange}
			/>
		</Space>
	);
}

export default function BoardTools({ ir, board, onChange, disabled }) {
	const sync = useBoardSync({ ir, board, onChange });
	const pour = useCopperPour({ board, ir, onChange });
	const toolState = useOutlineTool();

	useEffect(() => {
		if (disabled && toolState.activeTool) {
			setOutlineTool({ activeTool: null });
		}
	}, [disabled, toolState.activeTool]);

	return (
		<Space size={4}>
			<SyncAction disabled={disabled} sync={sync} />
			<PourAction disabled={disabled} pour={pour} board={board} ir={ir} />
			<OutlineToolGroup disabled={disabled} toolState={toolState} />
		</Space>
	);
}
