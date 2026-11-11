import {
	Button,
	Checkbox,
	Input,
	Segmented,
	Slider,
	Space,
	Typography,
} from "antd";
import { useState } from "react";
import { ALL_PCB_LAYERS } from "../utils/diffLayerUtils.js";

const { Title, Text } = Typography;

const DIFF_MODE_OPTIONS = ["Overlay Slider", "Color Delta Map", "Side by Side"];

const LAYER_SELECTOR_STYLE = {
	borderTop: "1px solid #232738",
	paddingTop: "20px",
};

const SEGMENTED_STYLE = {
	marginBottom: "20px",
	background: "#0f1015",
};

const HEADER_CONTAINER_STYLE = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: "8px",
};

const ACTION_BUTTON_STYLE = {
	padding: 0,
	fontSize: "11px",
	color: "#fadb14",
};

const SEARCH_INPUT_STYLE = {
	marginBottom: "10px",
	background: "#0f1015",
	borderColor: "#232738",
};

const LIST_CONTAINER_STYLE = {
	height: "180px",
	overflowY: "auto",
	border: "1px solid #232738",
	borderRadius: "4px",
	padding: "8px 12px",
	background: "#0f1015",
};

const CHECKBOX_GROUP_STYLE = {
	display: "flex",
	flexDirection: "column",
	gap: "4px",
	width: "100%",
};

const EMPTY_FILTER_STYLE = {
	color: "#6b6375",
	textAlign: "center",
	fontSize: "12px",
	padding: "10px 0",
};

const SLIDER_CONTAINER_STYLE = {
	display: "flex",
	alignItems: "center",
	gap: "6px",
	marginTop: "3px",
	paddingLeft: "24px",
};

const SLIDER_BAR_STYLES = {
	track: { background: "#fadb14", height: 2 },
	rail: { background: "#2a2a38", height: 2 },
	handle: { width: 10, height: 10, marginTop: -4 },
};

const SLIDER_PERCENT_STYLE = {
	fontSize: "10px",
	color: "#6b6375",
	width: "30px",
	textAlign: "right",
	flexShrink: 0,
};

const CHECKBOX_STYLE = {
	margin: 0,
	color: "#a6adbb",
	fontSize: "12px",
};

const SOLO_SPAN_STYLE = {
	color: "#fadb14",
	fontSize: "10px",
	marginLeft: "5px",
};

const getRowItemStyle = (isSolo) => ({
	userSelect: "none",
	padding: "3px 6px 4px",
	borderRadius: "4px",
	background: isSolo ? "rgba(250, 219, 20, 0.12)" : "transparent",
	border: isSolo ? "1px dashed #fadb14" : "1px solid transparent",
	cursor: "pointer",
	transition: "all 0.15s ease",
});

function LayerSliderControl({ opacity, onOpacityChange }) {
	const pct = Math.round(opacity * 100);
	const stopProp = (e) => e.stopPropagation();
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: container stops mouse event propagation from slider
		// biome-ignore lint/a11y/useKeyWithClickEvents: container stops mouse event propagation from slider
		<div
			style={SLIDER_CONTAINER_STYLE}
			onClick={stopProp}
			onDoubleClick={stopProp}
		>
			<Slider
				min={0}
				max={100}
				value={pct}
				onChange={onOpacityChange}
				style={{ flex: 1, margin: 0 }}
				tooltip={{ formatter: (v) => `${v}%` }}
				styles={SLIDER_BAR_STYLES}
			/>
			<Text style={SLIDER_PERCENT_STYLE}>{pct}%</Text>
		</div>
	);
}

function LayerLabel({ label, isSolo }) {
	return (
		<>
			{label}
			{isSolo && <span style={SOLO_SPAN_STYLE}>(Soloed)</span>}
		</>
	);
}

function LayerRowItem(props) {
	const { layer, isActive, isSolo, opacity, onDoubleClick, onOpacityChange } =
		props;
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: double click row contains checkbox and slider controls
		<div
			onDoubleClick={onDoubleClick}
			style={getRowItemStyle(isSolo)}
			title="Double click to Solo this layer"
		>
			<Checkbox value={layer.value} style={CHECKBOX_STYLE}>
				<LayerLabel label={layer.label} isSolo={isSolo} />
			</Checkbox>
			{isActive && (
				<LayerSliderControl
					opacity={opacity}
					onOpacityChange={onOpacityChange}
				/>
			)}
		</div>
	);
}

function LayerHeaderTitle() {
	return (
		<div style={{ display: "flex", flexDirection: "column" }}>
			<Title level={5} style={{ color: "#f5f5f5", margin: 0 }}>
				Active Layers (PCB)
			</Title>
			<Text type="secondary" style={{ fontSize: "10px" }}>
				Double click to solo layer
			</Text>
		</div>
	);
}

function LayerHeaderActions({ onSelectAll, onClear }) {
	return (
		<div style={HEADER_CONTAINER_STYLE}>
			<LayerHeaderTitle />
			<Space size="small">
				<Button
					type="link"
					size="small"
					style={ACTION_BUTTON_STYLE}
					onClick={onSelectAll}
				>
					Select All
				</Button>
				<Text type="secondary" style={{ fontSize: "10px" }}>
					|
				</Text>
				<Button
					type="link"
					size="small"
					style={ACTION_BUTTON_STYLE}
					onClick={onClear}
				>
					Clear
				</Button>
			</Space>
		</div>
	);
}

function EmptyFilterMessage() {
	return <div style={EMPTY_FILTER_STYLE}>No layers match filter</div>;
}

function LayerRows({ state, filteredLayers, onDoubleClick, onOpacityChange }) {
	const { selectedLayers, soloLayer, layerOpacities } = state;
	return filteredLayers.map((l) => (
		<LayerRowItem
			key={l.value}
			layer={l}
			isActive={selectedLayers.includes(l.value)}
			isSolo={soloLayer === l.value}
			opacity={layerOpacities[l.value] ?? 1}
			onDoubleClick={() => onDoubleClick(l.value)}
			onOpacityChange={(v) => onOpacityChange(l.value, v)}
		/>
	));
}

function LayerListContainer({
	state,
	filteredLayers,
	onDoubleClick,
	onOpacityChange,
}) {
	return (
		<div style={LIST_CONTAINER_STYLE}>
			<Checkbox.Group
				value={state.selectedLayers}
				onChange={state.setSelectedLayers}
				style={CHECKBOX_GROUP_STYLE}
			>
				<LayerRows
					state={state}
					filteredLayers={filteredLayers}
					onDoubleClick={onDoubleClick}
					onOpacityChange={onOpacityChange}
				/>
				{filteredLayers.length === 0 && <EmptyFilterMessage />}
			</Checkbox.Group>
		</div>
	);
}

function matchesLayerQuery(layer, query) {
	const q = query.toLowerCase();
	return (
		layer.label.toLowerCase().includes(q) ||
		layer.value.toLowerCase().includes(q)
	);
}

function filterLayers(query) {
	if (!query) return ALL_PCB_LAYERS;
	return ALL_PCB_LAYERS.filter((layer) => matchesLayerQuery(layer, query));
}

function toggleSolo(layerValue, state) {
	const { soloLayer, setSoloLayer, selectedLayers, setSelectedLayers } = state;
	if (soloLayer === layerValue) {
		setSoloLayer(null);
		return;
	}
	setSoloLayer(layerValue);
	if (!selectedLayers.includes(layerValue)) {
		setSelectedLayers([...selectedLayers, layerValue]);
	}
}

function DiffModeSelector({ diffMode, setDiffMode }) {
	return (
		<>
			<Title level={5} style={{ color: "#f5f5f5" }}>
				Visual Diff Mode
			</Title>
			<Segmented
				block
				options={DIFF_MODE_OPTIONS}
				value={diffMode}
				onChange={setDiffMode}
				style={SEGMENTED_STYLE}
			/>
		</>
	);
}

function LayerSearchInput({ value, onChange }) {
	return (
		<Input
			placeholder="Search layers..."
			value={value}
			onChange={onChange}
			style={SEARCH_INPUT_STYLE}
			size="small"
		/>
	);
}

function LayerHeader({ diffMode, setDiffMode, setSelectedLayers }) {
	return (
		<>
			<DiffModeSelector diffMode={diffMode} setDiffMode={setDiffMode} />
			<LayerHeaderActions
				onSelectAll={() =>
					setSelectedLayers(ALL_PCB_LAYERS.map((l) => l.value))
				}
				onClear={() => setSelectedLayers([])}
			/>
		</>
	);
}

function LayerMainList({ state, filter, setLayerOpacities }) {
	const onOpacity = (val, v) =>
		setLayerOpacities((prev) => ({ ...prev, [val]: v / 100 }));
	return (
		<LayerListContainer
			state={state}
			filteredLayers={filterLayers(filter)}
			onDoubleClick={(val) => toggleSolo(val, state)}
			onOpacityChange={onOpacity}
		/>
	);
}

function LayerSelectorView({
	diffMode,
	setDiffMode,
	filter,
	setFilter,
	state,
}) {
	return (
		<div style={LAYER_SELECTOR_STYLE}>
			<LayerHeader
				diffMode={diffMode}
				setDiffMode={setDiffMode}
				setSelectedLayers={state.setSelectedLayers}
			/>
			<LayerSearchInput
				value={filter}
				onChange={(e) => setFilter(e.target.value)}
			/>
			<LayerMainList
				state={state}
				filter={filter}
				setLayerOpacities={state.setLayerOpacities}
			/>
		</div>
	);
}

export function LayerSelector({
	diffMode,
	setDiffMode,
	selectedLayers,
	setSelectedLayers,
	soloLayer,
	setSoloLayer,
	layerOpacities,
	setLayerOpacities,
}) {
	const [filter, setFilter] = useState("");
	return (
		<LayerSelectorView
			diffMode={diffMode}
			setDiffMode={setDiffMode}
			filter={filter}
			setFilter={setFilter}
			state={{
				selectedLayers,
				setSelectedLayers,
				soloLayer,
				setSoloLayer,
				layerOpacities,
				setLayerOpacities,
			}}
		/>
	);
}
