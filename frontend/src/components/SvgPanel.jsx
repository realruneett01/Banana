import { ArrowLeftOutlined, ArrowRightOutlined } from "@ant-design/icons";
import { Tag, Typography } from "antd";
import React from "react";
import { isLayerActive, resolveLayerVisuals } from "../utils/diffLayerUtils.js";

const { Text } = Typography;

const LAYER_PROP_KEYS = ["content", "layerTier", "opacityStyle", "filterStyle"];

function areLayerPropsEqual(prev, next) {
	return LAYER_PROP_KEYS.every((key) => prev[key] === next[key]);
}

function formatSvgContent(content) {
	return content.replace(
		/<svg/,
		'<svg style="width:100%;height:100%;position:absolute;"',
	);
}

function SvgLayerContent({ content, layerTier, opacityStyle, filterStyle }) {
	return (
		<div
			className={layerTier}
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				width: "100%",
				height: "100%",
				opacity: opacityStyle,
				filter: filterStyle,
				transition: "opacity 0.15s, filter 0.2s",
				pointerEvents: "none",
			}}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: raw SVG string from backend diff rendered into viewport
			dangerouslySetInnerHTML={{
				__html: formatSvgContent(content),
			}}
		/>
	);
}

export const SideBySideSvgLayer = React.memo(
	SvgLayerContent,
	areLayerPropsEqual,
);

function HeaderTag({ isBase }) {
	return (
		<Tag
			color={isBase ? "red" : "green"}
			style={{ margin: 0, fontWeight: 700, letterSpacing: "0.05em" }}
		>
			{isBase ? (
				<>
					<ArrowLeftOutlined /> BASE
				</>
			) : (
				<>
					TARGET <ArrowRightOutlined />
				</>
			)}
		</Tag>
	);
}

function LegendBadge({ color, dotColor, label }) {
	return (
		<span
			style={{
				fontSize: "10px",
				color,
				display: "flex",
				alignItems: "center",
				gap: "3px",
			}}
		>
			<span
				style={{
					width: 8,
					height: 8,
					borderRadius: "50%",
					background: dotColor,
					display: "inline-block",
				}}
			/>
			{label}
		</span>
	);
}

function getLegendItems(isBase) {
	const baseColor = isBase ? "#ff3366" : "#00ff66";
	return [
		{
			label: isBase ? "Deleted" : "Added",
			color: baseColor,
			dotColor: baseColor,
		},
		{
			label: "Changed",
			color: "#ffff00",
			dotColor: "#ffff00",
		},
		{
			label: "Unchanged",
			color: "#a1a1aa",
			dotColor: "#71717a",
		},
	];
}

function HeaderLegend({ isBase }) {
	const items = getLegendItems(isBase);
	return (
		<div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
			{items.map((item) => (
				<LegendBadge
					key={item.label}
					color={item.color}
					dotColor={item.dotColor}
					label={item.label}
				/>
			))}
		</div>
	);
}

function PanelHeader({ isBase, commitLabel }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				padding: "8px 14px",
				background: isBase ? "rgba(192,57,43,0.12)" : "rgba(39,174,96,0.12)",
				borderBottom: `1px solid ${isBase ? "#3d1f1f" : "#1f3d2a"}`,
				flexShrink: 0,
				gap: "8px",
			}}
		>
			<HeaderTag isBase={isBase} />
			<Text
				style={{
					fontSize: "11px",
					color: "#a6adbb",
					fontFamily: "monospace",
					flex: 1,
					textAlign: "center",
				}}
			>
				{commitLabel}
			</Text>
			<HeaderLegend isBase={isBase} />
		</div>
	);
}

function EmptyLayerNotice() {
	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				color: "#444",
				fontSize: 14,
			}}
		>
			No layers selected
		</div>
	);
}

function renderLayerItem(svg, side, soloLayer, layerOpacities) {
	const visuals = resolveLayerVisuals(svg.filename, soloLayer, layerOpacities);
	return (
		<SideBySideSvgLayer
			key={`${side}-${svg.filename}`}
			content={svg.content}
			layerTier={visuals.layerTier}
			opacityStyle={visuals.opacityStyle}
			filterStyle={visuals.filterStyle}
		/>
	);
}

function SvgLayerList({ filtered, side, soloLayer, layerOpacities }) {
	if (filtered.length === 0) {
		return <EmptyLayerNotice />;
	}

	return filtered.map((svg) =>
		renderLayerItem(svg, side, soloLayer, layerOpacities),
	);
}

function PanelViewport({ contentRef, transform, children }) {
	return (
		<div
			className="diff-viewport"
			style={{
				flex: 1,
				overflow: "hidden",
				position: "relative",
				cursor: "grab",
				userSelect: "none",
			}}
		>
			<div
				ref={contentRef}
				style={{
					width: "100%",
					height: "100%",
					transformOrigin: "0 0",
					position: "relative",
					transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
				}}
			>
				{children}
			</div>
		</div>
	);
}

export function SvgPanel({
	svgs,
	activeLayers,
	soloLayer,
	layerOpacities,
	contentRef,
	side,
	commitLabel,
	transform,
}) {
	const filtered = (svgs || []).filter((svg) =>
		isLayerActive(svg.filename, activeLayers),
	);
	const isBase = side === "base";

	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				minWidth: 0,
				overflow: "hidden",
				borderRadius: "6px",
				border: `1px solid ${isBase ? "#3d1f1f" : "#1f3d2a"}`,
				background: "#12131e",
			}}
		>
			<PanelHeader isBase={isBase} commitLabel={commitLabel} />
			<PanelViewport contentRef={contentRef} transform={transform}>
				<SvgLayerList
					filtered={filtered}
					side={side}
					soloLayer={soloLayer}
					layerOpacities={layerOpacities}
				/>
			</PanelViewport>
		</div>
	);
}
