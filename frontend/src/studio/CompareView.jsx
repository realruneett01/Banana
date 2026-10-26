import React, { useEffect, useMemo, useRef, useState } from "react";
import {
	Alert,
	Button,
	Checkbox,
	Empty,
	Segmented,
	Select,
	Slider,
	Space,
	Spin,
	Tag,
	Typography,
} from "antd";
import DiffCanvas from "../DiffCanvas.jsx";
import SideBySideDiff from "../SideBySideDiff.jsx";
import { api } from "./api.js";
import { cropToBoard } from "./cropToBoard.js";

const { Text } = Typography;

const BOARD_LAYERS = [
	"F.Cu",
	"B.Cu",
	"F.SilkS",
	"F.Courtyard",
	"Edge.Cuts",
	"F.Fab",
];
const DEFAULT_LAYERS = ["F.Cu", "F.SilkS", "F.Courtyard", "Edge.Cuts"];

const ACTION_COLOR = {
	ADDED: "#22C55E",
	DELETED: "#EF4444",
	CHANGED: "#FACC15",
	MODIFIED: "#FACC15",
};

/**
 * Compare any two builds of the project with the same diff engine and the same renderers the Diff view uses
 * (side by side, overlay slider, colour delta): yellow = changed, green = added, red = deleted, grey = unchanged.
 */
export default function CompareView({
	project,
	history,
	base,
	target,
	onChangeBase,
	onChangeTarget,
	file,
	board,
	refreshToken,
	onOpenDiff,
}) {
	const [payload, setPayload] = useState(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [mode, setMode] = useState("Side by Side");
	const [layers, setLayers] = useState(DEFAULT_LAYERS);
	const [slider, setSlider] = useState(50);
	const [activeIdx, setActiveIdx] = useState(null);
	const sideRef = useRef(null);
	const canvasRef = useRef(null);

	useEffect(() => {
		if (!project || !base || !target) return undefined;
		let cancelled = false;
		setLoading(true);
		setError("");
		api
			.changes(project, { base, target, file })
			.then((p) => !cancelled && setPayload(p))
			.catch((e) => {
				if (!cancelled) {
					setPayload(null);
					setError(e.message);
				}
			})
			.finally(() => !cancelled && setLoading(false));
		return () => {
			cancelled = true;
		};
	}, [project, base, target, file, refreshToken]);

	const options = history.map((c) => ({
		value: c.hash,
		label: `${c.short} · ${c.message}`.slice(0, 60),
	}));
	const isSchematic = file === "schematic";
	const mods = payload?.modifications ?? [];
	const baseSvgs = useMemo(
		() =>
			isSchematic
				? null
				: cropToBoard(payload?.sideBySide?.base ?? payload?.base?.svgs, board),
		[payload, board, isSchematic],
	);
	const targetSvgs = useMemo(
		() =>
			isSchematic
				? null
				: cropToBoard(
						payload?.sideBySide?.target ?? payload?.target?.svgs,
						board,
					),
		[payload, board, isSchematic],
	);
	const baseOverlay = useMemo(
		() => (isSchematic ? null : cropToBoard(payload?.base?.svgs, board)),
		[payload, board, isSchematic],
	);
	const targetOverlay = useMemo(
		() => (isSchematic ? null : cropToBoard(payload?.target?.svgs, board)),
		[payload, board, isSchematic],
	);

	return (
		<div
			data-testid="compare-view"
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				gap: 8,
			}}
		>
			<Space wrap>
				<Text type="secondary">Base</Text>
				<Select
					size="small"
					style={{ width: 230 }}
					value={base}
					options={options}
					onChange={onChangeBase}
					data-testid="compare-base"
				/>
				<Text type="secondary">Target</Text>
				<Select
					size="small"
					style={{ width: 230 }}
					value={target}
					options={options}
					onChange={onChangeTarget}
					data-testid="compare-target"
				/>
				<Segmented
					size="small"
					options={["Side by Side", "Overlay Slider", "Color Delta Map"]}
					value={mode}
					onChange={setMode}
					data-testid="compare-mode"
				/>
				{!isSchematic && (
					<Checkbox.Group
						options={BOARD_LAYERS}
						value={layers}
						onChange={setLayers}
						style={{ fontSize: 11 }}
					/>
				)}
				<Button
					size="small"
					onClick={() => onOpenDiff(base, target)}
					data-testid="compare-open-diff"
				>
					Open in Diff view
				</Button>
				{loading && <Spin size="small" />}
			</Space>
			{error && <Alert type="error" showIcon message={error} />}
			<div
				style={{
					flex: 1,
					minHeight: 0,
					display: "flex",
					flexDirection: "column",
					gap: 8,
				}}
			>
				<div style={{ flex: 1, minHeight: 0, position: "relative" }}>
					{payload ? (
						mode === "Side by Side" ? (
							<SideBySideDiff
								ref={sideRef}
								isSchematic={isSchematic}
								baseSvgs={
									baseSvgs ?? payload.sideBySide?.base ?? payload.base?.svgs
								}
								targetSvgs={
									targetSvgs ??
									payload.sideBySide?.target ??
									payload.target?.svgs
								}
								activeLayers={layers}
								soloLayer={null}
								layerOpacities={{}}
								baseCommit={base}
								targetCommit={target}
								activeAuditIdx={activeIdx}
								setActiveAuditIdx={setActiveIdx}
							/>
						) : (
							<div
								style={{
									position: "absolute",
									inset: 0,
									display: "flex",
									flexDirection: "column",
								}}
							>
								<div style={{ flex: 1, minHeight: 0, position: "relative" }}>
									<DiffCanvas
										ref={canvasRef}
										baseSvgs={baseOverlay ?? payload.base?.svgs}
										targetSvgs={targetOverlay ?? payload.target?.svgs}
										diffMode={mode}
										activeLayers={layers}
										sliderValue={slider}
										onSliderChange={setSlider}
										soloLayer={null}
										layerOpacities={{}}
										baseCommit={base}
										targetCommit={target}
										activeAuditIdx={activeIdx}
										setActiveAuditIdx={setActiveIdx}
									/>
								</div>
								{mode === "Overlay Slider" && (
									<Slider
										min={0}
										max={100}
										value={slider}
										onChange={setSlider}
									/>
								)}
							</div>
						)
					) : (
						!loading && <Empty description="Pick two builds to compare" />
					)}
				</div>
				<div
					style={{
						maxHeight: 96,
						overflowY: "auto",
						borderTop: "1px solid #232738",
						paddingTop: 6,
					}}
					data-testid="compare-changes"
				>
					<Text strong style={{ fontSize: 12, marginRight: 8 }}>
						{mods.length} change{mods.length === 1 ? "" : "s"}
					</Text>
					{mods.length === 0 && (
						<Text type="secondary" style={{ fontSize: 12 }}>
							Identical. Everything is grey.
						</Text>
					)}
					<Space size={[6, 6]} wrap>
						{mods.map((m, i) => (
							<Tag
								key={i}
								data-testid="compare-change"
								color={ACTION_COLOR[m.action] ?? "default"}
								style={{ margin: 0, color: "#000", cursor: "pointer" }}
								onClick={() => setActiveIdx(m.diffIdx ?? i)}
							>
								{m.action} · {m.title || m.detail || m.refDes}
							</Tag>
						))}
					</Space>
				</div>
			</div>
		</div>
	);
}
