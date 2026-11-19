import { Button, Input } from "antd";
import { useEffect, useRef, useState } from "react";

// --- Pure properties helpers ---
export function isValidReference(ref) {
	if (typeof ref !== "string") return false;
	return /^[A-Za-z]+(?:\d+|\?)$/.test(ref.trim());
}

export function isUniqueReference(ref, otherRefs = []) {
	if (typeof ref !== "string") return true;
	const trimmed = ref.trim();
	if (trimmed.endsWith("?")) return true;
	return !otherRefs.includes(trimmed);
}

export function validateReference(ref, otherRefs = []) {
	const trimmed = typeof ref === "string" ? ref.trim() : "";
	if (!isValidReference(trimmed)) {
		return {
			valid: false,
			error: "Reference must be letters followed by digits or ?",
			hint: "",
		};
	}
	const unique = isUniqueReference(trimmed, otherRefs);
	return {
		valid: true,
		error: "",
		isUnique: unique,
		hint: !unique ? "Reference already in use" : "",
	};
}

export function extractOtherRefs(parts, currentPartId) {
	if (!Array.isArray(parts)) return [];
	return parts
		.filter((p) => p && p.id !== currentPartId && typeof p.ref === "string")
		.map((p) => p.ref);
}

const EDITABLE_FIELDS = new Set(["ref", "value", "footprint", "symbol"]);

export function buildFieldEditCommand(partId, field, value) {
	if (!partId || typeof partId !== "string") return null;
	if (!EDITABLE_FIELDS.has(field)) return null;
	if (typeof value !== "string") return null;
	return {
		type: "setPartField",
		partId,
		field,
		value,
	};
}

export function buildFlipCommand(partId) {
	if (!partId || typeof partId !== "string") return null;
	return { type: "flipPart", partId };
}

export function getLayerLabel(side) {
	return side === "B" ? "Bottom (B.Cu)" : "Top (F.Cu)";
}

export function getDatasheetValue(part) {
	if (!part) return "";
	return part.datasheet ?? part.props?.Datasheet ?? part.props?.datasheet ?? "";
}
// --- End pure properties helpers ---

const SURFACE = "#181c25";
const BORDER = "1px solid #232836";
const MUTED = "#8a91a3";
const TEXT = "#e6e8ee";

const PANEL_STYLE = Object.freeze({
	width: "280px",
	minWidth: "260px",
	height: "100%",
	overflowY: "auto",
	background: "#12151c",
	borderLeft: BORDER,
	padding: "16px",
	color: TEXT,
});

const PANEL_TITLE_STYLE = Object.freeze({
	fontSize: "14px",
	fontWeight: 700,
	color: "#f1f5f9",
	marginBottom: "12px",
	paddingBottom: "6px",
	borderBottom: BORDER,
});

const SECTION_HEADER_STYLE = Object.freeze({
	fontSize: "11px",
	fontWeight: 700,
	textTransform: "uppercase",
	letterSpacing: "0.05em",
	color: MUTED,
	marginBottom: "8px",
});

const LABEL_STYLE = Object.freeze({
	display: "block",
	fontSize: "11px",
	fontWeight: 600,
	color: MUTED,
	marginBottom: "3px",
});

const INPUT_STYLE = Object.freeze({
	background: SURFACE,
	borderColor: "#2f3546",
	color: TEXT,
});

const READONLY_INPUT_STYLE = Object.freeze({
	background: "#151820",
	borderColor: "#232836",
	color: MUTED,
	cursor: "default",
});

const READONLY_BADGE_STYLE = Object.freeze({
	color: "#64748b",
	fontWeight: 400,
	fontSize: "10px",
	marginLeft: "4px",
});

const ERROR_STYLE = Object.freeze({
	color: "#f87171",
	fontSize: "11px",
	marginTop: "3px",
});

const WARNING_HINT_STYLE = Object.freeze({
	color: "#f59e0b",
	fontSize: "11px",
	marginTop: "3px",
});

const FLEX_ROW = Object.freeze({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
});

const ROW_STYLE = Object.freeze({ ...FLEX_ROW, marginBottom: "8px" });

const BUTTON_STYLE = INPUT_STYLE;

const STAT_CARD_STYLE = Object.freeze({
	...FLEX_ROW,
	padding: "8px 12px",
	background: SURFACE,
	border: BORDER,
	borderRadius: "6px",
	marginBottom: "8px",
});

const STAT_LABEL_STYLE = Object.freeze({
	fontSize: "12px",
	color: MUTED,
});

const STAT_VALUE_STYLE = Object.freeze({
	fontSize: "14px",
	fontWeight: 700,
	color: "#38bdf8",
});

const HINT_STYLE = Object.freeze({
	fontSize: "12px",
	color: "#5d6476",
	marginTop: "12px",
	lineHeight: "1.4",
});

const NET_ROW_STYLE = Object.freeze({
	...FLEX_ROW,
	padding: "4px 8px",
	background: SURFACE,
	borderRadius: "4px",
	border: BORDER,
	fontSize: "12px",
});

function tryCommit(current, initialValue, validate, onCommit) {
	if (validate) {
		const res = validate(current);
		if (!res.valid) return res.error || "Invalid value";
	}
	if (current !== (initialValue ?? "")) onCommit?.(current);
	return "";
}

function useEditableValue(props) {
	const { value, onCommit, validate, readOnly, dynamicHint } = props;
	const [val, setVal] = useState(value ?? "");
	const [error, setError] = useState("");
	const valRef = useRef(val);
	valRef.current = val;

	useEffect(() => {
		setVal(value ?? "");
		setError("");
	}, [value]);

	const commit = () => {
		if (readOnly) return;
		const err = tryCommit(valRef.current, value, validate, onCommit);
		setError(err);
	};

	const revert = () => {
		valRef.current = value ?? "";
		setVal(value ?? "");
		setError("");
	};

	const hint = dynamicHint ? dynamicHint(val) : "";
	return { val, setVal, error, hint, commit, revert };
}

function FieldFeedback({ error, hint }) {
	if (error) {
		return <div style={ERROR_STYLE}>{error}</div>;
	}
	if (hint) {
		return <div style={WARNING_HINT_STYLE}>{hint}</div>;
	}
	return null;
}

function FieldLabel({ id, label, readOnly }) {
	return (
		<label htmlFor={id} style={LABEL_STYLE}>
			{label}
			{readOnly ? <span style={READONLY_BADGE_STYLE}> (read-only)</span> : null}
		</label>
	);
}

function handleEscape(e, revert) {
	if (e.key === "Escape") {
		revert();
		e.currentTarget.blur();
	}
}

function EditableField(props) {
	const { id, label, readOnly } = props;
	const { val, setVal, error, hint, commit, revert } = useEditableValue(props);

	return (
		<div style={{ marginBottom: 10 }}>
			<FieldLabel id={id} label={label} readOnly={readOnly} />
			<Input
				id={id}
				value={val}
				readOnly={readOnly}
				onChange={(e) => setVal(e.target.value)}
				onBlur={commit}
				onPressEnter={commit}
				onKeyDown={(e) => handleEscape(e, revert)}
				size="small"
				style={readOnly ? READONLY_INPUT_STYLE : INPUT_STYLE}
				aria-label={label}
			/>
			<FieldFeedback error={error} hint={hint} />
		</div>
	);
}

function ReferenceField({ part, otherRefs, dispatch }) {
	return (
		<EditableField
			id={`prop-${part.id}-ref`}
			label="REFERENCE"
			value={part.ref ?? ""}
			validate={(val) => validateReference(val, otherRefs)}
			dynamicHint={(val) => validateReference(val, otherRefs).hint}
			onCommit={(next) => {
				const cmd = buildFieldEditCommand(part.id, "ref", next);
				if (cmd) dispatch(cmd);
			}}
		/>
	);
}

function PartField({ partId, field, label, value, dispatch }) {
	return (
		<EditableField
			id={`prop-${partId}-${field}`}
			label={label}
			value={value ?? ""}
			onCommit={(next) => {
				const cmd = buildFieldEditCommand(partId, field, next);
				if (cmd) dispatch(cmd);
			}}
		/>
	);
}

function CoreFields({ part, otherRefs, dispatch }) {
	return (
		<div style={{ marginTop: 8 }}>
			<ReferenceField part={part} otherRefs={otherRefs} dispatch={dispatch} />
			<PartField
				partId={part.id}
				field="value"
				label="VALUE"
				value={part.value}
				dispatch={dispatch}
			/>
			<PartField
				partId={part.id}
				field="footprint"
				label="FOOTPRINT"
				value={part.footprint}
				dispatch={dispatch}
			/>
			<EditableField
				id={`prop-${part.id}-datasheet`}
				label="DATASHEET"
				value={getDatasheetValue(part)}
				readOnly
			/>
		</div>
	);
}

function PositionRow({ part }) {
	const x = part.placement?.x ?? 0;
	const y = part.placement?.y ?? 0;
	return (
		<div style={ROW_STYLE}>
			<span style={LABEL_STYLE}>
				Position: ({x}, {y})
			</span>
			<span style={{ fontSize: "11px", color: MUTED }}>read-only</span>
		</div>
	);
}

function RotationRow({ part, dispatch }) {
	const rot = part.placement?.rot ?? 0;
	return (
		<div style={ROW_STYLE}>
			<span style={LABEL_STYLE}>Rotation: {rot}°</span>
			<Button
				size="small"
				onClick={() =>
					dispatch({ type: "rotatePart", partId: part.id, deltaDeg: 90 })
				}
				style={BUTTON_STYLE}
				aria-label="Rotate part 90 degrees"
			>
				Rotate (R)
			</Button>
		</div>
	);
}

function SideRow({ part, dispatch }) {
	const layerText = getLayerLabel(part.placement?.side);
	return (
		<div style={ROW_STYLE}>
			<span style={LABEL_STYLE}>Layer: {layerText}</span>
			<Button
				size="small"
				onClick={() => {
					const cmd = buildFlipCommand(part.id);
					if (cmd) dispatch(cmd);
				}}
				style={BUTTON_STYLE}
				aria-label="Flip part layer"
			>
				Flip (F)
			</Button>
		</div>
	);
}

function PlacementInfo({ part, dispatch }) {
	return (
		<div style={{ marginTop: 12 }}>
			<div style={SECTION_HEADER_STYLE}>Placement</div>
			<PositionRow part={part} />
			<RotationRow part={part} dispatch={dispatch} />
			<SideRow part={part} dispatch={dispatch} />
		</div>
	);
}

function CustomProps({ part, dispatch }) {
	const entries = Object.entries(part.props ?? {}).filter(
		([key]) => key.toLowerCase() !== "datasheet",
	);
	if (entries.length === 0) return null;
	return (
		<div style={{ marginTop: 12 }}>
			<div style={SECTION_HEADER_STYLE}>Custom Properties</div>
			{entries.map(([key, val]) => (
				<EditableField
					key={key}
					id={`prop-${part.id}-${key}`}
					label={key}
					value={typeof val === "object" ? JSON.stringify(val) : String(val)}
					onCommit={(next) =>
						dispatch({
							type: "setPartProp",
							partId: part.id,
							key,
							value: next,
						})
					}
				/>
			))}
		</div>
	);
}

function findConnectedNets(nets, partId) {
	return (nets ?? []).filter((net) =>
		net.pins?.some((p) => p.partId === partId),
	);
}

function NetPins({ net, partId }) {
	const pins = net.pins
		.filter((p) => p.partId === partId)
		.map((p) => p.pin)
		.join(", ");
	return (
		<div style={NET_ROW_STYLE}>
			<span style={{ color: "#38bdf8", fontWeight: 600 }}>
				{net.name || net.id}
			</span>
			<span style={{ color: MUTED, fontSize: 11 }}>Pin {pins}</span>
		</div>
	);
}

function ConnectedNets({ nets, partId }) {
	const list = findConnectedNets(nets, partId);
	return (
		<div style={{ marginTop: 12 }}>
			<div style={SECTION_HEADER_STYLE}>Connected Nets</div>
			{list.length === 0 ? (
				<div style={HINT_STYLE}>No connected nets</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
					{list.map((net) => (
						<NetPins key={net.id} net={net} partId={partId} />
					))}
				</div>
			)}
		</div>
	);
}

function BoardSummary({ doc }) {
	const partsCount = doc?.ir?.parts?.length ?? 0;
	const netsCount = doc?.ir?.nets?.length ?? 0;
	return (
		<section aria-label="Board summary">
			<div style={PANEL_TITLE_STYLE}>Board Summary</div>
			<div style={STAT_CARD_STYLE}>
				<span style={STAT_LABEL_STYLE}>Components</span>
				<span style={STAT_VALUE_STYLE}>{partsCount}</span>
			</div>
			<div style={STAT_CARD_STYLE}>
				<span style={STAT_LABEL_STYLE}>Nets</span>
				<span style={STAT_VALUE_STYLE}>{netsCount}</span>
			</div>
			<div style={HINT_STYLE}>
				Select a component in the canvas to inspect its properties, placement,
				and connections.
			</div>
		</section>
	);
}

function SelectedPartDetails({ part, doc, dispatch }) {
	const otherRefs = extractOtherRefs(doc?.ir?.parts, part.id);
	return (
		<section aria-label={`Properties for ${part.ref || part.id}`}>
			<div style={PANEL_TITLE_STYLE}>
				Part: {part.ref} {part.value ? `(${part.value})` : ""}
			</div>
			<CoreFields part={part} otherRefs={otherRefs} dispatch={dispatch} />
			<PlacementInfo part={part} dispatch={dispatch} />
			<CustomProps part={part} dispatch={dispatch} />
			<ConnectedNets nets={doc?.ir?.nets} partId={part.id} />
		</section>
	);
}

export default function PropertiesPanel({ doc, dispatch }) {
	const isSingle = doc?.selection?.length === 1;
	const selectedId = isSingle ? doc.selection[0] : null;
	const selectedPart = selectedId
		? doc?.ir?.parts?.find((p) => p.id === selectedId)
		: null;

	return (
		<aside aria-label="Properties panel" style={PANEL_STYLE}>
			{selectedPart ? (
				<SelectedPartDetails
					part={selectedPart}
					doc={doc}
					dispatch={dispatch}
				/>
			) : (
				<BoardSummary doc={doc} />
			)}
		</aside>
	);
}
