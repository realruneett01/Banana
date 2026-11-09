import {
	HistoryOutlined,
	MenuFoldOutlined,
	MenuUnfoldOutlined,
} from "@ant-design/icons";
import {
	Button,
	Card,
	Empty,
	Slider,
	Space,
	Spin,
	Switch,
	Tooltip,
	Typography,
} from "antd";
import { lazy, Suspense, useState } from "react";
import DiffCanvas from "../DiffCanvas";
import EvolutionTimeline from "../EvolutionTimeline";
import SideBySideDiff from "../SideBySideDiff";

const HoloViewer = lazy(() => import("./holo/HoloViewer.jsx"));

const VIEW_TYPES = [
	{ value: "2d", label: "2D Diff", short: "2D" },
	{ value: "holo", label: "3D Hologram", short: "Holo" },
];

const { Text } = Typography;

function DiffEmptyState() {
	return (
		<Card
			style={{
				width: "100%",
				maxWidth: "620px",
				background: "#161821",
				borderColor: "#232738",
				borderRadius: "8px",
			}}
		>
			<Empty
				image={Empty.PRESENTED_IMAGE_SIMPLE}
				description={
					<Space orientation="vertical" size="middle" align="center">
						<Text style={{ fontSize: 16, color: "#a6adbb", fontWeight: 600 }}>
							No 2D Diff Loaded
						</Text>
						<Text
							type="secondary"
							style={{ fontSize: 13, textAlign: "center" }}
						>
							Select a Git repository on the left to run CAD diffs. The 3D
							Hologram view opens once a board diff is loaded.
						</Text>
					</Space>
				}
			/>
		</Card>
	);
}

function getCollapseIcon(collapsed, isLeft) {
	if (isLeft) return collapsed ? MenuUnfoldOutlined : MenuFoldOutlined;
	return collapsed ? MenuFoldOutlined : MenuUnfoldOutlined;
}

function getCollapseLabel(collapsed, isLeft) {
	if (isLeft) return collapsed ? "Show Controls" : "Hide Controls";
	return collapsed ? "Show Audit" : "Hide Audit";
}

const COLLAPSED_STYLE = {
	background: "rgba(250, 219, 20, 0.15)",
	borderColor: "#fadb14",
	color: "#fadb14",
};

const EXPANDED_STYLE = {
	background: "#1e2230",
	borderColor: "#2a2f42",
	color: "#cbd5e1",
};

const BASE_COLLAPSE_BTN_STYLE = {
	border: "1px solid",
	display: "inline-flex",
	alignItems: "center",
	gap: "6px",
	padding: "2px 8px",
	height: "26px",
	borderRadius: "4px",
	cursor: "pointer",
};

function CollapseToggleButton({ collapsed, setCollapsed, isLeft }) {
	const Icon = getCollapseIcon(collapsed, isLeft);
	const text = getCollapseLabel(collapsed, isLeft);
	const activeStyle = collapsed ? COLLAPSED_STYLE : EXPANDED_STYLE;

	return (
		<Button
			type="text"
			size="small"
			icon={<Icon style={{ color: activeStyle.color }} />}
			onClick={() => setCollapsed(!collapsed)}
			style={{ ...BASE_COLLAPSE_BTN_STYLE, ...activeStyle }}
		>
			<span style={{ fontSize: "11px", fontWeight: 600 }}>{text}</span>
		</Button>
	);
}

function getEvolutionTooltip(hasIntermediate, evolutionEnabled) {
	if (!hasIntermediate)
		return "Direct snapshot diff (no intermediate commits between selected revisions)";
	if (evolutionEnabled)
		return "Evolution Mode ON: Viewing step-by-step history. Click to return to direct snapshot diff.";
	return "Toggle to follow the commit-by-commit evolution from base to target.";
}

const ACTIVE_EVO_COLORS = { icon: "#60a5fa", text: "#93c5fd", bg: "#3b82f6" };
const INACTIVE_EVO_COLORS = { icon: "#94a3b8", text: "#cbd5e1", bg: "#334155" };

function getEvolutionBadgeStyle(evolutionEnabled, hasIntermediate) {
	return {
		display: "inline-flex",
		alignItems: "center",
		gap: "8px",
		padding: "3px 10px",
		borderRadius: "6px",
		background: evolutionEnabled ? "rgba(59, 130, 246, 0.2)" : "#1e2230",
		border: `1px solid ${evolutionEnabled ? "#3b82f6" : "#2a2f42"}`,
		cursor: hasIntermediate ? "pointer" : "default",
		transition: "all 0.2s",
		opacity: hasIntermediate ? 1 : 0.6,
	};
}

function EvolutionToggleBadge({
	hasIntermediate,
	evolutionEnabled,
	toggleEvolutionMode,
}) {
	const tooltip = getEvolutionTooltip(hasIntermediate, evolutionEnabled);
	const colors = evolutionEnabled ? ACTIVE_EVO_COLORS : INACTIVE_EVO_COLORS;
	const containerStyle = getEvolutionBadgeStyle(
		evolutionEnabled,
		hasIntermediate,
	);

	const handleClick = () => {
		if (hasIntermediate) toggleEvolutionMode();
	};

	const handleSwitchChange = (checked, e) => {
		if (e?.stopPropagation) e.stopPropagation();
		toggleEvolutionMode(checked);
	};

	return (
		<Tooltip title={tooltip}>
			<div style={containerStyle} onClick={handleClick}>
				<HistoryOutlined style={{ color: colors.icon, fontSize: "13px" }} />
				<span style={{ fontSize: "11px", fontWeight: 600, color: colors.text }}>
					History Evolution
				</span>
				<Switch
					size="small"
					checked={evolutionEnabled}
					disabled={!hasIntermediate}
					onChange={handleSwitchChange}
					style={{ backgroundColor: colors.bg }}
				/>
			</div>
		</Tooltip>
	);
}

function ViewportHeader({
	leftCollapsed,
	setLeftCollapsed,
	rightCollapsed,
	setRightCollapsed,
	relativeFilePath,
	evolutionEnabled,
	evolutionData,
	toggleEvolutionMode,
	viewType,
	setViewType,
}) {
	return (
		<div className="bn-viewport-header">
			<div className="bn-viewport-header-left">
				<span className="bn-hide-compact">
					<CollapseToggleButton
						collapsed={leftCollapsed}
						setCollapsed={setLeftCollapsed}
						isLeft={true}
					/>
				</span>
				<span
					className="bn-viewport-title"
					title={relativeFilePath || "Hardware Project"}
				>
					{relativeFilePath || "Hardware Project"}
				</span>

				{/* 2D diff / 3D stackup prototype / 3D hologram of the real board */}
				<div className="bn-viewswitch" role="tablist">
					{VIEW_TYPES.map(({ value, label, short }) => (
						<button
							key={value}
							type="button"
							role="tab"
							aria-selected={viewType === value}
							className={viewType === value ? "is-active" : ""}
							onClick={() => setViewType(value)}
						>
							<span className="bn-viewswitch-long">{label}</span>
							<span className="bn-viewswitch-short">{short}</span>
						</button>
					))}
				</div>
			</div>

			<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
				{viewType === "2d" && (
					<EvolutionToggleBadge
						hasIntermediate={evolutionData?.hasIntermediate}
						evolutionEnabled={evolutionEnabled}
						toggleEvolutionMode={toggleEvolutionMode}
					/>
				)}
				<span className="bn-hide-compact">
					<CollapseToggleButton
						collapsed={rightCollapsed}
						setCollapsed={setRightCollapsed}
						isLeft={false}
					/>
				</span>
			</div>
		</div>
	);
}

function OverlaySliderBar({
	baseCommit,
	targetCommit,
	sliderValue,
	setSliderValue,
}) {
	return (
		<div style={{ marginTop: "15px" }}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					marginBottom: "4px",
				}}
			>
				<Text type="secondary">Base Commit ({baseCommit})</Text>
				<Text type="warning">Split: {sliderValue}%</Text>
				<Text type="secondary">Target Commit ({targetCommit})</Text>
			</div>
			<Slider
				min={0}
				max={100}
				value={sliderValue}
				onChange={setSliderValue}
				tooltip={{ formatter: (v) => `Split: ${v}%` }}
			/>
		</div>
	);
}

function DiffCanvasContainer(props) {
	const {
		diffMode,
		sideBySideRef,
		isSchematic,
		diffData,
		selectedLayers,
		soloLayer,
		layerOpacities,
		baseCommit,
		targetCommit,
		activeAuditIdx,
		setActiveAuditIdx,
		padLabelProps,
		diffCanvasRef,
		sliderValue,
		setSliderValue,
	} = props;

	if (diffMode === "Side by Side") {
		return (
			<SideBySideDiff
				ref={sideBySideRef}
				isSchematic={isSchematic}
				baseSvgs={diffData.sideBySide?.base ?? diffData.base?.svgs}
				targetSvgs={diffData.sideBySide?.target ?? diffData.target?.svgs}
				activeLayers={selectedLayers}
				soloLayer={soloLayer}
				layerOpacities={layerOpacities}
				baseCommit={baseCommit}
				targetCommit={targetCommit}
				activeAuditIdx={activeAuditIdx}
				setActiveAuditIdx={setActiveAuditIdx}
				padLabelProps={padLabelProps}
			/>
		);
	}

	return (
		<DiffCanvas
			ref={diffCanvasRef}
			baseSvgs={diffData.base?.svgs}
			targetSvgs={diffData.target?.svgs}
			diffMode={diffMode}
			activeLayers={selectedLayers}
			sliderValue={sliderValue}
			onSliderChange={setSliderValue}
			soloLayer={soloLayer}
			layerOpacities={layerOpacities}
			baseCommit={baseCommit}
			targetCommit={targetCommit}
			activeAuditIdx={activeAuditIdx}
			setActiveAuditIdx={setActiveAuditIdx}
		/>
	);
}

function canShowEvolution(enabled, data) {
	if (!enabled) return false;
	return Boolean(data?.commits?.length >= 2);
}

function EvolutionTimelineOverlay(props) {
	const {
		evolutionEnabled,
		evolutionData,
		evolutionStep,
		evolutionPlaying,
		evolutionLoading,
		evolutionMode,
		toggleEvolutionMode,
		loadEvolutionStep,
		setEvolutionPlaying,
		setEvolutionMode,
	} = props;

	if (!canShowEvolution(evolutionEnabled, evolutionData)) {
		return null;
	}

	return (
		<EvolutionTimeline
			commits={evolutionData.commits}
			activeStep={evolutionStep}
			onStepChange={(stepIdx) => loadEvolutionStep(stepIdx)}
			isPlaying={evolutionPlaying}
			onTogglePlay={() => setEvolutionPlaying(!evolutionPlaying)}
			onClose={() => toggleEvolutionMode(false)}
			isLoading={evolutionLoading}
			mode={evolutionMode}
			onModeChange={(m) => {
				setEvolutionMode(m);
				loadEvolutionStep(evolutionStep, m);
			}}
		/>
	);
}

function ViewportBody(props) {
	const {
		diffMode,
		baseCommit,
		targetCommit,
		sliderValue,
		setSliderValue,
		isSchematic,
		viewType,
	} = props;

	if (viewType === "holo") {
		return (
			<div
				style={{
					flex: 1,
					minHeight: 0,
					position: "relative",
					width: "100%",
					height: "100%",
				}}
			>
				<Suspense fallback={<Spin />}>
					<HoloViewer source={props.padLabelProps} />
				</Suspense>
			</div>
		);
	}

	return (
		<div style={{ flex: 1, minHeight: 0, position: "relative" }}>
			<DiffCanvasContainer {...props} isSchematic={isSchematic} />
			<EvolutionTimelineOverlay {...props} />
			{diffMode === "Overlay Slider" && (
				<OverlaySliderBar
					baseCommit={baseCommit}
					targetCommit={targetCommit}
					sliderValue={sliderValue}
					setSliderValue={setSliderValue}
				/>
			)}
		</div>
	);
}

export function DiffViewport(props) {
	const { diffData, relativeFilePath } = props;
	const [viewType, setViewType] = useState("2d");

	if (!diffData && viewType === "2d") {
		return <DiffEmptyState />;
	}

	const isSchematic = Boolean(relativeFilePath?.endsWith(".kicad_sch"));

	return (
		<Card
			title={
				<ViewportHeader
					{...props}
					viewType={viewType}
					setViewType={setViewType}
				/>
			}
			className="bn-viewport-card"
			style={{
				width: "100%",
				height: "100%",
				background: "var(--bn-surface)",
				borderColor: "var(--bn-border)",
				display: "flex",
				flexDirection: "column",
			}}
			styles={{
				body: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					padding: viewType === "2d" ? "20px" : "0px",
					overflow: "hidden",
				},
			}}
		>
			<ViewportBody {...props} isSchematic={isSchematic} viewType={viewType} />
		</Card>
	);
}
