import {
	mdiChip,
	mdiCircleSmall,
	mdiCloseCircleOutline,
	mdiCrosshairs,
	mdiFlash,
	mdiFuse,
	mdiIntegratedCircuitChip,
	mdiLabelOutline,
	mdiLayers,
	mdiLedOn,
	mdiSetCenter,
	mdiSineWave,
	mdiSitemap,
	mdiTagArrowRightOutline,
	mdiVectorCircle,
	mdiVectorLine,
	mdiVectorPolyline,
	mdiVectorRectangle,
} from "@mdi/js";
import {
	IconCircuitBattery,
	IconCircuitCapacitor,
	IconCircuitCapacitorPolarized,
	IconCircuitDiode,
	IconCircuitDiodeZener,
	IconCircuitGround,
	IconCircuitInductor,
	IconCircuitPushbutton,
	IconCircuitResistor,
	IconCpu,
	IconHierarchy,
	IconLetterT,
	IconLine,
	IconPlug,
	IconPointer,
	IconRoute,
	IconRulerMeasure,
	IconStack2,
} from "@tabler/icons-react";
import { Button, Tooltip } from "antd";
import { useEffect, useState } from "react";
import { emitEditorTool, onActiveTool } from "./editorToolBus.js";
import { paletteFor } from "./toolPalettes.js";

const S = {
	panel: {
		width: 200,
		minWidth: 200,
		height: "100%",
		overflowY: "auto",
		background: "#12151c",
		borderRight: "1px solid #232836",
		padding: 10,
		color: "#e6e8ee",
		boxSizing: "border-box",
		flexShrink: 0,
	},
	sec: { marginBottom: 14 },
	hdr: {
		fontSize: 11,
		fontWeight: 700,
		textTransform: "uppercase",
		letterSpacing: "0.05em",
		color: "#8a91a3",
		marginBottom: 6,
	},
	tGrid: { display: "grid", gap: 4, gridTemplateColumns: "repeat(4, 1fr)" },
	pGrid: {
		display: "grid",
		gap: 4,
		gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
	},
	toolBtn: {
		width: "100%",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		height: 34,
		padding: 0,
	},
	partBtn: {
		width: "100%",
		display: "flex",
		alignItems: "center",
		justifyContent: "flex-start",
		padding: "0 6px",
		fontSize: 11,
	},
	layerBtn: {
		width: "100%",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		padding: "0 6px",
		fontSize: 11,
	},
	ellipsis: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	svg: { display: "inline-block", verticalAlign: "middle", flexShrink: 0 },
	fallback: { fontSize: 12, fontWeight: 700 },
};

const T_ICONS = [
	IconPointer,
	IconCircuitGround,
	IconLine,
	IconStack2,
	IconHierarchy,
	IconLetterT,
	IconCpu,
	IconRoute,
	IconRulerMeasure,
	IconCircuitResistor,
	IconCircuitCapacitor,
	IconCircuitCapacitorPolarized,
	IconCircuitInductor,
	IconCircuitDiode,
	IconCircuitDiodeZener,
	IconPlug,
	IconCircuitPushbutton,
	IconCircuitBattery,
];

const M_ICONS = [
	mdiCrosshairs,
	mdiIntegratedCircuitChip,
	mdiCloseCircleOutline,
	mdiCircleSmall,
	mdiLabelOutline,
	mdiTagArrowRightOutline,
	mdiSitemap,
	mdiVectorLine,
	mdiSetCenter,
	mdiLayers,
	mdiVectorRectangle,
	mdiVectorPolyline,
	mdiVectorCircle,
	mdiLedOn,
	mdiChip,
	mdiSineWave,
	mdiFuse,
	mdiFlash,
];

const ICON_MAP =
	"select:t:0|power:t:1|ground:t:1|wire:t:2|bus:t:3|hlabel:t:4|text:t:5|footprint:t:6|route:t:7|dimension:t:8|resistor:t:9|capacitor:t:10|capacitorPolarized:t:11|inductor:t:12|diode:t:13|zener:t:14|plug:t:15|button:t:16|battery:t:17|net:m:0|symbol:m:1|ic:m:1|noconnect:m:2|junction:m:3|hole:m:3|label:m:4|glabel:m:5|sheet:m:6|line:m:7|via:m:8|zone:m:9|outline:m:10|outlineRounded:m:10|rect:m:10|arc:m:11|circle:m:12|led:m:13|chip:m:14|crystal:m:15|fuse:m:16|flash:m:17";

const ICONS = {};
for (const entry of ICON_MAP.split("|")) {
	const [k, type, idx] = entry.split(":");
	ICONS[k] = type === "t" ? T_ICONS[Number(idx)] : M_ICONS[Number(idx)];
}

const PART_RULES = Object.freeze([
	[/^GND/, "ground"],
	[/^(VCC|\+|PWR_FLAG)/, "flash"],
	[/^(C_Polarized|CP_)/, "capacitorPolarized"],
	[/^(C$|C_\d)/, "capacitor"],
	[/^(R$|R_)/, "resistor"],
	[/^(L$|L_\d)/, "inductor"],
	[/^D_Zener/, "zener"],
	[/^LED/, "led"],
	[/^(D$|D_)/, "diode"],
	[/^(Q_|SOT-|TO-)/, "chip"],
	[/^(LM358|SOIC|DIP)/, "ic"],
	[/^(Conn_|PinHeader)/, "plug"],
	[/^SW_P/i, "button"],
	[/^Crystal/, "crystal"],
	[/^Fuse/, "fuse"],
	[/^Battery/, "battery"],
	[/^MountingHole/, "hole"],
]);

function resolvePartIconKey(item) {
	const id = item?.id ?? "";
	const match = PART_RULES.find(([re]) => re.test(id));
	return match ? match[1] : id;
}

function renderIcon(key, label) {
	const icon = ICONS[key];
	if (typeof icon === "string") {
		return (
			<svg
				viewBox="0 0 24 24"
				width={18}
				height={18}
				style={S.svg}
				aria-hidden="true"
			>
				<path d={icon} fill="currentColor" />
			</svg>
		);
	}
	if (icon) {
		const Comp = icon;
		return <Comp size={18} color="currentColor" />;
	}
	return <span style={S.fallback}>{label?.[0] || "?"}</span>;
}

function formatTooltip(tool) {
	if (!tool.ready) return `${tool.label} - coming soon`;
	const k = tool.hotkey;
	const hk = k?.toLowerCase() === "backquote" ? "'" : k?.toUpperCase();
	return hk ? `${tool.label} (${hk})` : tool.label;
}

function getPartId(item) {
	return item.symbol || item.footprint || "";
}

function formatPartTitle(item) {
	const id = getPartId(item);
	const val = item.value || "";
	if (!val || val === id) return id || val;
	return `${id} (${val})`;
}

function withBlur(onClick) {
	if (!onClick) return undefined;
	return (event) => {
		onClick(event);
		event?.currentTarget?.blur?.();
	};
}

function renderBtn(p) {
	const btn = (
		<Button
			key={p.key}
			size="small"
			icon={p.icon}
			disabled={p.disabled}
			type={p.active ? "primary" : "default"}
			onClick={withBlur(p.onClick)}
			aria-label={p.label}
			title={p.title}
			style={p.style}
		>
			{p.children ? <span style={S.ellipsis}>{p.children}</span> : null}
		</Button>
	);
	return p.tooltip ? (
		<Tooltip key={p.key} title={p.tooltip}>
			{btn}
		</Tooltip>
	) : (
		btn
	);
}

function getSections(palette, { activeTool, activeItem }, actions) {
	const partSec = (id, title, items, onClick) => ({
		id,
		title,
		grid: S.pGrid,
		items,
		render: (p) =>
			renderBtn({
				active: activeItem?.id === p.id,
				children: p.label,
				icon: renderIcon(resolvePartIconKey(p), p.label),
				key: p.id,
				label: p.label,
				onClick: () => onClick(p),
				style: S.partBtn,
				title: formatPartTitle(p),
			}),
	});

	return [
		{
			id: "tools",
			title: "Tools",
			grid: S.tGrid,
			items: palette.tools,
			render: (t) =>
				renderBtn({
					active: activeTool === t.id,
					disabled: !t.ready,
					icon: renderIcon(t.icon, t.label),
					key: t.id,
					label: t.label,
					onClick: () => actions.onTool(t),
					style: S.toolBtn,
					tooltip: formatTooltip(t),
				}),
		},
		partSec("parts", "Quick parts", palette.parts, actions.onPart),
		partSec("power", "Power", palette.power, actions.onPower),
		{
			id: "layers",
			title: "Layer",
			grid: S.pGrid,
			items: palette.layers,
			render: (l) =>
				renderBtn({
					active: activeItem?.layer === l,
					children: l,
					key: l,
					label: l,
					onClick: () => actions.onLayer(l),
					style: S.layerBtn,
				}),
		},
	];
}

function useActiveToolState(tab) {
	const [activeTool, setActiveTool] = useState("select");
	const [activeItem, setActiveItem] = useState(null);

	useEffect(() => {
		setActiveTool("select");
		setActiveItem(null);
		return onActiveTool((d) => {
			setActiveTool(d.tool);
			setActiveItem(d.item ?? null);
		}, tab);
	}, [tab]);

	return { activeTool, activeItem };
}

function createActions(tab, onOpenLibrary) {
	const emit = (tool, item) => emitEditorTool({ tab, tool, item });
	return {
		onTool: (t) => {
			if (!t.ready) return;
			if (t.id === "placeSymbol" || t.id === "placeFootprint") {
				onOpenLibrary?.();
			} else {
				emit(t.id);
			}
		},
		onPart: (p) => emit(tab === "pcb" ? "placeFootprint" : "placeSymbol", p),
		onPower: (p) => emit("placePower", p),
		onLayer: (l) => emit("setLayer", { layer: l }),
	};
}

export default function ToolPalette({ tab, onOpenLibrary }) {
	const palette = paletteFor(tab);
	const { activeTool, activeItem } = useActiveToolState(tab);
	if (!palette) return null;

	const label = tab === "schematic" ? "Schematic tools" : "PCB tools";
	const actions = createActions(tab, onOpenLibrary);
	const sections = getSections(palette, { activeTool, activeItem }, actions);

	return (
		<aside aria-label={label} style={S.panel}>
			{sections
				.filter((s) => s.items?.length)
				.map((s) => (
					<div key={s.id} style={S.sec}>
						<div style={S.hdr}>{s.title}</div>
						<div style={s.grid}>{s.items.map(s.render)}</div>
					</div>
				))}
		</aside>
	);
}
