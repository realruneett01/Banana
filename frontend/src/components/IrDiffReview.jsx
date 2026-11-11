import { Alert, Button, List, Space, Tag, Typography } from "antd";
import { useMemo } from "react";
import { diffIr } from "../irDiff.js";

const CONTAINER_STYLE = Object.freeze({
	display: "flex",
	flexDirection: "column",
	gap: "12px",
	padding: "12px",
	background: "#161a2a",
	borderRadius: "6px",
	border: "1px solid #23283e",
});

const ALERT_STYLE = Object.freeze({
	background: "#1c1f2e",
	borderColor: "#3b4468",
});

const SECTION_STYLE = Object.freeze({
	display: "flex",
	flexDirection: "column",
	gap: "4px",
});

const LABEL_STYLE = Object.freeze({
	color: "#94a3b8",
	fontSize: "12px",
	textTransform: "uppercase",
	letterSpacing: "0.05em",
});

const TEXT_STYLE = Object.freeze({
	color: "#e2e8f0",
	fontSize: "13px",
});

const MUTED_TEXT_STYLE = Object.freeze({
	color: "#94a3b8",
	fontSize: "12px",
});

const SUMMARY_STYLE = Object.freeze({
	color: "#e2e8f0",
	fontSize: "13px",
	margin: 0,
});

const ITEM_STYLE = Object.freeze({
	padding: "4px 0",
	borderBottom: "1px solid #23283e",
});

const COLUMN_STYLE = Object.freeze({
	display: "flex",
	flexDirection: "column",
	gap: "2px",
	width: "100%",
});

const INDENT_STYLE = Object.freeze({
	paddingLeft: "16px",
	display: "flex",
	flexDirection: "column",
	gap: "2px",
});

const BUTTON_ROW_STYLE = Object.freeze({
	display: "flex",
	gap: "8px",
	justifyContent: "flex-end",
	marginTop: "4px",
});

function formatVal(val) {
	if (val === null || val === undefined) {
		return "none";
	}
	if (typeof val === "object") {
		return JSON.stringify(val);
	}
	return String(val);
}

function lookupPartRef(partId, before, after) {
	const afterPart = after?.parts?.find((p) => p.id === partId);
	if (afterPart?.ref) {
		return afterPart.ref;
	}
	const beforePart = before?.parts?.find((p) => p.id === partId);
	if (beforePart?.ref) {
		return beforePart.ref;
	}
	return partId || "?";
}

function formatPin(pin, before, after) {
	const ref = lookupPartRef(pin?.partId, before, after);
	const pinNum = pin?.pin ?? "";
	return `${ref}.${pinNum}`;
}

function formatPinList(pins, before, after) {
	if (!Array.isArray(pins) || pins.length === 0) {
		return "";
	}
	return pins.map((p) => formatPin(p, before, after)).join(", ");
}

function AddedPartItem({ part }) {
	return (
		<List.Item style={ITEM_STYLE}>
			<Space>
				<Tag color="green">Added</Tag>
				<Typography.Text style={TEXT_STYLE}>{part.ref}</Typography.Text>
				{part.value && (
					<Typography.Text style={MUTED_TEXT_STYLE}>
						{part.value}
					</Typography.Text>
				)}
			</Space>
		</List.Item>
	);
}

function AddedPartsList({ parts }) {
	if (!parts?.length) return null;
	return (
		<div style={SECTION_STYLE}>
			<Typography.Text strong style={LABEL_STYLE}>
				Added Parts
			</Typography.Text>
			<List
				size="small"
				dataSource={parts}
				renderItem={(part) => <AddedPartItem part={part} />}
			/>
		</div>
	);
}

function RemovedPartsList({ parts }) {
	if (!parts?.length) return null;
	return (
		<div style={SECTION_STYLE}>
			<Typography.Text strong style={LABEL_STYLE}>
				Removed Parts
			</Typography.Text>
			<List
				size="small"
				dataSource={parts}
				renderItem={(part) => (
					<List.Item style={ITEM_STYLE}>
						<Space>
							<Tag color="red">Removed</Tag>
							<Typography.Text style={TEXT_STYLE}>{part.ref}</Typography.Text>
						</Space>
					</List.Item>
				)}
			/>
		</div>
	);
}

function ChangedPartItem({ part }) {
	return (
		<List.Item style={ITEM_STYLE}>
			<div style={COLUMN_STYLE}>
				<Space>
					<Tag color="orange">Changed</Tag>
					<Typography.Text strong style={TEXT_STYLE}>
						{part.ref}
					</Typography.Text>
				</Space>
				<div style={INDENT_STYLE}>
					{(part.fields || []).map((ch) => (
						<div key={ch.field}>
							<Typography.Text style={MUTED_TEXT_STYLE}>
								{ch.field}: {formatVal(ch.before)} → {formatVal(ch.after)}
							</Typography.Text>
						</div>
					))}
				</div>
			</div>
		</List.Item>
	);
}

function ChangedPartsList({ parts }) {
	if (!parts?.length) return null;
	return (
		<div style={SECTION_STYLE}>
			<Typography.Text strong style={LABEL_STYLE}>
				Changed Parts
			</Typography.Text>
			<List
				size="small"
				dataSource={parts}
				renderItem={(part) => <ChangedPartItem part={part} />}
			/>
		</div>
	);
}

function NetPinItem({ net, before, after, color, label }) {
	const pins = formatPinList(net.pins, before, after);
	return (
		<List.Item style={ITEM_STYLE}>
			<Space>
				<Tag color={color}>{label}</Tag>
				<Typography.Text style={TEXT_STYLE}>
					{net.name}
					{pins ? `: ${pins}` : ""}
				</Typography.Text>
			</Space>
		</List.Item>
	);
}

function AddedNetsList({ nets, before, after }) {
	if (!nets?.length) return null;
	return (
		<div style={SECTION_STYLE}>
			<Typography.Text strong style={LABEL_STYLE}>
				Added Connections
			</Typography.Text>
			<List
				size="small"
				dataSource={nets}
				renderItem={(net) => (
					<NetPinItem
						net={net}
						before={before}
						after={after}
						color="green"
						label="Added"
					/>
				)}
			/>
		</div>
	);
}

function RemovedNetsList({ nets, before, after }) {
	if (!nets?.length) return null;
	return (
		<div style={SECTION_STYLE}>
			<Typography.Text strong style={LABEL_STYLE}>
				Removed Connections
			</Typography.Text>
			<List
				size="small"
				dataSource={nets}
				renderItem={(net) => (
					<NetPinItem
						net={net}
						before={before}
						after={after}
						color="red"
						label="Removed"
					/>
				)}
			/>
		</div>
	);
}

function NetPinDeltas({ added, removed }) {
	return (
		<div style={INDENT_STYLE}>
			{added && (
				<Typography.Text style={MUTED_TEXT_STYLE}>+ {added}</Typography.Text>
			)}
			{removed && (
				<Typography.Text style={MUTED_TEXT_STYLE}>- {removed}</Typography.Text>
			)}
		</div>
	);
}

function ChangedNetItem({ net, before, after }) {
	const added = formatPinList(net.addedPins, before, after);
	const removed = formatPinList(net.removedPins, before, after);
	const title = net.renamedFrom
		? `${net.name} (renamed from ${net.renamedFrom})`
		: net.name;
	return (
		<List.Item style={ITEM_STYLE}>
			<div style={COLUMN_STYLE}>
				<Space>
					<Tag color="orange">Changed</Tag>
					<Typography.Text strong style={TEXT_STYLE}>
						{title}
					</Typography.Text>
				</Space>
				<NetPinDeltas added={added} removed={removed} />
			</div>
		</List.Item>
	);
}

function ChangedNetsList({ nets, before, after }) {
	if (!nets?.length) return null;
	return (
		<div style={SECTION_STYLE}>
			<Typography.Text strong style={LABEL_STYLE}>
				Changed Connections
			</Typography.Text>
			<List
				size="small"
				dataSource={nets}
				renderItem={(net) => (
					<ChangedNetItem net={net} before={before} after={after} />
				)}
			/>
		</div>
	);
}

function ReviewButtons({ onAccept, onReject, after }) {
	return (
		<div style={BUTTON_ROW_STYLE}>
			<Button onClick={onReject}>Keep my design</Button>
			<Button type="primary" onClick={() => onAccept?.(after)}>
				Accept changes
			</Button>
		</div>
	);
}

export default function IrDiffReview({ before, after, onAccept, onReject }) {
	const diff = useMemo(() => diffIr(before, after), [before, after]);

	if (diff.isEmpty) {
		return (
			<Alert
				type="info"
				showIcon
				message="The AI made no changes."
				style={ALERT_STYLE}
			/>
		);
	}

	return (
		<section style={CONTAINER_STYLE} aria-label="Design Changes Review">
			<Typography.Text strong style={SUMMARY_STYLE}>
				{diff.summary}
			</Typography.Text>
			<AddedPartsList parts={diff.parts.added} />
			<RemovedPartsList parts={diff.parts.removed} />
			<ChangedPartsList parts={diff.parts.changed} />
			<AddedNetsList nets={diff.nets.added} before={before} after={after} />
			<RemovedNetsList nets={diff.nets.removed} before={before} after={after} />
			<ChangedNetsList nets={diff.nets.changed} before={before} after={after} />
			<ReviewButtons onAccept={onAccept} onReject={onReject} after={after} />
		</section>
	);
}
