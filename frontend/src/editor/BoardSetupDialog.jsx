import {
	Alert,
	Button,
	Input,
	InputNumber,
	Modal,
	Select,
	Space,
	Table,
	Tabs,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getBoardSetup, validateSetup, withBoardSetup } from "./boardSetup.js";

const LAYER_OPTIONS = [
	{ value: 2, label: "2 layers (F.Cu, B.Cu)" },
	{ value: 4, label: "4 layers (4 copper layers)" },
	{ value: 6, label: "6 layers (6 copper layers)" },
];

const RULE_KEYS = [
	{ key: "minClearance", label: "Minimum clearance (mm)" },
	{ key: "minTrackWidth", label: "Minimum track width (mm)" },
	{ key: "minViaSize", label: "Minimum via size (mm)" },
	{ key: "minViaDrill", label: "Minimum via drill (mm)" },
	{ key: "minDiffPairWidth", label: "Minimum diff pair width (mm)" },
	{ key: "minDiffPairGap", label: "Minimum diff pair gap (mm)" },
];

const FULL_WIDTH = { width: "100%" };
const FIELD_LABEL_STYLE = { marginBottom: 4, fontWeight: 500 };
const SECTION_TITLE_STYLE = { marginBottom: 8, fontWeight: 500 };
const PILL_WRAP_STYLE = {
	display: "flex",
	flexWrap: "wrap",
	gap: 8,
	marginBottom: 8,
};
const PILL_STYLE = {
	display: "flex",
	alignItems: "center",
	gap: 6,
	padding: "4px 8px",
	background: "#f5f5f5",
	borderRadius: 4,
};

function extractNetName(item) {
	if (typeof item === "string") return item;
	return item?.name || item?.id || "";
}

function collectNetNames(items, targetSet) {
	for (const item of items) {
		const name = extractNetName(item);
		if (name) targetSet.add(name);
	}
}

function collectNetIds(items, targetSet) {
	for (const item of items) {
		if (item?.netId) targetSet.add(item.netId);
	}
}

function collectBoardNets(board) {
	if (!board) return [];
	const set = new Set();
	collectNetNames(board.nets || [], set);
	collectNetNames(board.ir?.nets || [], set);
	collectNetIds(board.tracks || [], set);
	collectNetIds(board.vias || [], set);
	collectNetIds(board.zones || [], set);
	return Array.from(set).sort();
}

function BoardTab({ setup, onChange }) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			<div>
				<div style={FIELD_LABEL_STYLE}>Board thickness (mm)</div>
				<InputNumber
					min={0.1}
					max={10}
					step={0.1}
					value={setup.thickness}
					onChange={(val) => onChange({ thickness: val })}
					style={FULL_WIDTH}
				/>
			</div>
			<div>
				<div style={FIELD_LABEL_STYLE}>Copper layers</div>
				<Select
					options={LAYER_OPTIONS}
					value={setup.copperLayers}
					onChange={(val) => onChange({ copperLayers: val })}
					style={FULL_WIDTH}
				/>
			</div>
		</div>
	);
}

function RuleField({ label, value, onChange }) {
	return (
		<div style={{ flex: "1 1 200px" }}>
			<div style={{ marginBottom: 4, fontSize: 13, fontWeight: 500 }}>
				{label}
			</div>
			<InputNumber
				min={0.01}
				step={0.05}
				value={value}
				onChange={onChange}
				style={FULL_WIDTH}
			/>
		</div>
	);
}

function DesignRulesTab({ rules, onChange }) {
	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
			{RULE_KEYS.map((rk) => (
				<RuleField
					key={rk.key}
					label={rk.label}
					value={rules[rk.key]}
					onChange={(val) => onChange({ ...rules, [rk.key]: val })}
				/>
			))}
		</div>
	);
}

function dimCol(title, dataIndex, onUpdate) {
	return {
		title,
		dataIndex,
		key: dataIndex,
		width: 100,
		render: (val, _, idx) => (
			<InputNumber
				min={0.01}
				step={0.05}
				value={val}
				onChange={(v) => onUpdate(idx, { [dataIndex]: v })}
			/>
		),
	};
}

function nameCol(onUpdate) {
	return {
		title: "Class",
		dataIndex: "name",
		key: "name",
		width: 120,
		render: (name, _record, idx) =>
			name === "Default" ? (
				<strong>Default</strong>
			) : (
				<Input
					value={name}
					onChange={(e) => onUpdate(idx, { name: e.target.value })}
				/>
			),
	};
}

function netsCol(netOptions, onUpdate) {
	return {
		title: "Assigned nets",
		dataIndex: "nets",
		key: "nets",
		render: (nets, record, idx) =>
			record.name === "Default" ? (
				<span style={{ color: "#888" }}>All unassigned nets</span>
			) : (
				<Select
					mode="tags"
					style={{ width: "100%", minWidth: 150 }}
					placeholder="Assign nets"
					value={nets ?? []}
					options={netOptions}
					onChange={(val) => onUpdate(idx, { nets: val })}
				/>
			),
	};
}

function actionCol(onRemove) {
	return {
		title: "",
		key: "action",
		width: 80,
		render: (_, record, idx) =>
			record.name === "Default" ? null : (
				<Button danger size="small" onClick={() => onRemove(idx)}>
					Delete
				</Button>
			),
	};
}

function getNetClassColumns(netOptions, onUpdate, onRemove) {
	return [
		nameCol(onUpdate),
		dimCol("Clearance", "clearance", onUpdate),
		dimCol("Track width", "trackWidth", onUpdate),
		dimCol("Via size", "viaSize", onUpdate),
		dimCol("Via drill", "viaDrill", onUpdate),
		dimCol("Diff width", "diffPairWidth", onUpdate),
		dimCol("Diff gap", "diffPairGap", onUpdate),
		netsCol(netOptions, onUpdate),
		actionCol(onRemove),
	];
}

function createNewClass(index, defaultRules) {
	return {
		name: `Class_${index}`,
		clearance: defaultRules.minClearance,
		trackWidth: defaultRules.minTrackWidth,
		viaSize: defaultRules.minViaSize,
		viaDrill: defaultRules.minViaDrill,
		diffPairWidth: defaultRules.minDiffPairWidth,
		diffPairGap: defaultRules.minDiffPairGap,
		nets: [],
	};
}

function useNetClassActions(classes, defaultRules, onChange) {
	const updateClass = useCallback(
		(idx, patch) => {
			onChange(classes.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
		},
		[classes, onChange],
	);
	const removeClass = useCallback(
		(idx) => {
			onChange(classes.filter((_, i) => i !== idx));
		},
		[classes, onChange],
	);
	const addClass = () => {
		onChange([...classes, createNewClass(classes.length, defaultRules)]);
	};
	return { updateClass, removeClass, addClass };
}

function NetClassesTab({ classes, availableNets, defaultRules, onChange }) {
	const netOptions = useMemo(
		() => availableNets.map((n) => ({ label: n, value: n })),
		[availableNets],
	);
	const { updateClass, removeClass, addClass } = useNetClassActions(
		classes,
		defaultRules,
		onChange,
	);
	const columns = useMemo(
		() => getNetClassColumns(netOptions, updateClass, removeClass),
		[netOptions, updateClass, removeClass],
	);
	const dataSource = useMemo(
		() => classes.map((c) => ({ ...c, key: c.name })),
		[classes],
	);

	return (
		<div>
			<Table
				size="small"
				pagination={false}
				dataSource={dataSource}
				columns={columns}
				scroll={{ x: 800 }}
			/>
			<div style={{ marginTop: 12 }}>
				<Button onClick={addClass}>Add net class</Button>
			</div>
		</div>
	);
}

function ItemPill({ label, onRemove }) {
	return (
		<div style={PILL_STYLE}>
			<span>{label}</span>
			<Button type="text" size="small" danger onClick={onRemove}>
				×
			</Button>
		</div>
	);
}

function TrackWidthList({ widths, onRemove }) {
	return (
		<div style={PILL_WRAP_STYLE}>
			{widths.map((w) => (
				<ItemPill
					key={`width-${w}`}
					label={`${w} mm`}
					onRemove={() => onRemove(w)}
				/>
			))}
		</div>
	);
}

function TrackWidthsEditor({ widths, onChange }) {
	const [newWidth, setNewWidth] = useState(0.25);
	const add = () => {
		if (newWidth > 0 && !widths.includes(newWidth)) {
			onChange([...widths, newWidth].sort((a, b) => a - b));
		}
	};
	return (
		<div style={{ marginBottom: 20 }}>
			<div style={SECTION_TITLE_STYLE}>Predefined track widths (mm)</div>
			<TrackWidthList
				widths={widths}
				onRemove={(w) => onChange(widths.filter((x) => x !== w))}
			/>
			<Space>
				<InputNumber
					min={0.05}
					step={0.05}
					value={newWidth}
					onChange={setNewWidth}
				/>
				<Button onClick={add}>Add track width</Button>
			</Space>
		</div>
	);
}

function ViaSizeList({ viaSizes, onRemove }) {
	return (
		<div style={PILL_WRAP_STYLE}>
			{viaSizes.map((v, idx) => (
				<ItemPill
					key={`via-${v.size}-${v.drill}`}
					label={`Size: ${v.size} mm / Drill: ${v.drill} mm`}
					onRemove={() => onRemove(idx)}
				/>
			))}
		</div>
	);
}

function ViaSizeInputs({ values, onChange, onAdd }) {
	return (
		<Space>
			<InputNumber
				placeholder="Via size"
				min={0.1}
				step={0.1}
				value={values.size}
				onChange={(val) => onChange({ ...values, size: val })}
			/>
			<InputNumber
				placeholder="Via drill"
				min={0.05}
				step={0.05}
				value={values.drill}
				onChange={(val) => onChange({ ...values, drill: val })}
			/>
			<Button onClick={onAdd}>Add via size</Button>
		</Space>
	);
}

function ViaSizesEditor({ viaSizes, onChange }) {
	const [newVia, setNewVia] = useState({ size: 0.6, drill: 0.3 });
	const add = () => {
		if (newVia.size > 0 && newVia.drill > 0) {
			onChange([...viaSizes, { ...newVia }]);
		}
	};
	return (
		<div>
			<div style={SECTION_TITLE_STYLE}>Predefined via sizes (mm)</div>
			<ViaSizeList
				viaSizes={viaSizes}
				onRemove={(idx) => onChange(viaSizes.filter((_, i) => i !== idx))}
			/>
			<ViaSizeInputs values={newVia} onChange={setNewVia} onAdd={add} />
		</div>
	);
}

function SizesTab({
	trackWidths,
	viaSizes,
	onChangeTrackWidths,
	onChangeViaSizes,
}) {
	return (
		<div>
			<TrackWidthsEditor widths={trackWidths} onChange={onChangeTrackWidths} />
			<ViaSizesEditor viaSizes={viaSizes} onChange={onChangeViaSizes} />
		</div>
	);
}

function ProblemsAlert({ problems }) {
	if (!problems || problems.length === 0) return null;
	return (
		<Alert
			type="error"
			showIcon
			message="Design rule problems"
			description={
				<ul style={{ margin: 0, paddingLeft: 20 }}>
					{problems.map((p) => (
						<li key={p}>{p}</li>
					))}
				</ul>
			}
			style={{ marginBottom: 16 }}
		/>
	);
}

function createBoardTabItem(draft, setDraft) {
	return {
		key: "board",
		label: "Board",
		children: (
			<BoardTab
				setup={draft}
				onChange={(p) => setDraft((prev) => ({ ...prev, ...p }))}
			/>
		),
	};
}

function createRulesTabItem(draft, setDraft) {
	return {
		key: "rules",
		label: "Design rules",
		children: (
			<DesignRulesTab
				rules={draft.designRules}
				onChange={(r) => setDraft((prev) => ({ ...prev, designRules: r }))}
			/>
		),
	};
}

function createNetClassesTabItem(draft, setDraft, availableNets) {
	return {
		key: "netClasses",
		label: "Net classes",
		children: (
			<NetClassesTab
				classes={draft.netClasses}
				availableNets={availableNets}
				defaultRules={draft.designRules}
				onChange={(c) => setDraft((prev) => ({ ...prev, netClasses: c }))}
			/>
		),
	};
}

function createSizesTabItem(draft, setDraft) {
	return {
		key: "sizes",
		label: "Track and via sizes",
		children: (
			<SizesTab
				trackWidths={draft.trackWidths}
				viaSizes={draft.viaSizes}
				onChangeTrackWidths={(w) =>
					setDraft((prev) => ({ ...prev, trackWidths: w }))
				}
				onChangeViaSizes={(v) => setDraft((prev) => ({ ...prev, viaSizes: v }))}
			/>
		),
	};
}

function buildTabItems({ draft, setDraft, availableNets }) {
	return [
		createBoardTabItem(draft, setDraft),
		createRulesTabItem(draft, setDraft),
		createNetClassesTabItem(draft, setDraft, availableNets),
		createSizesTabItem(draft, setDraft),
	];
}

function useBoardSetupDraft(board, open) {
	const [draft, setDraft] = useState(() => getBoardSetup(board));
	const [activeTab, setActiveTab] = useState("board");

	useEffect(() => {
		if (open) {
			setDraft(getBoardSetup(board));
			setActiveTab("board");
		}
	}, [open, board]);

	return { draft, setDraft, activeTab, setActiveTab };
}

export function BoardSetupDialog({ open, board, onSave, onCancel }) {
	const { draft, setDraft, activeTab, setActiveTab } = useBoardSetupDraft(
		board,
		open,
	);
	const problems = useMemo(() => validateSetup(draft), [draft]);
	const availableNets = useMemo(() => collectBoardNets(board), [board]);
	const handleSave = useCallback(() => {
		if (problems.length === 0) onSave?.(withBoardSetup(board, draft));
	}, [board, draft, problems, onSave]);
	const tabItems = useMemo(
		() => buildTabItems({ draft, setDraft, availableNets }),
		[draft, setDraft, availableNets],
	);

	return (
		<Modal
			open={open}
			title="Board Setup"
			width={820}
			onOk={handleSave}
			onCancel={onCancel}
			okText="Save"
			okButtonProps={{ disabled: problems.length > 0 }}
		>
			<ProblemsAlert problems={problems} />
			<Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
		</Modal>
	);
}

export default BoardSetupDialog;
