import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
	Alert,
	Button,
	Card,
	Empty,
	Form,
	Input,
	Modal,
	Segmented,
	Select,
	Space,
	Tabs,
	Tag,
	Tooltip,
	Typography,
} from "antd";
import {
	BranchesOutlined,
	FolderAddOutlined,
	RedoOutlined,
	ThunderboltOutlined,
	UndoOutlined,
} from "@ant-design/icons";
import AssistantPanel from "./AssistantPanel.jsx";
import BoardCanvas from "./BoardCanvas.jsx";
import ChecksPanel from "./ChecksPanel.jsx";
import CompareView from "./CompareView.jsx";
import HistoryPanel from "./HistoryPanel.jsx";
import InspectorPanel from "./InspectorPanel.jsx";
import PartsPanel from "./PartsPanel.jsx";
import SimulationPanel from "./SimulationPanel.jsx";
import { api } from "./api.js";
import { useStudio } from "./useStudio.js";
import { useStudioAssistant } from "./useStudioAssistant.js";
import { useSvgView } from "./useSvgView.js";

const { Text, Title } = Typography;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const PANEL = {
	background: "#161821",
	border: "1px solid #232738",
	borderRadius: 8,
};

function NewProjectModal({ open, onClose, onCreate }) {
	const [form] = Form.useForm();
	return (
		<Modal
			title="New board project"
			open={open}
			onCancel={onClose}
			okText="Create"
			okButtonProps={{ "data-testid": "create-project-confirm" }}
			onOk={async () => {
				const v = await form.validateFields().catch(() => null);
				if (!v) return;
				const name = await onCreate(v.name, v.title);
				if (name) {
					form.resetFields();
					onClose();
				}
			}}
			destroyOnHidden
		>
			<Form form={form} layout="vertical">
				<Form.Item
					name="name"
					label="Project name"
					rules={[
						{ required: true, message: "Enter a name" },
						{
							pattern: NAME_RE,
							message:
								"Lowercase letters, digits, dash and underscore; start with a letter or digit",
						},
					]}
				>
					<Input data-testid="project-name" placeholder="led-flasher" />
				</Form.Item>
				<Form.Item name="title" label="Title (optional)">
					<Input data-testid="project-title" placeholder="LED flasher" />
				</Form.Item>
			</Form>
		</Modal>
	);
}

function Welcome({ projects, onOpen, onNew }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				height: "100%",
			}}
		>
			<Card style={{ ...PANEL, width: 520 }} data-testid="studio-welcome">
				<Space direction="vertical" size="middle" style={{ width: "100%" }}>
					<Title level={4} style={{ margin: 0, color: "#fff" }}>
						Banana Studio
					</Title>
					<Text type="secondary">
						Design a board by describing it, then refine it by hand. Everything
						is drawn by KiCad, every change is a build you can compare, undo or
						open in the Diff view.
					</Text>
					<Button
						type="primary"
						icon={<FolderAddOutlined />}
						onClick={onNew}
						data-testid="welcome-new"
					>
						New project
					</Button>
					{projects.length > 0 && (
						<>
							<Text type="secondary">Or open one:</Text>
							<Space wrap>
								{projects.map((p) => (
									<Button
										key={p.name}
										onClick={() => onOpen(p.name)}
										data-testid={`open-${p.name}`}
									>
										{p.name} · {p.parts} parts
									</Button>
								))}
							</Space>
						</>
					)}
				</Space>
			</Card>
		</div>
	);
}

export default function StudioApp({ onOpenDiff }) {
	const studio = useStudio();
	const { state, history, project } = studio;
	const [view, setView] = useState("board");
	const [side, setSide] = useState("front");
	const [rev, setRev] = useState("working");
	const [compare, setCompare] = useState({ base: "", target: "" });
	const [newOpen, setNewOpen] = useState(false);
	const [bump, setBump] = useState(0);
	const [review, setReview] = useState(null);
	const [leftTab, setLeftTab] = useState("parts");
	const [rightTab, setRightTab] = useState("assistant");

	const assistant = useStudioAssistant({
		project,
		onDesignChanged: useCallback(() => {
			studio.refresh();
			setBump((b) => b + 1);
		}, [studio]),
		onDone: useCallback(
			async (done) => {
				const s = await studio.refresh();
				setBump((b) => b + 1);
				if (done?.committed && s) setReview(done.commit);
			},
			[studio],
		),
	});

	useEffect(() => {
		if (studio.selected) setRightTab("inspector");
	}, [studio.selected]);

	// reset view state when switching projects
	useEffect(() => {
		setRev("working");
		setReview(null);
		setView("board");
		setCompare({ base: "", target: "" });
		setCompareTouched(false);
	}, [project]);

	const head = state?.head;
	const [compareTouched, setCompareTouched] = useState(false);
	// a picked pair only lasts until the next build; after that "Changes" shows the newest change again
	useEffect(() => setCompareTouched(false), [head]);
	// The oldest commit only holds design.json (no board yet), so a comparison needs at least three entries.
	const canCompare = history.length >= 3;
	// default comparison: the latest build against the one before it, until the user picks something else
	useEffect(() => {
		if (!canCompare) return;
		const known = (h) => history.some((c) => c.hash === h);
		if (!compareTouched || !known(compare.base) || !known(compare.target)) {
			setCompare({ base: history[1].hash, target: history[0].hash });
		}
	}, [history, canCompare, compareTouched, compare.base, compare.target]);

	const showEditor = view === "board" || view === "schematic";
	const kind = view === "schematic" ? "schematic" : "board";
	const token = `${head}|${state?.needsBuild}|${bump}`;
	const svg = useSvgView({
		project,
		kind,
		view: side,
		rev,
		token,
		enabled: Boolean(project && state?.built && showEditor),
	});

	const busy = studio.busy || (assistant.streaming ? "Assistant working" : "");
	const interactive =
		view === "board" && rev === "working" && side !== "back" && !busy;
	const selectedPart = state?.parts.find((p) => p.ref === studio.selected);

	const onMove = useCallback(
		(ref, x, y, rot) => studio.movePart(ref, x, y, rot),
		[studio],
	);
	const onRotate = useCallback(
		(ref) => {
			const p = state?.parts.find((q) => q.ref === ref);
			if (!p?.at) return;
			studio.edit(
				[
					{
						op: "place",
						ref,
						x: p.at.x,
						y: p.at.y,
						rot: ((p.at.rot || 0) + 90) % 360,
					},
					...((state.routing?.tracks ?? 0) > 0
						? [{ op: "clear_routing" }]
						: []),
				],
				`Rotate ${ref}`,
				{
					reroute: (state.routing?.tracks ?? 0) > 0,
				},
			);
		},
		[state, studio],
	);
	const onDelete = useCallback(
		(ref) => {
			const routed = (state?.routing?.tracks ?? 0) > 0;
			studio.setSelected(null);
			return studio.edit(
				[
					{ op: "remove_part", ref },
					...(routed ? [{ op: "clear_routing" }] : []),
				],
				`Remove ${ref}`,
				{ reroute: routed },
			);
		},
		[state, studio],
	);
	const onInspectorEdit = useCallback(
		(ops, message, options) => {
			const routed = (state?.routing?.tracks ?? 0) > 0;
			const withClear =
				options?.reroute && routed && !ops.some((o) => o.op === "clear_routing")
					? [...ops, { op: "clear_routing" }]
					: ops;
			return studio.edit(withClear, message, {
				reroute: Boolean(options?.reroute && routed),
			});
		},
		[state, studio],
	);
	const onAddPart = useCallback(
		(p) =>
			studio.edit(
				[
					{
						op: "add_part",
						symbol: p.symbol,
						value: p.value,
						footprint: p.footprint,
					},
				],
				`Add ${p.value}`,
			),
		[studio],
	);

	const projectPath = studio.projects.find((p) => p.name === project)?.path;
	const openDiff = useCallback(
		(base, target) => {
			if (!projectPath || !onOpenDiff) return;
			onOpenDiff({
				repoPath: projectPath,
				baseCommit: base,
				targetCommit: target,
				relativeFilePath: `${project}.${view === "schematic" ? "kicad_sch" : "kicad_pcb"}`,
			});
		},
		[onOpenDiff, project, projectPath, view],
	);
	const openCompare = (base, target) => {
		setCompareTouched(true);
		setCompare({ base, target });
		setView("compare");
		setReview(null);
	};

	const create = useCallback(
		async (name, title) => {
			const created = await studio.createProject(name, title);
			if (created) {
				try {
					await api.tool("build", { project: name, message: "Initial board" });
					await studio.refresh(name);
				} catch {
					/* the first edit builds it anyway */
				}
			}
			return created;
		},
		[studio],
	);

	const statusTag = useMemo(() => {
		if (busy)
			return (
				<Tag color="processing" data-testid="status">
					{busy}…
				</Tag>
			);
		if (!state) return null;
		if (rev !== "working")
			return (
				<Tag color="gold" data-testid="status">
					viewing history
				</Tag>
			);
		return state.needsBuild ? (
			<Tag color="orange" data-testid="status">
				unsaved
			</Tag>
		) : (
			<Tag color="green" data-testid="status">
				saved
			</Tag>
		);
	}, [busy, state, rev]);

	return (
		<div
			data-testid="studio"
			style={{
				height: "calc(100vh - 56px)",
				display: "flex",
				flexDirection: "column",
				background: "#0f1015",
				padding: 10,
				gap: 10,
			}}
		>
			<div
				style={{
					...PANEL,
					padding: "8px 12px",
					display: "flex",
					alignItems: "center",
					gap: 12,
					flexWrap: "wrap",
				}}
				data-testid="studio-toolbar"
			>
				<Select
					style={{ width: 200 }}
					placeholder="Choose a project"
					value={project || undefined}
					onChange={studio.setProject}
					options={studio.projects.map((p) => ({
						value: p.name,
						label: p.name,
					}))}
					data-testid="project-select"
				/>
				<Button
					icon={<FolderAddOutlined />}
					onClick={() => setNewOpen(true)}
					data-testid="new-project"
				>
					New
				</Button>
				{project && (
					<>
						<Segmented
							data-testid="view-switch"
							value={view}
							onChange={setView}
							options={[
								{ label: "Board", value: "board" },
								{ label: "Schematic", value: "schematic" },
								{ label: "Changes", value: "compare" },
							]}
						/>
						{view === "board" && (
							<Segmented
								size="small"
								data-testid="side-switch"
								value={side}
								onChange={setSide}
								options={[
									{ label: "Front", value: "front" },
									{ label: "Back", value: "back" },
									{ label: "Both", value: "all" },
								]}
							/>
						)}
						<Space.Compact>
							<Tooltip title="Undo the last build or assistant step">
								<Button
									icon={<UndoOutlined />}
									onClick={studio.undo}
									disabled={!state?.canUndo || Boolean(busy)}
									data-testid="undo"
								>
									Undo
								</Button>
							</Tooltip>
							<Tooltip title="Redo">
								<Button
									icon={<RedoOutlined />}
									onClick={studio.redo}
									disabled={!state?.canRedo || Boolean(busy)}
									data-testid="redo"
								/>
							</Tooltip>
						</Space.Compact>
						<Button
							icon={<BranchesOutlined />}
							onClick={studio.autoroute}
							disabled={!state?.parts.length || Boolean(busy)}
							data-testid="route"
						>
							Route
						</Button>
						<Button
							icon={<ThunderboltOutlined />}
							onClick={() => {
								setRightTab("checks");
								studio.runChecks();
							}}
							disabled={!state?.parts.length || Boolean(busy)}
							data-testid="check"
						>
							Check
						</Button>
						{statusTag}
						<div style={{ flex: 1 }} />
						<Text
							type="secondary"
							style={{ fontSize: 12 }}
							data-testid="board-size"
						>
							{state?.board
								? `${state.board.width} × ${state.board.height} mm`
								: ""}
						</Text>
						<Button
							onClick={() =>
								canCompare && openDiff(history[1].hash, history[0].hash)
							}
							disabled={!canCompare || !projectPath}
							data-testid="open-in-diff"
						>
							Open in Diff view
						</Button>
					</>
				)}
			</div>

			{!project ? (
				<Welcome
					projects={studio.projects}
					onOpen={studio.setProject}
					onNew={() => setNewOpen(true)}
				/>
			) : (
				<div style={{ flex: 1, minHeight: 0, display: "flex", gap: 10 }}>
					<div
						style={{ ...PANEL, width: 290, padding: 10, overflowY: "auto" }}
						data-testid="left-panel"
					>
						<Tabs
							size="small"
							activeKey={leftTab}
							onChange={setLeftTab}
							items={[
								{
									key: "parts",
									label: "Parts",
									children: (
										<PartsPanel
											state={state}
											selected={studio.selected}
											onSelect={studio.setSelected}
											onAddPart={onAddPart}
											disabled={Boolean(busy)}
										/>
									),
								},
								{
									key: "history",
									label: `History (${history.length})`,
									children: (
										<HistoryPanel
											history={history}
											head={head}
											viewing={rev === "working" ? head : rev}
											onView={(r) => {
												setRev(r);
												if (view === "compare") setView("board");
											}}
											onCompare={openCompare}
											onOpenDiff={openDiff}
										/>
									),
								},
							]}
						/>
					</div>

					<div
						style={{
							...PANEL,
							flex: 1,
							minWidth: 0,
							padding: 8,
							position: "relative",
							display: "flex",
							flexDirection: "column",
							gap: 8,
						}}
					>
						{rev !== "working" && showEditor && (
							<Alert
								type="warning"
								showIcon
								data-testid="history-banner"
								message={`Viewing an earlier build (${rev.slice(0, 7)}). Editing is off.`}
								action={
									<Button
										size="small"
										onClick={() => setRev("working")}
										data-testid="return-latest"
									>
										Back to latest
									</Button>
								}
							/>
						)}
						{review && view !== "compare" && !busy && (
							<Alert
								type="info"
								showIcon
								closable
								onClose={() => setReview(null)}
								data-testid="review-banner"
								message="The assistant changed the board."
								action={
									<Space>
										<Button
											size="small"
											type="primary"
											onClick={() =>
												canCompare &&
												openCompare(history[1].hash, history[0].hash)
											}
											data-testid="review-changes"
										>
											Review changes
										</Button>
										<Button
											size="small"
											onClick={() => {
												setReview(null);
												studio.undo();
											}}
											data-testid="review-undo"
										>
											Undo
										</Button>
									</Space>
								}
							/>
						)}
						<div style={{ flex: 1, minHeight: 0, position: "relative" }}>
							{view === "compare" ? (
								canCompare ? (
									<CompareView
										project={project}
										history={history}
										base={compare.base}
										target={compare.target}
										onChangeBase={(b) => {
											setCompareTouched(true);
											setCompare((c) => ({ ...c, base: b }));
										}}
										onChangeTarget={(t) => {
											setCompareTouched(true);
											setCompare((c) => ({ ...c, target: t }));
										}}
										file="board"
										board={state?.board}
										refreshToken={head}
										onOpenDiff={openDiff}
									/>
								) : (
									<Empty description="Make a change first: the Changes view compares two builds." />
								)
							) : (
								<BoardCanvas
									url={state?.built ? svg.url : null}
									vb={svg.vb}
									transform={state?.transform}
									parts={view === "board" ? state?.parts : []}
									selected={studio.selected}
									onSelect={studio.setSelected}
									onMove={onMove}
									onRotate={onRotate}
									onDelete={onDelete}
									interactive={interactive}
									loading={svg.loading}
									error={svg.error}
									emptyText={
										state && !state.built
											? "Empty board. Add a part, or ask the assistant to design something."
											: undefined
									}
								/>
							)}
						</div>
					</div>

					<div
						style={{
							...PANEL,
							width: 370,
							padding: 10,
							display: "flex",
							flexDirection: "column",
						}}
						data-testid="right-panel"
					>
						<Tabs
							size="small"
							style={{ flex: 1, minHeight: 0 }}
							className="studio-right-tabs"
							activeKey={rightTab}
							onChange={setRightTab}
							items={[
								{
									key: "assistant",
									label: "Assistant",
									children: (
										<div style={{ height: "calc(100vh - 230px)" }}>
											<AssistantPanel assistant={assistant} project={project} />
										</div>
									),
								},
								{
									key: "inspector",
									label: "Inspector",
									children: (
										<InspectorPanel
											state={state}
											selected={selectedPart?.ref}
											onEdit={onInspectorEdit}
											onDelete={onDelete}
											disabled={Boolean(busy) || rev !== "working"}
										/>
									),
								},
								{
									key: "checks",
									label: "Checks",
									children: (
										<ChecksPanel
											checks={studio.checks}
											onRun={studio.runChecks}
											busy={studio.busy}
										/>
									),
								},
								{
									key: "simulate",
									label: "Simulate",
									children: (
										<SimulationPanel
											state={state}
											simulation={studio.simulation}
											onRun={studio.runSimulation}
											busy={studio.busy}
										/>
									),
								},
							]}
						/>
					</div>
				</div>
			)}
			<NewProjectModal
				open={newOpen}
				onClose={() => setNewOpen(false)}
				onCreate={create}
			/>
			{studio.error && !state && project && (
				<Alert
					type="error"
					showIcon
					message={studio.error}
					style={{ position: "fixed", bottom: 16, left: 16 }}
				/>
			)}
		</div>
	);
}
