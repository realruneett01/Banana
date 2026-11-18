import { PlayCircleOutlined } from "@ant-design/icons";
import { Button, Collapse, Empty, Space, Tag } from "antd";
import { useMemo } from "react";
import { countViolations, groupViolations } from "./checksApi.js";

const S = {
	root: {
		display: "flex",
		flexDirection: "column",
		width: "100%",
		height: "100%",
		minHeight: 0,
		background: "#0f121d",
		color: "#e6e8ee",
		overflow: "hidden",
	},
	head: {
		display: "flex",
		justifyContent: "space-between",
		alignItems: "center",
		padding: "8px 12px",
		background: "#121520",
		borderBottom: "1px solid #1e2438",
		minHeight: 40,
		flexShrink: 0,
		gap: 8,
	},
	row: {
		display: "flex",
		alignItems: "center",
		gap: 10,
		flexWrap: "wrap",
	},
	body: {
		flex: 1,
		minHeight: 0,
		overflowY: "auto",
		padding: "8px 12px",
	},
	empty: {
		padding: "24px 0",
		display: "flex",
		justifyContent: "center",
	},
	card: {
		padding: "6px 8px",
		background: "#141824",
		borderRadius: 4,
		marginBottom: 6,
		border: "1px solid #1e2438",
	},
	list: {
		margin: 0,
		paddingLeft: 6,
		listStyle: "none",
		display: "flex",
		flexDirection: "column",
		gap: 2,
	},
	btn: {
		background: "none",
		border: "none",
		cursor: "pointer",
		padding: "2px 6px",
		borderRadius: 3,
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 8,
		width: "100%",
		color: "#94a3b8",
		fontSize: 11,
	},
};

const SEVERITY_CONFIG = [
	{
		key: "error",
		label: "error",
		plural: "errors",
		color: "#fb7185",
		activeColor: undefined,
	},
	{
		key: "warning",
		label: "warning",
		plural: "warnings",
		color: "#fbbf24",
		activeColor: "#18181b",
	},
];

function ViolationItemsList({ items, parentKey, onFocus }) {
	if (!items?.length) return null;
	return (
		<ul style={S.list}>
			{items.map((item, idx) => {
				const pos = item?.pos;
				return (
					<li key={`${parentKey}:${item?.description || idx}`}>
						<button
							type="button"
							onClick={() => onFocus?.(pos ?? { x: 0, y: 0 })}
							style={S.btn}
							aria-label={`Focus item ${item?.description ?? ""}`}
						>
							<span>{item?.description ?? "Item"}</span>
							{pos && (
								<span
									style={{
										fontFamily: "monospace",
										color: "#38bdf8",
										flexShrink: 0,
									}}
								>
									({pos.x}, {pos.y})
								</span>
							)}
						</button>
					</li>
				);
			})}
		</ul>
	);
}

function TypeGroupSection({ typeGroup, onFocus }) {
	return (
		<div style={{ marginBottom: 10 }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					marginBottom: 4,
				}}
			>
				<Tag style={{ margin: 0, fontSize: 11 }}>{typeGroup?.type}</Tag>
				<span style={{ fontSize: 11, color: "#8a91a3" }}>
					({typeGroup?.count})
				</span>
			</div>
			{typeGroup?.violations?.map((v, vIdx) => {
				const vKey = `${v?.severity}:${v?.type}:${v?.description || vIdx}`;
				return (
					<div key={vKey} style={S.card}>
						<div
							style={{
								fontSize: 12,
								color: "#e2e8f0",
								marginBottom: 4,
								wordBreak: "break-word",
							}}
						>
							{v?.description}
						</div>
						<ViolationItemsList
							items={v?.items}
							parentKey={vKey}
							onFocus={onFocus}
						/>
					</div>
				);
			})}
		</div>
	);
}

function buildSeverityItems(groups, onFocus) {
	return groups.map((g) => {
		const isErr = g.severity === "error";
		return {
			key: g.severity,
			label: (
				<span
					style={{
						color: isErr ? "#fb7185" : "#fbbf24",
						fontWeight: 700,
						fontSize: 12,
					}}
				>
					{isErr ? "Errors" : "Warnings"} ({g.count})
				</span>
			),
			children: (
				<div>
					{g.types.map((tg) => (
						<TypeGroupSection key={tg.type} typeGroup={tg} onFocus={onFocus} />
					))}
				</div>
			),
		};
	});
}

function ChecksCounts({ counts }) {
	return (
		<Space size={6}>
			{SEVERITY_CONFIG.map(({ key, label, plural, color, activeColor }) => {
				const n = counts?.[key] ?? 0;
				return (
					<Tag
						key={key}
						color={n > 0 ? color : "default"}
						style={{
							margin: 0,
							fontWeight: 600,
							color: n > 0 ? activeColor : undefined,
						}}
					>
						{n} {n === 1 ? label : plural}
					</Tag>
				);
			})}
		</Space>
	);
}

function ChecksHeader({ kind, counts, loading, onRun }) {
	const isErc = String(kind).toLowerCase() === "erc";
	const prefix = isErc ? "ERC" : "DRC";
	return (
		<header style={S.head}>
			<div style={S.row}>
				<span style={{ fontWeight: 700, fontSize: 13, color: "#e2e8f0" }}>
					{prefix} Checks
				</span>
				<ChecksCounts counts={counts} />
			</div>
			<Button
				type="primary"
				size="small"
				loading={loading}
				onClick={onRun}
				icon={<PlayCircleOutlined />}
			>
				Run {prefix}
			</Button>
		</header>
	);
}

function ChecksEmpty() {
	return (
		<div style={S.empty}>
			<Empty
				image={Empty.PRESENTED_IMAGE_SIMPLE}
				description="No problems found"
			/>
		</div>
	);
}

export default function ChecksPanel({
	result,
	loading = false,
	onRun,
	onFocus,
	kind = "drc",
}) {
	const violations = result?.violations ?? [];
	const counts = result?.counts ?? countViolations(violations);
	const groups = useMemo(() => groupViolations(violations), [violations]);
	const collapseItems = useMemo(
		() => buildSeverityItems(groups, onFocus),
		[groups, onFocus],
	);

	return (
		<section style={S.root} aria-label="Checks panel">
			<ChecksHeader
				kind={kind}
				counts={counts}
				loading={loading}
				onRun={onRun}
			/>
			<div style={S.body}>
				{violations.length === 0 ? (
					<ChecksEmpty />
				) : (
					<Collapse
						ghost
						defaultActiveKey={["error", "warning"]}
						items={collapseItems}
					/>
				)}
			</div>
		</section>
	);
}
