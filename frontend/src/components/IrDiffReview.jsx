import { Alert, Button, List, Space, Tag, Typography } from "antd";
import { useMemo } from "react";
import { diffIr } from "../irDiff.js";

const MUTED_COLOR = "#94a3b8";
const TEXT_COLOR = "#e2e8f0";
const DIVIDER = "1px solid #23283e";

const flexColumn = (gap, extra) =>
	Object.freeze({ display: "flex", flexDirection: "column", gap, ...extra });

const textStyle = (color, fontSize, extra) =>
	Object.freeze({ color, fontSize, ...extra });

const CONTAINER_STYLE = flexColumn("12px", {
	padding: "12px",
	background: "#161a2a",
	borderRadius: "6px",
	border: DIVIDER,
});

const ALERT_STYLE = Object.freeze({
	background: "#1c1f2e",
	borderColor: "#3b4468",
});

const SECTION_STYLE = flexColumn("4px");

const LABEL_STYLE = textStyle(MUTED_COLOR, "12px", {
	textTransform: "uppercase",
	letterSpacing: "0.05em",
});

const TEXT_STYLE = textStyle(TEXT_COLOR, "13px");

const MUTED_TEXT_STYLE = textStyle(MUTED_COLOR, "12px");

const SUMMARY_STYLE = textStyle(TEXT_COLOR, "13px", { margin: 0 });

const ITEM_STYLE = Object.freeze({
	padding: "4px 0",
	borderBottom: DIVIDER,
});

const COLUMN_STYLE = flexColumn("2px", { width: "100%" });

const INDENT_STYLE = flexColumn("2px", { paddingLeft: "16px" });

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

function DiffSection({ title, items, renderItem }) {
	if (!items?.length) return null;
	return (
		<div style={SECTION_STYLE}>
			<Typography.Text strong style={LABEL_STYLE}>
				{title}
			</Typography.Text>
			<List size="small" dataSource={items} renderItem={renderItem} />
		</div>
	);
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

function RemovedPartItem({ part }) {
	return (
		<List.Item style={ITEM_STYLE}>
			<Space>
				<Tag color="red">Removed</Tag>
				<Typography.Text style={TEXT_STYLE}>{part.ref}</Typography.Text>
			</Space>
		</List.Item>
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

const renderNetPin = (color, label) => (net, before, after) => (
	<NetPinItem
		net={net}
		before={before}
		after={after}
		color={color}
		label={label}
	/>
);

const DIFF_SECTIONS = Object.freeze([
	["parts", "added", "Added Parts", (part) => <AddedPartItem part={part} />],
	[
		"parts",
		"removed",
		"Removed Parts",
		(part) => <RemovedPartItem part={part} />,
	],
	[
		"parts",
		"changed",
		"Changed Parts",
		(part) => <ChangedPartItem part={part} />,
	],
	["nets", "added", "Added Connections", renderNetPin("green", "Added")],
	["nets", "removed", "Removed Connections", renderNetPin("red", "Removed")],
	[
		"nets",
		"changed",
		"Changed Connections",
		(net, before, after) => (
			<ChangedNetItem net={net} before={before} after={after} />
		),
	],
]);

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
			{DIFF_SECTIONS.map(([group, kind, title, render]) => (
				<DiffSection
					key={`${group}-${kind}`}
					title={title}
					items={diff[group][kind]}
					renderItem={(item) => render(item, before, after)}
				/>
			))}
			<ReviewButtons onAccept={onAccept} onReject={onReject} after={after} />
		</section>
	);
}
