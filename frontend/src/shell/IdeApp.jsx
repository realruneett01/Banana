import {
	BranchesOutlined,
	GithubOutlined,
	SearchOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Tabs, Tooltip } from "antd";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import ChatbotDrawer from "../ChatbotDrawer.jsx";
import AgentDesignPanel from "../components/AgentDesignPanel.jsx";
import GithubConnectModal from "../components/GithubConnectModal.jsx";
import SimulationDrawer from "../components/SimulationDrawer.jsx";
import { WorkspaceControlSidebar } from "../components/WorkspaceControlSidebar.jsx";
import ChecksPanel from "../editor/ChecksPanel.jsx";
import { editorStatus } from "../editor/editorStatus.js";
import ProjectHome from "../projects/ProjectHome.jsx";
import { ActivityBar } from "./ActivityBar.jsx";
import { CommandPalette } from "./CommandPalette.jsx";
import { EditorTabs } from "./EditorTabs.jsx";
import { IdeShell } from "./IdeShell.jsx";
import {
	IdeTabContent,
	runEditCurrentFile,
	tabForKind,
} from "./IdeTabContent.jsx";
import { useIdeLayout } from "./ideLayout.js";
import {
	formatCoordinates,
	formatGrid,
	formatProblemsStatus,
	StatusBar,
} from "./StatusBar.jsx";

// --- Pure ide-app helpers ---
const COMMAND_TAB_TITLES = Object.freeze({
	schematic: "Schematic",
	pcb: "PCB",
	"3d": "3D Studio",
	diff: "Diff",
});

function getCommandTab(kind) {
	return { id: kind, kind, title: COMMAND_TAB_TITLES[kind] || kind };
}

function makeCmd(options) {
	const { id, title, category, run, shortcut } = options;
	const cmd = { id, title, category, run };
	if (shortcut) cmd.shortcut = shortcut;
	return cmd;
}

function buildEditorCommands({ dispatch, loop }) {
	const openEditor = (kind) => {
		dispatch?.({ type: "openTab", tab: getCommandTab(kind) });
		loop?.openEditor?.();
	};
	return [
		makeCmd({
			id: "open-editor-schematic",
			title: "Open Editor: Schematic",
			category: "Editor",
			run: () => openEditor("schematic"),
		}),
		makeCmd({
			id: "open-editor-pcb",
			title: "Open Editor: PCB",
			category: "Editor",
			run: () => openEditor("pcb"),
		}),
		makeCmd({
			id: "open-3d-studio",
			title: "Open 3D Studio",
			category: "View",
			run: () => {
				dispatch?.({ type: "openTab", tab: getCommandTab("3d") });
				loop?.openStudio?.();
			},
		}),
	];
}

const TOGGLE_COMMAND_ITEMS = Object.freeze([
	{ id: "toggle-sidebar", title: "Toggle Sidebar", type: "toggleSidebar" },
	{ id: "toggle-ai-panel", title: "Toggle AI Panel", type: "toggleAux" },
	{
		id: "toggle-bottom-panel",
		title: "Toggle Bottom Panel",
		type: "toggleBottom",
	},
]);

function buildLayoutCommands({ dispatch }) {
	const toggleCmds = TOGGLE_COMMAND_ITEMS.map((item) =>
		makeCmd({
			id: item.id,
			title: item.title,
			category: "View",
			run: () => dispatch?.({ type: item.type }),
		}),
	);
	return [
		makeCmd({
			id: "open-diff",
			title: "Open Diff",
			category: "View",
			run: () => dispatch?.({ type: "openTab", tab: getCommandTab("diff") }),
		}),
		...toggleCmds,
	];
}

const ACTIVITY_COMMAND_ITEMS = Object.freeze([
	{
		id: "show-explorer",
		title: "Show Explorer",
		actId: "explorer",
		shortcut: "Ctrl+Shift+E",
	},
	{
		id: "show-source-control",
		title: "Show Source Control",
		actId: "scm",
		shortcut: "Ctrl+Shift+G",
	},
	{
		id: "show-simulation",
		title: "Show Simulation",
		actId: "simulation",
		shortcut: "Ctrl+Shift+S",
	},
]);

function buildActivityCommands({ dispatch }) {
	return ACTIVITY_COMMAND_ITEMS.map((item) =>
		makeCmd({
			id: item.id,
			title: item.title,
			category: "View",
			run: () => dispatch?.({ type: "setActivity", id: item.actId }),
			shortcut: item.shortcut,
		}),
	);
}

function buildExternalCommands({ ws }) {
	return [
		makeCmd({
			id: "connect-github",
			title: "Connect GitHub",
			category: "GitHub",
			run: () => ws?.shellProps?.onOpenGithubModal?.(),
		}),
	];
}

export function buildIdeCommands({ dispatch, loop, ws }) {
	return [
		...buildEditorCommands({ dispatch, loop }),
		...buildLayoutCommands({ dispatch }),
		...buildActivityCommands({ dispatch }),
		...buildExternalCommands({ ws }),
	];
}

const SHORTCUT_ACTIVITIES = Object.freeze({
	e: "explorer",
	f: "search",
	g: "scm",
	l: "library",
	s: "simulation",
});

function handleActivityShortcut(key, dispatch) {
	if (key === "a") {
		dispatch?.({ type: "toggleAux" });
		return true;
	}
	const activity = SHORTCUT_ACTIVITIES[key];
	if (!activity) return false;
	dispatch?.({ type: "setActivity", id: activity });
	return true;
}

function hasModifier(event) {
	return Boolean(event?.ctrlKey || event?.metaKey);
}

function isPaletteShortcut(shiftKey, key) {
	if (shiftKey) return key === "p";
	return key === "k";
}

function tryOpenPalette(event, key, setPaletteOpen) {
	if (!isPaletteShortcut(Boolean(event.shiftKey), key)) return false;
	event.preventDefault();
	setPaletteOpen?.(true);
	return true;
}

function tryActivityShortcut(event, key, dispatch) {
	if (!event.shiftKey || !handleActivityShortcut(key, dispatch)) return false;
	event.preventDefault();
	return true;
}

export function handleGlobalKeyDown(event, { setPaletteOpen, dispatch }) {
	if (!hasModifier(event)) return;
	const key = event.key?.toLowerCase();
	if (tryOpenPalette(event, key, setPaletteOpen)) return;
	tryActivityShortcut(event, key, dispatch);
}
// --- End pure ide-app helpers ---

function TopBarBrand() {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
			<span aria-hidden="true">🍌</span>
			<span
				style={{
					fontWeight: 600,
					color: "var(--bn-text-primary, #e6e8ee)",
				}}
			>
				Banana
			</span>
		</div>
	);
}

const SEARCH_BUTTON_STYLE = Object.freeze({
	height: 22,
	fontSize: "11px",
	color: "var(--bn-text-muted, #5d6476)",
	background: "var(--bn-bg-editor, #1e1e1e)",
	border: "1px solid var(--bn-border-subtle, #232836)",
	borderRadius: 4,
	display: "flex",
	alignItems: "center",
	gap: 6,
	padding: "0 12px",
	cursor: "pointer",
});

function TopBarSearchButton({ onOpenPalette }) {
	return (
		<button
			type="button"
			onClick={onOpenPalette}
			aria-label="Search or run a command"
			style={SEARCH_BUTTON_STYLE}
		>
			<SearchOutlined style={{ fontSize: 11 }} />
			<span>Search or run a command (Ctrl+K)</span>
		</button>
	);
}

const GITHUB_BUTTON_STYLE = Object.freeze({
	height: 22,
	padding: "0 6px",
	fontSize: 11,
});

function GithubConnectedLabel({ user }) {
	return (
		<>
			<Avatar src={user.avatarUrl} size={16} icon={<GithubOutlined />} />
			<span className="bn-dot bn-dot-ok" />
		</>
	);
}

function TopBarGithubButton({ githubUser, onOpenGithubModal }) {
	const tooltip = githubUser
		? `Connected as @${githubUser.login}`
		: "Connect GitHub";
	return (
		<Tooltip title={tooltip}>
			<Button
				size="small"
				className="bn-ghost-btn"
				icon={githubUser ? undefined : <GithubOutlined />}
				onClick={onOpenGithubModal}
				style={GITHUB_BUTTON_STYLE}
			>
				{githubUser ? <GithubConnectedLabel user={githubUser} /> : "GitHub"}
			</Button>
		</Tooltip>
	);
}

function TopBarBackendStatus({ backendStatus }) {
	const isHealthy = backendStatus === "healthy";
	return (
		<Tooltip title={isHealthy ? "Backend connected" : "Backend offline"}>
			<span className={`bn-status ${isHealthy ? "is-ok" : "is-down"}`}>
				<span className={`bn-dot ${isHealthy ? "bn-dot-ok" : "bn-dot-down"}`} />
			</span>
		</Tooltip>
	);
}

const TOP_BAR_BTN_STYLE = Object.freeze({
	height: 22,
	fontSize: 11,
	padding: "0 8px",
});

function TopBarNavButton({ label, onClick }) {
	return (
		<Button
			size="small"
			aria-label={label}
			onClick={onClick}
			style={TOP_BAR_BTN_STYLE}
		>
			{label}
		</Button>
	);
}

function TopBarActions({ ws, loop, dispatch }) {
	const onEditor = () => {
		dispatch({ type: "openTab", tab: tabForKind("schematic") });
		loop?.openEditor?.();
	};
	const onStudio = () => {
		dispatch({ type: "openTab", tab: tabForKind("3d") });
		loop?.openStudio?.();
	};
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
			<TopBarNavButton label="Editor" onClick={onEditor} />
			<TopBarNavButton label="3D Studio" onClick={onStudio} />
			<TopBarGithubButton
				githubUser={ws?.shellProps?.githubUser}
				onOpenGithubModal={ws?.shellProps?.onOpenGithubModal}
			/>
			<TopBarBackendStatus backendStatus={ws?.shellProps?.backendStatus} />
		</div>
	);
}

const TOP_BAR_WRAPPER_STYLE = Object.freeze({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	width: "100%",
	padding: "0 10px",
	boxSizing: "border-box",
});

function IdeTopBar({ ws, loop, dispatch, setPaletteOpen }) {
	return (
		<div style={TOP_BAR_WRAPPER_STYLE}>
			<TopBarBrand />
			<TopBarSearchButton onOpenPalette={() => setPaletteOpen(true)} />
			<TopBarActions ws={ws} loop={loop} dispatch={dispatch} />
		</div>
	);
}

const SCM_SIDEBAR_STYLE = Object.freeze({
	padding: "8px 12px",
	display: "flex",
	flexDirection: "column",
	gap: 8,
	height: "100%",
	overflow: "auto",
});

function ScmSidebar({ ws, dispatch }) {
	const onOpenDiff = () => {
		dispatch({ type: "openTab", tab: tabForKind("diff") });
	};
	return (
		<div style={SCM_SIDEBAR_STYLE}>
			<Button type="primary" block onClick={onOpenDiff}>
				Open diff
			</Button>
			{ws?.sidebarProps && (
				<WorkspaceControlSidebar
					{...ws.sidebarProps}
					leftCollapsed={false}
					compact={false}
				/>
			)}
		</div>
	);
}

const LIBRARY_SIDEBAR_STYLE = Object.freeze({
	padding: "16px",
	display: "flex",
	flexDirection: "column",
	gap: 12,
});

function LibraryHeader() {
	return (
		<>
			<h4
				style={{
					margin: 0,
					fontSize: 13,
					color: "var(--bn-text-primary, #e6e8ee)",
				}}
			>
				Component Library
			</h4>
			<p
				style={{
					margin: 0,
					fontSize: 12,
					color: "var(--bn-text-secondary, #8a91a3)",
				}}
			>
				Browse footprints, schematic symbols, and 3D models.
			</p>
		</>
	);
}

function LibrarySidebar({ loop, dispatch }) {
	const handleOpenLibrary = () => {
		dispatch({ type: "openTab", tab: tabForKind("schematic") });
		loop?.openEditor?.();
	};

	return (
		<div style={LIBRARY_SIDEBAR_STYLE}>
			<LibraryHeader />
			<Button type="primary" onClick={handleOpenLibrary}>
				Open part library
			</Button>
			<span style={{ fontSize: 11, color: "var(--bn-text-muted, #5d6476)" }}>
				Hint: Press &apos;A&apos; in the editor or click above to place parts.
			</span>
		</div>
	);
}

function SearchSidebar() {
	return (
		<div style={{ padding: "16px", color: "var(--bn-text-muted, #5d6476)" }}>
			<h4
				style={{
					margin: "0 0 12px 0",
					fontSize: 13,
					color: "var(--bn-text-primary, #e6e8ee)",
				}}
			>
				Search
			</h4>
			<p style={{ margin: 0, fontSize: 12 }}>
				Global symbol and net search coming soon. Use Ctrl+K for commands.
			</p>
		</div>
	);
}

function SimulationSidebar({ loop, ws }) {
	return (
		<div style={{ height: "100%", overflow: "auto" }}>
			<SimulationDrawer
				inline={true}
				open={true}
				ir={loop?.ir}
				commit={ws?.viewportProps?.targetCommit}
				api={loop?.api}
				onSelectItem={loop?.focusInEditor}
				onClose={() => {}}
			/>
		</div>
	);
}

function ExplorerSidebar({ onOpenFile }) {
	return (
		<div style={{ padding: "8px", height: "100%", overflow: "auto" }}>
			<ProjectHome onOpenFile={onOpenFile} />
		</div>
	);
}

function IdeSidebarContent({ activity, ws, loop, dispatch, onOpenFile }) {
	if (activity === "explorer") {
		return <ExplorerSidebar onOpenFile={onOpenFile} />;
	}
	if (activity === "scm") {
		return <ScmSidebar ws={ws} dispatch={dispatch} />;
	}
	if (activity === "simulation") {
		return <SimulationSidebar loop={loop} ws={ws} />;
	}
	if (activity === "library") {
		return <LibrarySidebar loop={loop} dispatch={dispatch} />;
	}
	return <SearchSidebar />;
}

function AgentDesignSlot({ loop }) {
	const onOpenSim = (ir) => {
		loop?.closeAgent?.();
		loop?.openSimulation?.(ir);
	};
	return (
		<div style={{ height: "100%", overflow: "auto", padding: 8 }}>
			<AgentDesignPanel
				api={loop?.api}
				onOpenSimulation={onOpenSim}
				currentIr={loop?.ir}
				onAcceptIr={loop?.setIr}
			/>
		</div>
	);
}

function buildAuxItems(loop, ws) {
	return [
		{
			key: "design",
			label: "Design",
			children: <AgentDesignSlot loop={loop} />,
		},
		{
			key: "copilot",
			label: "Copilot",
			children: (
				<div style={{ height: "100%", overflow: "auto" }}>
					<ChatbotDrawer inline={true} open={true} {...ws?.copilotProps} />
				</div>
			),
		},
	];
}

function IdeAuxPanel({ loop, ws, layout, dispatch }) {
	const activeKey = layout.auxTab === "design" ? "design" : "copilot";
	const items = useMemo(() => buildAuxItems(loop, ws), [loop, ws]);
	return (
		<div style={{ height: "100%", overflow: "hidden" }}>
			<Tabs
				size="small"
				activeKey={activeKey}
				items={items}
				onChange={(key) => dispatch({ type: "setAuxTab", id: key })}
				style={{ height: "100%" }}
			/>
		</div>
	);
}

function ProblemsPanel({
	result = null,
	loading = false,
	onRun,
	onFocus,
	kind = "drc",
} = {}) {
	return (
		<div style={{ height: "100%", width: "100%", overflow: "hidden" }}>
			<ChecksPanel
				result={result}
				loading={loading}
				onRun={onRun}
				onFocus={onFocus}
				kind={kind}
			/>
		</div>
	);
}

function mapIssuesToViolations(issues) {
	if (!Array.isArray(issues)) return [];
	return issues.map((iss, i) => ({
		severity: iss.severity || "error",
		type: iss.metric || iss.source || "check",
		description: iss.message || iss.suggestion || `Issue ${i + 1}`,
		items: Array.isArray(iss.itemIds)
			? iss.itemIds.map((id) => ({ description: id }))
			: [],
	}));
}

async function executeChecks(loop, setChecksResult, setChecksLoading) {
	setChecksLoading(true);
	try {
		if (typeof loop?.api?.editorCheck === "function") {
			const res = await loop.api.editorCheck({
				ir: loop?.ir,
				board: loop?.board,
			});
			const rawIssues = res?.data?.issues ?? res?.issues ?? [];
			setChecksResult({ violations: mapIssuesToViolations(rawIssues) });
		} else if (typeof loop?.runChecks === "function") {
			const res = await loop.runChecks();
			if (res) setChecksResult(res);
		}
	} catch (err) {
		console.error("Check failed:", err);
	} finally {
		setChecksLoading(false);
	}
}

function resolveEditorStatus(options) {
	if (options?.status) return options.status;
	if (typeof editorStatus !== "undefined") return editorStatus.get();
	return { x: 0, y: 0, grid: 1.27, units: "mm" };
}

function makeBranchSegment(ws) {
	const localProps = ws?.sidebarProps?.localProps;
	const repoInfo = localProps?.repoInfo;
	const repoPath = localProps?.repoPath;
	const branch = repoInfo?.currentBranch || (repoPath ? "main" : null);
	const icon =
		typeof BranchesOutlined !== "undefined" ? BranchesOutlined : null;
	return {
		id: "git-branch",
		icon,
		text: branch || "No repository",
		tooltip: branch ? `Git branch: ${branch}` : "No repository opened",
	};
}

function makeProblemsSegment(checksResult, onToggleProblems) {
	const prob = formatProblemsStatus(checksResult);
	return {
		id: "problems-status",
		text: prob.text,
		tone: prob.tone,
		tooltip: prob.tooltip,
		onClick: onToggleProblems,
		"aria-label": `Problems: ${prob.text}`,
	};
}

function makeCoordinatesSegment(status) {
	const u = status?.units || "mm";
	const text = formatCoordinates(status?.x, status?.y, u);
	return {
		id: "coordinates",
		text,
		tooltip: `Cursor: ${text}`,
		"aria-label": `Coordinates: ${text}`,
	};
}

function makeGridSegment(status) {
	const u = status?.units || "mm";
	const text = formatGrid(status?.grid, u);
	return {
		id: "grid",
		text,
		tooltip: `Grid: ${text}`,
		"aria-label": text,
	};
}

export function buildLeftSegments(ws, options = {}) {
	const status = resolveEditorStatus(options);
	return [
		makeBranchSegment(ws),
		makeProblemsSegment(options.checksResult, options.onToggleProblems),
		makeCoordinatesSegment(status),
		makeGridSegment(status),
	];
}

export function buildRightSegments(ws, options = {}) {
	const status =
		options.status ||
		(typeof editorStatus !== "undefined"
			? editorStatus.get()
			: { units: "mm" });
	const isHealthy = ws?.shellProps?.backendStatus === "healthy";
	const units = status?.units || "mm";
	return [
		{
			id: "backend-status",
			text: isHealthy ? "Backend OK" : "Backend offline",
			tone: isHealthy ? "success" : "error",
			tooltip: isHealthy ? "Backend connected" : "Backend offline",
		},
		{
			id: "units",
			text: units,
			tooltip: `Units: ${units}`,
			onClick: options.onCycleUnits,
		},
	];
}

function IdeStatusBar({ ws, layout, dispatch, checksResult }) {
	const status = useSyncExternalStore(editorStatus.subscribe, editorStatus.get);
	const onToggleProblems = useCallback(() => {
		if (layout?.bottomOpen && layout?.bottomTab === "problems") {
			dispatch?.({ type: "toggleBottom" });
		} else {
			dispatch?.({ type: "setBottomTab", id: "problems" });
		}
	}, [layout?.bottomOpen, layout?.bottomTab, dispatch]);

	const onCycleUnits = useCallback(() => {
		const current = status?.units || "mm";
		const next = current === "mm" ? "mil" : current === "mil" ? "in" : "mm";
		editorStatus.setUnits(next);
	}, [status?.units]);

	const left = buildLeftSegments(ws, {
		status,
		checksResult,
		onToggleProblems,
	});
	const right = buildRightSegments(ws, {
		status,
		onCycleUnits,
	});
	return <StatusBar left={left} right={right} />;
}

function useOpenFileHandler(ws, loop, dispatch) {
	return useCallback(
		async (target) => {
			const editorRepo = await ws?.openProjectFile?.(target);
			if (!editorRepo) return;
			await runEditCurrentFile(loop, editorRepo);
			const filePath =
				target?.filePath || editorRepo.pcbPath || editorRepo.schPath;
			const isPcb = filePath?.endsWith(".kicad_pcb") || target?.kind === "pcb";
			const kind = isPcb ? "pcb" : "schematic";
			dispatch({ type: "openTab", tab: tabForKind(kind) });
		},
		[ws, loop, dispatch],
	);
}

function useGlobalKeydown(setPaletteOpen, dispatch) {
	useEffect(() => {
		const onKeyDown = (e) => {
			handleGlobalKeyDown(e, { setPaletteOpen, dispatch });
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [setPaletteOpen, dispatch]);
}

function useInitialWelcomeTab(tabsCount, dispatch) {
	const hasMounted = useRef(false);
	useEffect(() => {
		if (!hasMounted.current) {
			hasMounted.current = true;
			if (tabsCount === 0) {
				dispatch({ type: "openTab", tab: tabForKind("welcome") });
			}
		}
	}, [tabsCount, dispatch]);
}

function EditorArea({ layout, dispatch, loop, ws, onOpenFile }) {
	const activeTab = layout.tabs.find((t) => t.id === layout.activeTabId);
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				overflow: "hidden",
			}}
		>
			<EditorTabs
				tabs={layout.tabs}
				activeTabId={layout.activeTabId}
				onActivate={(id) => dispatch({ type: "activateTab", id })}
				onClose={(id) => dispatch({ type: "closeTab", id })}
				onMove={(id, toIndex) => dispatch({ type: "moveTab", id, toIndex })}
			/>
			<div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
				<IdeTabContent
					activeTab={activeTab}
					loop={loop}
					ws={ws}
					onOpenFile={onOpenFile}
				/>
			</div>
		</div>
	);
}

function ActivityBarSlot({ activity, sidebarOpen, dispatch }) {
	const onSelect = (id) => {
		if (id === "ai") dispatch({ type: "toggleAux" });
		else dispatch({ type: "setActivity", id });
	};
	return (
		<ActivityBar
			activeId={activity}
			sidebarOpen={sidebarOpen}
			onSelect={onSelect}
		/>
	);
}

function resolveCheckKind(layout) {
	const activeKind =
		layout?.tabs?.find((t) => t.id === layout?.activeTabId)?.kind || "drc";
	return activeKind === "schematic" ? "erc" : "drc";
}

function createUpperSlots({
	layout,
	dispatch,
	loop,
	ws,
	onOpenFile,
	setPaletteOpen,
}) {
	return {
		topBar: (
			<IdeTopBar
				ws={ws}
				loop={loop}
				dispatch={dispatch}
				setPaletteOpen={setPaletteOpen}
			/>
		),
		activityBar: (
			<ActivityBarSlot
				activity={layout.activity}
				sidebarOpen={layout.sidebarOpen}
				dispatch={dispatch}
			/>
		),
		sidebar: (
			<IdeSidebarContent
				activity={layout.activity}
				ws={ws}
				loop={loop}
				dispatch={dispatch}
				onOpenFile={onOpenFile}
			/>
		),
		editor: (
			<EditorArea
				layout={layout}
				dispatch={dispatch}
				loop={loop}
				ws={ws}
				onOpenFile={onOpenFile}
			/>
		),
		aux: (
			<IdeAuxPanel loop={loop} ws={ws} layout={layout} dispatch={dispatch} />
		),
	};
}

function createLowerSlots({
	layout,
	dispatch,
	loop,
	ws,
	checksResult,
	checksLoading,
	onRunChecks,
}) {
	const kind = resolveCheckKind(layout);
	return {
		bottom: (
			<ProblemsPanel
				result={checksResult}
				loading={checksLoading}
				onRun={onRunChecks}
				onFocus={loop?.focusInEditor}
				kind={kind}
			/>
		),
		statusBar: (
			<IdeStatusBar
				ws={ws}
				layout={layout}
				dispatch={dispatch}
				checksResult={checksResult}
			/>
		),
	};
}

function createShellSlots(props) {
	return {
		...createUpperSlots(props),
		...createLowerSlots(props),
	};
}

function IdeShellContainer(props) {
	const { layout } = props;
	const slots = createShellSlots(props);
	return (
		<IdeShell
			sidebarOpen={layout.sidebarOpen}
			auxOpen={layout.auxOpen}
			bottomOpen={layout.bottomOpen}
			{...slots}
		/>
	);
}

function useEditorChecks(initialResult, loop) {
	const [checksResult, setChecksResult] = useState(initialResult ?? null);
	const [checksLoading, setChecksLoading] = useState(false);
	const onRunChecks = useCallback(
		() => executeChecks(loop, setChecksResult, setChecksLoading),
		[loop],
	);
	return { checksResult, checksLoading, onRunChecks };
}

export function IdeApp({ ws, loop }) {
	const [layout, dispatch] = useIdeLayout();
	const [paletteOpen, setPaletteOpen] = useState(false);
	const checks = useEditorChecks(ws?.checksResult, loop);
	const onOpenFile = useOpenFileHandler(ws, loop, dispatch);
	const commands = useMemo(
		() => buildIdeCommands({ dispatch, loop, ws }),
		[dispatch, loop, ws],
	);

	useGlobalKeydown(setPaletteOpen, dispatch);
	useInitialWelcomeTab(layout.tabs.length, dispatch);

	return (
		<>
			<IdeShellContainer
				layout={layout}
				dispatch={dispatch}
				loop={loop}
				ws={ws}
				onOpenFile={onOpenFile}
				setPaletteOpen={setPaletteOpen}
				{...checks}
			/>
			<CommandPalette
				open={paletteOpen}
				commands={commands}
				onClose={() => setPaletteOpen(false)}
				placeholder="Search or run a command (Ctrl+K)"
			/>
			<GithubConnectModal {...ws?.githubModalProps} />
		</>
	);
}

export default IdeApp;
