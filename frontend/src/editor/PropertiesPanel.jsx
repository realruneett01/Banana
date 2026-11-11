import { Button, Input } from "antd";
import { useEffect, useState } from "react";

const CORE_FIELDS = ["ref", "value", "footprint", "symbol"];

const PANEL_STYLE = Object.freeze({
	width: "280px",
	minWidth: "260px",
	height: "100%",
	overflowY: "auto",
	background: "#12151c",
	borderLeft: "1px solid #232836",
	padding: "16px",
	color: "#e6e8ee",
});

const PANEL_TITLE_STYLE = Object.freeze({
	fontSize: "14px",
	fontWeight: 700,
	color: "#f1f5f9",
	marginBottom: "12px",
	paddingBottom: "6px",
	borderBottom: "1px solid #232836",
});

const SECTION_HEADER_STYLE = Object.freeze({
	fontSize: "11px",
	fontWeight: 700,
	textTransform: "uppercase",
	letterSpacing: "0.05em",
	color: "#8a91a3",
	marginBottom: "8px",
});

const LABEL_STYLE = Object.freeze({
	display: "block",
	fontSize: "11px",
	fontWeight: 600,
	color: "#8a91a3",
	marginBottom: "3px",
});

const INPUT_STYLE = Object.freeze({
	background: "#181c25",
	borderColor: "#2f3546",
	color: "#e6e8ee",
});

const ROW_STYLE = Object.freeze({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: "8px",
});

const BUTTON_STYLE = Object.freeze({
	background: "#181c25",
	borderColor: "#2f3546",
	color: "#e6e8ee",
});

const STAT_CARD_STYLE = Object.freeze({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: "8px 12px",
	background: "#181c25",
	border: "1px solid #232836",
	borderRadius: "6px",
	marginBottom: "8px",
});

const STAT_LABEL_STYLE = Object.freeze({
	fontSize: "12px",
	color: "#8a91a3",
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
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: "4px 8px",
	background: "#181c25",
	borderRadius: "4px",
	border: "1px solid #232836",
	fontSize: "12px",
});

function EditableField({ id, label, value, onCommit }) {
	const [val, setVal] = useState(value ?? "");
	useEffect(() => {
		setVal(value ?? "");
	}, [value]);

	const commit = () => {
		if (val !== (value ?? "")) onCommit(val);
	};

	return (
		<div style={{ marginBottom: 10 }}>
			<label htmlFor={id} style={LABEL_STYLE}>
				{label}
			</label>
			<Input
				id={id}
				value={val}
				onChange={(e) => setVal(e.target.value)}
				onBlur={commit}
				onPressEnter={commit}
				size="small"
				style={INPUT_STYLE}
				aria-label={label}
			/>
		</div>
	);
}

function CoreFields({ part, dispatch }) {
	return (
		<div style={{ marginTop: 8 }}>
			{CORE_FIELDS.map((field) => (
				<EditableField
					key={field}
					id={`prop-${part.id}-${field}`}
					label={field.toUpperCase()}
					value={part[field] ?? ""}
					onCommit={(next) =>
						dispatch({
							type: "setPartField",
							partId: part.id,
							field,
							value: next,
						})
					}
				/>
			))}
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
	const isBack = part.placement?.side === "B";
	const sideText = isBack ? "Bottom (B)" : "Top (F)";
	return (
		<div style={ROW_STYLE}>
			<span style={LABEL_STYLE}>Side: {sideText}</span>
			<Button
				size="small"
				onClick={() => dispatch({ type: "flipPart", partId: part.id })}
				style={BUTTON_STYLE}
				aria-label="Flip part side"
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
			<RotationRow part={part} dispatch={dispatch} />
			<SideRow part={part} dispatch={dispatch} />
		</div>
	);
}

function CustomProps({ part, dispatch }) {
	const entries = Object.entries(part.props ?? {});
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
			<span style={{ color: "#8a91a3", fontSize: 11 }}>Pin {pins}</span>
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
	return (
		<section aria-label={`Properties for ${part.ref || part.id}`}>
			<div style={PANEL_TITLE_STYLE}>
				Part: {part.ref} {part.value ? `(${part.value})` : ""}
			</div>
			<CoreFields part={part} dispatch={dispatch} />
			<PlacementInfo part={part} dispatch={dispatch} />
			<CustomProps part={part} dispatch={dispatch} />
			<ConnectedNets nets={doc?.ir?.nets} partId={part.id} />
		</section>
	);
}

export default function PropertiesPanel({ doc, dispatch }) {
	const selectedId = doc?.selection?.[0];
	const selectedPart = doc?.ir?.parts?.find((p) => p.id === selectedId);

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
