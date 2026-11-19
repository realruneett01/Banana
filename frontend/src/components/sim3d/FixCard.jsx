import { Button, Card, Tag, Typography } from "antd";

const FIX_CARD_STYLE = Object.freeze({
	background: "#131722",
	border: "1px dashed #38bdf8",
	borderRadius: "6px",
	marginTop: "6px",
});

function getRiskColor(risk) {
	if (risk === "high") return "error";
	if (risk === "medium") return "warning";
	if (risk === "low") return "success";
	return "default";
}

function FixHeader({ title, risk }) {
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				marginBottom: "6px",
			}}
		>
			<Typography.Text strong style={{ color: "#f1f5f9", fontSize: "12px" }}>
				{title}
			</Typography.Text>
			{risk && <Tag color={getRiskColor(risk)}>{risk} risk</Tag>}
		</div>
	);
}

export default function FixCard({ fix, onApply }) {
	if (!fix) return null;
	return (
		<Card size="small" style={FIX_CARD_STYLE}>
			<FixHeader title={fix.title} risk={fix.risk} />
			<Typography.Paragraph
				style={{ color: "#94a3b8", fontSize: "11px", marginBottom: "8px" }}
			>
				{fix.why}
			</Typography.Paragraph>
			<Button
				type="primary"
				size="small"
				onClick={() => onApply?.(fix.commands)}
				aria-label={`Apply fix: ${fix.title}`}
				style={{ background: "#0284c7" }}
			>
				Apply fix
			</Button>
		</Card>
	);
}
