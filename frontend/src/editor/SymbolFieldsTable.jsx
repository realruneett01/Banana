import { Checkbox, Input, Modal, Table } from "antd";
import { useCallback, useMemo, useState } from "react";
import { buildRows, editsToCommand } from "./fieldsTable.js";

const TOOLBAR_STYLE = Object.freeze({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: 12,
});

const EDITABLE_COLUMNS = Object.freeze([
	{ field: "value", title: "Value" },
	{ field: "footprint", title: "Footprint" },
	{ field: "datasheet", title: "Datasheet" },
]);

function matchesEdit(e, key, field) {
	return e.key === key && e.field === field;
}

function recordPendingEdit(prevEdits, row, field, value) {
	const filtered = prevEdits.filter((e) => !matchesEdit(e, row.key, field));
	const editItem = {
		key: row.key,
		rowKey: row.key,
		refs: row.refs,
		partIds: row.partIds,
		field,
		value,
	};
	return [...filtered, editItem];
}

function testRefMatch(refs, lower) {
	return (refs ?? []).some((r) => r.toLowerCase().includes(lower));
}

function testCustomMatch(custom, lower) {
	return Object.values(custom ?? {}).some((v) =>
		String(v).toLowerCase().includes(lower),
	);
}

function matchesSearch(row, lower) {
	if (testRefMatch(row.refs, lower)) return true;
	if (row.value?.toLowerCase().includes(lower)) return true;
	if (row.footprint?.toLowerCase().includes(lower)) return true;
	if (row.datasheet?.toLowerCase().includes(lower)) return true;
	return testCustomMatch(row.custom, lower);
}

function filterRows(rows, search) {
	const trimmed = search?.trim().toLowerCase();
	if (!trimmed) return rows;
	return rows.filter((r) => matchesSearch(r, trimmed));
}

function findPendingEdit(rowKey, field, pendingEdits) {
	return pendingEdits.find((e) => e.key === rowKey && e.field === field);
}

function getCellValue(row, field, pendingEdits) {
	const edit = findPendingEdit(row.key, field, pendingEdits);
	if (edit !== undefined) return edit.value;
	return row[field] ?? "";
}

function isCellChanged(row, field, pendingEdits) {
	const edit = findPendingEdit(row.key, field, pendingEdits);
	if (!edit) return false;
	const original = row[field] ?? "";
	return String(edit.value) !== String(original);
}

function CellEditor({ initialValue, onCommit, onCancel }) {
	const [text, setText] = useState(initialValue);

	const handleKeyDown = (e) => {
		if (e.key === "Enter") {
			onCommit(text);
		} else if (e.key === "Escape") {
			onCancel();
		}
	};

	return (
		<Input
			size="small"
			autoFocus
			value={text}
			onChange={(e) => setText(e.target.value)}
			onKeyDown={handleKeyDown}
			onBlur={() => onCommit(text)}
			style={{ width: "100%" }}
		/>
	);
}

function computeDisplayStyle(isChanged) {
	return {
		cursor: "pointer",
		padding: "3px 6px",
		borderRadius: 4,
		minHeight: 24,
		width: "100%",
		textAlign: "left",
		background: isChanged ? "rgba(56, 189, 248, 0.18)" : "transparent",
		color: isChanged ? "#38bdf8" : "inherit",
		border: isChanged ? "1px solid #38bdf8" : "1px solid transparent",
		fontWeight: isChanged ? 600 : "normal",
	};
}

function CellDisplay({ value, isChanged, onClick }) {
	const style = computeDisplayStyle(isChanged);
	return (
		<button type="button" onClick={onClick} style={style}>
			{value || <span style={{ color: "#6b7280" }}>—</span>}
		</button>
	);
}

function EditableCell({ row, field, pendingEdits, onCommit }) {
	const [editing, setEditing] = useState(false);
	const currentVal = getCellValue(row, field, pendingEdits);
	const changed = isCellChanged(row, field, pendingEdits);

	if (editing) {
		return (
			<CellEditor
				initialValue={currentVal}
				onCommit={(val) => {
					setEditing(false);
					onCommit(row, field, val);
				}}
				onCancel={() => setEditing(false)}
			/>
		);
	}

	return (
		<CellDisplay
			value={currentVal}
			isChanged={changed}
			onClick={() => setEditing(true)}
		/>
	);
}

function TableToolbar({ grouped, onToggleGroup, search, onSearchChange }) {
	return (
		<div style={TOOLBAR_STYLE}>
			<Checkbox
				checked={grouped}
				onChange={(e) => onToggleGroup(e.target.checked)}
			>
				Group symbols (Value + Footprint)
			</Checkbox>
			<Input
				placeholder="Filter symbols..."
				value={search}
				onChange={(e) => onSearchChange(e.target.value)}
				allowClear
				style={{ width: 240 }}
			/>
		</div>
	);
}

function buildEditableCol(colInfo, pendingEdits, onCommit) {
	const { field, title } = colInfo;
	return {
		title,
		dataIndex: field,
		key: field,
		render: (_val, row) => (
			<EditableCell
				row={row}
				field={field}
				pendingEdits={pendingEdits}
				onCommit={onCommit}
			/>
		),
	};
}

function buildTableColumns({ grouped, pendingEdits, onCommit }) {
	const cols = [];
	if (grouped) {
		cols.push({
			title: "Qty",
			dataIndex: "qty",
			key: "qty",
			width: 60,
			align: "center",
		});
	}
	cols.push({
		title: "Reference",
		dataIndex: "refs",
		key: "refs",
		render: (refs) => refs?.join(", ") ?? "",
	});
	for (const info of EDITABLE_COLUMNS) {
		cols.push(buildEditableCol(info, pendingEdits, onCommit));
	}
	return cols;
}

function computeGroupBy(grouped) {
	return grouped ? ["value", "footprint"] : [];
}

function resetAndClose(setPendingEdits, onClose) {
	setPendingEdits([]);
	onClose?.();
}

export function SymbolFieldsTable({ open, ir, onApply, onClose }) {
	const [grouped, setGrouped] = useState(true);
	const [search, setSearch] = useState("");
	const [pendingEdits, setPendingEdits] = useState([]);

	const allRows = useMemo(
		() => buildRows(ir, { groupBy: computeGroupBy(grouped) }),
		[ir, grouped],
	);

	const displayRows = useMemo(
		() => filterRows(allRows, search),
		[allRows, search],
	);

	const handleCommit = useCallback((row, field, val) => {
		setPendingEdits((prev) => recordPendingEdit(prev, row, field, val));
	}, []);

	const handleCancel = useCallback(() => {
		resetAndClose(setPendingEdits, onClose);
	}, [onClose]);

	const handleApply = useCallback(() => {
		const cmd = editsToCommand(ir, pendingEdits);
		if (cmd && cmd.commands?.length > 0) {
			onApply?.(cmd);
		}
		resetAndClose(setPendingEdits, onClose);
	}, [ir, pendingEdits, onApply, onClose]);

	const columns = useMemo(
		() => buildTableColumns({ grouped, pendingEdits, onCommit: handleCommit }),
		[grouped, pendingEdits, handleCommit],
	);

	return (
		<Modal
			open={open}
			title="Symbol Fields Table"
			width={950}
			onCancel={handleCancel}
			onOk={handleApply}
			okText="Apply"
			cancelText="Cancel"
			destroyOnClose
		>
			<TableToolbar
				grouped={grouped}
				onToggleGroup={setGrouped}
				search={search}
				onSearchChange={setSearch}
			/>
			<Table
				rowKey="key"
				columns={columns}
				dataSource={displayRows}
				size="small"
				pagination={displayRows.length > 20 ? { pageSize: 20 } : false}
				scroll={{ y: 400 }}
			/>
		</Modal>
	);
}

export default SymbolFieldsTable;
