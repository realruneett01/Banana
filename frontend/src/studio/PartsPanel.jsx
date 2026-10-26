import React, { useEffect, useMemo, useState } from "react";
import {
	AutoComplete,
	Button,
	Empty,
	Input,
	List,
	Modal,
	Select,
	Space,
	Tag,
	Typography,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { api } from "./api.js";

const { Text } = Typography;

function useSearch(tool, query, key) {
	const [options, setOptions] = useState([]);
	useEffect(() => {
		const q = query.trim();
		if (q.length < 2) {
			setOptions([]);
			return undefined;
		}
		let cancelled = false;
		const t = setTimeout(() => {
			api
				.tool(tool, { query: q, limit: 30 })
				.then((r) => {
					if (!cancelled)
						setOptions((r[key] || []).map((id) => ({ value: id })));
				})
				.catch(() => {
					if (!cancelled) setOptions([]);
				});
		}, 200);
		return () => {
			cancelled = true;
			clearTimeout(t);
		};
	}, [tool, query, key]);
	return options;
}

function AddPartModal({ open, onClose, onAdd }) {
	const [symbolQuery, setSymbolQuery] = useState("");
	const [symbol, setSymbol] = useState("");
	const [footprintQuery, setFootprintQuery] = useState("");
	const [value, setValue] = useState("");
	const [info, setInfo] = useState(null);
	const [error, setError] = useState("");
	const symbolOptions = useSearch("search_symbols", symbolQuery, "symbols");
	const footprintOptions = useSearch(
		"search_footprints",
		footprintQuery,
		"footprints",
	);

	useEffect(() => {
		if (!open) {
			setSymbolQuery("");
			setSymbol("");
			setFootprintQuery("");
			setValue("");
			setInfo(null);
			setError("");
		}
	}, [open]);

	const pickSymbol = async (id) => {
		setSymbol(id);
		setSymbolQuery(id);
		setError("");
		try {
			const s = await api.tool("get_symbol", { id });
			setInfo(s);
			if (s.defaultFootprint) setFootprintQuery(s.defaultFootprint);
			setValue((v) => v || s.name || id.split(":")[1]);
		} catch (e) {
			setInfo(null);
			setError(e.message);
		}
	};

	const ready = symbol && info && footprintQuery.includes(":");
	return (
		<Modal
			title="Add a part"
			open={open}
			onCancel={onClose}
			okText="Add part"
			okButtonProps={{ disabled: !ready, "data-testid": "add-part-confirm" }}
			onOk={async () => {
				const ok = await onAdd({
					symbol,
					footprint: footprintQuery,
					value: value || symbol.split(":")[1],
				});
				if (ok) onClose();
			}}
			destroyOnHidden
		>
			<Space direction="vertical" style={{ width: "100%" }}>
				<div>
					<Text type="secondary">Symbol from the KiCad library</Text>
					<AutoComplete
						data-testid="symbol-search"
						style={{ width: "100%" }}
						value={symbolQuery}
						options={symbolOptions}
						onChange={(v) => {
							setSymbolQuery(v);
							if (v !== symbol) {
								setSymbol("");
								setInfo(null);
							}
						}}
						onSelect={pickSymbol}
						placeholder="e.g. Device:R, LED, AMS1117"
					/>
				</div>
				{info && (
					<Text
						type="secondary"
						style={{ fontSize: 12 }}
						data-testid="symbol-info"
					>
						{info.description || info.id} · {info.pins.length} pins
					</Text>
				)}
				<div>
					<Text type="secondary">Footprint</Text>
					<AutoComplete
						data-testid="footprint-search"
						style={{ width: "100%" }}
						value={footprintQuery}
						options={footprintOptions}
						onChange={setFootprintQuery}
						placeholder="e.g. Resistor_SMD:R_0805_2012Metric"
					/>
				</div>
				<div>
					<Text type="secondary">Value</Text>
					<Input
						data-testid="value-input"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						placeholder="10k"
					/>
				</div>
				{error && <Text type="danger">{error}</Text>}
			</Space>
		</Modal>
	);
}

function PoursSection({ state, onEdit, disabled }) {
	const nets = Object.keys(state?.nets ?? {});
	const [net, setNet] = useState("");
	const [layer, setLayer] = useState("B.Cu");
	const zones = state?.zones ?? [];
	useEffect(() => {
		if (!net || !nets.includes(net))
			setNet(nets.find((n) => /^(GND|AGND|DGND|VSS)$/i.test(n)) ?? nets[0] ?? "");
	}, [nets, net]);
	if (!nets.length) return null;
	return (
		<div data-testid="pours" style={{ borderTop: "1px solid #232738", paddingTop: 10 }}>
			<Text type="secondary" style={{ fontSize: 12 }}>
				Copper pour
			</Text>
			{zones.map((z) => (
				<div key={`${z.net}|${z.layer}`} style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0" }} data-testid={`pour-${z.net}`}>
					<Tag color="blue" style={{ margin: 0 }}>
						{z.net} · {z.layer}
					</Tag>
					{z.fill && z.fill !== "ok" && (
						<Text type="warning" style={{ fontSize: 11 }} title="KiCad's Python module is needed to draw the fill here">
							not filled
						</Text>
					)}
					<Button
						size="small"
						type="text"
						danger
						disabled={disabled}
						data-testid={`remove-pour-${z.net}`}
						onClick={() => onEdit([{ op: "remove_zone", net: z.net, layer: z.layer }], `Remove ${z.net} pour`, { reroute: true })}
					>
						Remove
					</Button>
				</div>
			))}
			<Space.Compact style={{ width: "100%", marginTop: 6 }}>
				<Select size="small" value={net} onChange={setNet} options={nets.map((n) => ({ value: n }))} style={{ flex: 1 }} data-testid="pour-net" />
				<Select
					size="small"
					value={layer}
					onChange={setLayer}
					options={[
						{ value: "B.Cu", label: "Back" },
						{ value: "F.Cu", label: "Front" },
					]}
					style={{ width: 80 }}
					data-testid="pour-layer"
				/>
				<Button
					size="small"
					disabled={disabled || !net || zones.some((z) => z.layer === layer)}
					data-testid="add-pour"
					onClick={() => onEdit([{ op: "add_zone", net, layer }], `Add ${net} pour on ${layer}`, { reroute: true })}
				>
					Add pour
				</Button>
			</Space.Compact>
		</div>
	);
}

export default function PartsPanel({
	state,
	selected,
	onSelect,
	onAddPart,
	onEdit,
	disabled,
}) {
	const [open, setOpen] = useState(false);
	const parts = state?.parts ?? [];
	const counts = useMemo(() => {
		const nets = Object.keys(state?.nets ?? {}).length;
		return { parts: parts.length, nets };
	}, [parts.length, state?.nets]);

	return (
		<div
			data-testid="parts-panel"
			style={{ display: "flex", flexDirection: "column", gap: 10 }}
		>
			<Space style={{ justifyContent: "space-between", width: "100%" }}>
				<Text type="secondary">
					{counts.parts} parts · {counts.nets} nets
				</Text>
				<Button
					size="small"
					type="primary"
					icon={<PlusOutlined />}
					disabled={disabled}
					onClick={() => setOpen(true)}
					data-testid="add-part"
				>
					Add part
				</Button>
			</Space>
			{parts.length === 0 ? (
				<Empty
					image={Empty.PRESENTED_IMAGE_SIMPLE}
					description="No parts yet. Add one, or ask the assistant to design something."
				/>
			) : (
				<List
					size="small"
					dataSource={parts}
					renderItem={(p) => (
						<List.Item
							data-testid={`part-row-${p.ref}`}
							onClick={() => onSelect(p.ref)}
							style={{
								cursor: "pointer",
								background:
									selected === p.ref
										? "rgba(34, 211, 238, 0.12)"
										: "transparent",
								padding: "6px 8px",
							}}
						>
							<Space style={{ minWidth: 0, width: "100%" }} size={6}>
								<Tag color="gold" style={{ margin: 0 }}>
									{p.ref}
								</Tag>
								<Text ellipsis style={{ maxWidth: 90 }}>
									{p.value}
								</Text>
								<Text
									type="secondary"
									ellipsis
									style={{ fontSize: 11, maxWidth: 110 }}
								>
									{(p.footprint || "").split(":")[1]}
								</Text>
							</Space>
						</List.Item>
					)}
				/>
			)}
			<PoursSection state={state} onEdit={onEdit} disabled={disabled} />
			<AddPartModal
				open={open}
				onClose={() => setOpen(false)}
				onAdd={onAddPart}
			/>
		</div>
	);
}
