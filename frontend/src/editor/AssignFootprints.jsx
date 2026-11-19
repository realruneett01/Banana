import {
	Alert,
	Button,
	Input,
	Modal,
	Space,
	Table,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	assignmentsToCommand,
	searchFootprints,
	suggestFootprintQuery,
} from "./footprintAssign.js";

const INLINE_CONTAINER_STYLE = Object.freeze({
	height: "100%",
	display: "flex",
	flexDirection: "column",
	padding: 12,
	background: "var(--bn-bg-surface, #161922)",
});

const ACTION_TOOLBAR_STYLE = Object.freeze({
	marginBottom: 12,
});

const TWO_COLUMN_STYLE = Object.freeze({
	display: "flex",
	gap: 16,
	minHeight: 380,
	flex: 1,
});

const PANE_STYLE = Object.freeze({
	flex: 1,
	display: "flex",
	flexDirection: "column",
	gap: 10,
	minWidth: 0,
});

const SCROLL_Y = Object.freeze({ y: 300 });
const INLINE_TABLE_SCROLL = Object.freeze({ y: "calc(100vh - 220px)" });

function renderStatusTag(status) {
	const color = status === "Set" ? "green" : "volcano";
	return <Tag color={color}>{status}</Tag>;
}

const PARTS_COLUMNS = [
	{ title: "Ref", dataIndex: "ref", width: 65 },
	{ title: "Value", dataIndex: "value", width: 90, ellipsis: true },
	{ title: "Footprint", dataIndex: "footprint", ellipsis: true },
	{
		title: "Status",
		dataIndex: "status",
		width: 80,
		render: renderStatusTag,
	},
];

function parseLib(libId) {
	if (typeof libId !== "string") return "";
	const colon = libId.indexOf(":");
	return colon !== -1 ? libId.slice(0, colon) : "";
}

const RESULT_COLUMNS = [
	{ title: "Name", dataIndex: "name", ellipsis: true },
	{
		title: "Library",
		dataIndex: "libId",
		width: 140,
		ellipsis: true,
		render: (id, record) => record.library || parseLib(id),
	},
	{ title: "Description", dataIndex: "description", ellipsis: true },
];

function buildPartRows(irParts, assignments) {
	return (irParts || []).map((part) => {
		const assigned = assignments[part.id];
		const current = assigned !== undefined ? assigned : part.footprint || "";
		const isSet = Boolean(current && current.trim() !== "");
		return {
			key: part.id,
			id: part.id,
			ref: part.ref || "",
			value: part.value || "",
			footprint: current,
			status: isSet ? "Set" : "Missing",
			rawPart: part,
		};
	});
}

async function findTopFootprint(part, fetchOpts) {
	const q = suggestFootprintQuery(part);
	if (!q) return null;
	try {
		const res = await searchFootprints(q, { ...fetchOpts, limit: 1 });
		return res && res.length > 0 ? res[0].libId || res[0].name : null;
	} catch (_err) {
		return null;
	}
}

async function fillMissingSuggestions(parts, assignments, fetchOpts) {
	const next = { ...assignments };
	for (const p of parts) {
		const cur = next[p.id] !== undefined ? next[p.id] : p.footprint || "";
		if (cur && cur.trim() !== "") continue;
		const top = await findTopFootprint(p, fetchOpts);
		if (top) {
			next[p.id] = top;
		}
	}
	return next;
}

function PartsPane({ rows, selectedId, onSelectPart, scroll }) {
	return (
		<div style={PANE_STYLE}>
			<Typography.Text strong>Schematic Parts</Typography.Text>
			<Table
				dataSource={rows}
				columns={PARTS_COLUMNS}
				size="small"
				pagination={false}
				scroll={scroll || SCROLL_Y}
				rowKey="id"
				onRow={(record) => ({
					onClick: () => onSelectPart(record),
					style: {
						cursor: "pointer",
						background: record.id === selectedId ? "#1e293b" : undefined,
					},
				})}
			/>
		</div>
	);
}

function formatResultsHeader(part) {
	if (!part) return "Footprints (select a part)";
	return `Footprints for ${part.ref} (${part.value || "no value"})`;
}

function ResultsPane({ selectedPart, search, onAssign, scroll }) {
	return (
		<div style={PANE_STYLE}>
			<Typography.Text strong>
				{formatResultsHeader(selectedPart)}
			</Typography.Text>
			<Input.Search
				placeholder="Search footprints..."
				value={search.query}
				onChange={(e) => search.setQuery(e.target.value)}
				onSearch={search.handleSearch}
				loading={search.loading}
				allowClear
				disabled={!selectedPart}
			/>
			{search.error && <Alert type="warning" message={search.error} showIcon />}
			<Table
				dataSource={search.results}
				columns={RESULT_COLUMNS}
				size="small"
				pagination={false}
				scroll={scroll || SCROLL_Y}
				loading={search.loading}
				rowKey="libId"
				onRow={(record) => ({
					onDoubleClick: () => onAssign(record.libId || record.name),
					style: { cursor: "pointer" },
				})}
			/>
		</div>
	);
}

function ModalFooter({ onApplyAll, applyingAll, onApply, onClose }) {
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
			}}
		>
			<Button onClick={onApplyAll} loading={applyingAll}>
				Apply all suggestions
			</Button>
			<Space>
				<Button onClick={onClose}>Cancel</Button>
				<Button type="primary" onClick={onApply}>
					Apply
				</Button>
			</Space>
		</div>
	);
}

function useFootprintSearch({ baseUrl, fetchImpl }) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");

	const handleSearch = useCallback(
		async (q) => {
			const trimmed = q?.trim();
			if (!trimmed) {
				setResults([]);
				return;
			}
			setLoading(true);
			setError("");
			try {
				const list = await searchFootprints(trimmed, { baseUrl, fetchImpl });
				setResults(list);
			} catch (err) {
				setError(err.message || "Failed to search footprints");
				setResults([]);
			} finally {
				setLoading(false);
			}
		},
		[baseUrl, fetchImpl],
	);

	return { query, setQuery, results, setResults, loading, error, handleSearch };
}

function useApplyActions({
	ir,
	assignments,
	setAssignments,
	baseUrl,
	fetchImpl,
	onApply,
	onClose,
}) {
	const [applyingAll, setApplyingAll] = useState(false);

	const handleApplyAll = useCallback(async () => {
		setApplyingAll(true);
		try {
			const filled = await fillMissingSuggestions(
				ir?.parts || [],
				assignments,
				{ baseUrl, fetchImpl },
			);
			setAssignments(filled);
		} finally {
			setApplyingAll(false);
		}
	}, [ir?.parts, assignments, baseUrl, fetchImpl, setAssignments]);

	const handleApply = useCallback(() => {
		onApply?.(assignmentsToCommand(assignments));
		onClose?.();
	}, [assignments, onApply, onClose]);

	return { applyingAll, handleApplyAll, handleApply };
}

function usePartSelection({ ir, open, inline, search, assignments }) {
	const [selectedId, setSelectedId] = useState("");

	const rows = useMemo(
		() => buildPartRows(ir?.parts, assignments),
		[ir?.parts, assignments],
	);

	const selectedPart = useMemo(
		() => rows.find((r) => r.id === selectedId)?.rawPart ?? null,
		[rows, selectedId],
	);

	const handleSelectPart = useCallback(
		(row) => {
			setSelectedId(row.id);
			const suggested = suggestFootprintQuery(row.rawPart);
			search.setQuery(suggested);
			search.handleSearch(suggested);
		},
		[search],
	);

	useEffect(() => {
		if (!open && !inline) return;
		const first = ir?.parts?.[0];
		if (first) {
			setSelectedId(first.id);
			const q = suggestFootprintQuery(first);
			search.setQuery(q);
			search.handleSearch(q);
		} else {
			setSelectedId("");
			search.setQuery("");
			search.setResults([]);
		}
	}, [
		open,
		inline,
		ir,
		search.handleSearch,
		search.setQuery,
		search.setResults,
	]);

	return { rows, selectedId, selectedPart, handleSelectPart };
}

function useAssignFootprintsController(props) {
	const {
		open,
		inline = false,
		ir,
		onApply,
		onClose,
		baseUrl,
		fetchImpl,
	} = props;
	const [assignments, setAssignments] = useState({});
	const search = useFootprintSearch({ baseUrl, fetchImpl });
	const parts = usePartSelection({ ir, open, inline, search, assignments });
	const apply = useApplyActions({
		ir,
		assignments,
		setAssignments,
		baseUrl,
		fetchImpl,
		onApply,
		onClose,
	});

	useEffect(() => {
		if (open || inline) setAssignments({});
	}, [open, inline]);

	const handleAssign = useCallback(
		(fp) => {
			if (!parts.selectedId || !fp) return;
			setAssignments((prev) => ({ ...prev, [parts.selectedId]: fp }));
		},
		[parts.selectedId],
	);

	return { parts, search, apply, handleAssign };
}

function FootprintsPanes({ ctrl, scroll }) {
	return (
		<div style={TWO_COLUMN_STYLE}>
			<PartsPane
				rows={ctrl.parts.rows}
				selectedId={ctrl.parts.selectedId}
				onSelectPart={ctrl.parts.handleSelectPart}
				scroll={scroll}
			/>
			<ResultsPane
				selectedPart={ctrl.parts.selectedPart}
				search={ctrl.search}
				onAssign={ctrl.handleAssign}
				scroll={scroll}
			/>
		</div>
	);
}

export function AssignFootprints(props) {
	const { open, inline = false, onClose } = props;
	const ctrl = useAssignFootprintsController(props);
	const scroll = inline ? INLINE_TABLE_SCROLL : SCROLL_Y;
	const panes = <FootprintsPanes ctrl={ctrl} scroll={scroll} />;
	const footer = (
		<ModalFooter
			onApplyAll={ctrl.apply.handleApplyAll}
			applyingAll={ctrl.apply.applyingAll}
			onApply={ctrl.apply.handleApply}
			onClose={onClose}
		/>
	);

	if (inline) {
		return (
			<div style={INLINE_CONTAINER_STYLE}>
				<div style={ACTION_TOOLBAR_STYLE}>{footer}</div>
				{panes}
			</div>
		);
	}

	return (
		<Modal
			open={open}
			onCancel={onClose}
			title="Assign Footprints"
			width={840}
			footer={footer}
		>
			{panes}
		</Modal>
	);
}

export default AssignFootprints;
