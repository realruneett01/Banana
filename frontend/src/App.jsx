import {
	Button,
	ConfigProvider,
	Drawer,
	Empty,
	Grid,
	Layout,
	message,
	theme,
} from "antd";
import { useEffect } from "react";
import "./harness.css";
import ChatbotDrawer from "./ChatbotDrawer";
import AgentDesignPanel from "./components/AgentDesignPanel.jsx";
import { DiffViewport } from "./components/DiffViewport";
import { EdgeCollapseTabs } from "./components/EdgeCollapseTabs";
import GithubConnectModal from "./components/GithubConnectModal";
import SimulationDrawer from "./components/SimulationDrawer.jsx";
import SimulationStudio from "./components/sim3d/SimulationStudio.jsx";
import { WorkspaceAuditSidebar } from "./components/WorkspaceAuditSidebar";
import { WorkspaceControlSidebar } from "./components/WorkspaceControlSidebar";
import EditorScreen from "./editor/EditorScreen.jsx";
import { useDesignLoop } from "./useDesignLoop.js";
import { useWorkspaceState } from "./useWorkspaceState.js";
import WorkspaceShell from "./WorkspaceShell";

const { Content } = Layout;

// Mirrors the --bn-* tokens in index.css so antd components match the shell.
const RAW_THEME_TOKENS =
	"colorPrimary:#f5c542|colorBgBase:#0b0d12|colorBgContainer:#181c25|colorBgElevated:#1f2430|colorBorder:#2f3546|colorBorderSecondary:#232836|colorText:#e6e8ee|colorTextSecondary:#8a91a3|colorTextTertiary:#5d6476|colorSuccess:#3dd68c|colorError:#f0606a|colorInfo:#5b9dff|colorTextLightSolid:#1a1400";

const THEME_TOKEN = {
	borderRadius: 8,
	fontFamily:
		"'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif",
};
for (const pair of RAW_THEME_TOKENS.split("|")) {
	const [k, v] = pair.split(":");
	THEME_TOKEN[k] = v;
}

const THEME_CONFIG = {
	algorithm: theme.darkAlgorithm,
	token: THEME_TOKEN,
	components: {
		Layout: { bodyBg: "#0b0d12", siderBg: "#12151c", headerBg: "#12151c" },
		Segmented: {
			trackBg: "#0b0d12",
			itemSelectedBg: "#262c3a",
			itemSelectedColor: "#f5c542",
		},
		Button: { primaryShadow: "none", defaultShadow: "none" },
		Input: { activeShadow: "0 0 0 2px rgba(245, 197, 66, 0.15)" },
	},
};

const BASE_CONTENT_STYLE = {
	display: "flex",
	flexDirection: "column",
	justifyContent: "center",
	alignItems: "center",
};

function getContentStyle(compact) {
	return {
		...BASE_CONTENT_STYLE,
		padding: compact ? "8px" : "20px",
		height: "calc(100vh - var(--bn-header-h))",
		background:
			"radial-gradient(ellipse at 50% 0%, rgba(245, 197, 66, 0.04), transparent 60%), var(--bn-bg)",
		overflow: "hidden",
		position: "relative",
	};
}

function MainViewport({ compact, edgeTabsProps, viewportProps }) {
	return (
		<Content style={getContentStyle(compact)}>
			{!compact && <EdgeCollapseTabs {...edgeTabsProps} />}
			<DiffViewport {...viewportProps} />
		</Content>
	);
}

function useAutoCollapse(compact, setLeftCollapsed, setRightCollapsed) {
	useEffect(() => {
		if (compact) {
			setLeftCollapsed(true);
			setRightCollapsed(true);
		}
	}, [compact, setLeftCollapsed, setRightCollapsed]);
}

function createEmptyIr() {
	return {
		schemaVersion: 1,
		name: "untitled",
		parts: [],
		nets: [],
		constraints: [],
	};
}

function EmptyDesignNotice({ onStartEmpty }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				height: "100%",
				width: "100%",
			}}
		>
			<Empty description="No design yet - use 'Design with AI' first, or start an empty design">
				<Button type="primary" onClick={onStartEmpty}>
					Start empty design
				</Button>
			</Empty>
		</div>
	);
}

function buildEditorRepo(ws) {
	const localProps = ws?.sidebarProps?.localProps;
	const repoPath = localProps?.repoPath || undefined;
	const file =
		ws?.viewportProps?.relativeFilePath || localProps?.relativeFilePath;
	const schPath = file?.endsWith(".kicad_sch") ? file : undefined;
	const pcbPath = file?.endsWith(".kicad_pcb") ? file : undefined;
	return { repoPath, schPath, pcbPath };
}

function handleStudioApplyFix(loop, fix) {
	const result = loop.applyFix(fix);
	if (result?.ok) {
		message.success(`Fix applied: ${fix.title}`);
	} else {
		message.error(result?.error);
	}
}

function StudioDrawer({ loop }) {
	return (
		<Drawer
			title="3D Studio"
			open={loop.studioOpen}
			onClose={loop.closeStudio}
			extra={
				<Button
					size="small"
					disabled={!loop.canUndoFix}
					onClick={() => loop.undoFix()}
				>
					Undo last fix
				</Button>
			}
			width="100%"
			destroyOnHidden={false}
			className="bn-drawer"
			styles={{ body: { padding: 0, height: "100%" } }}
		>
			{loop.ir ? (
				<SimulationStudio
					api={loop.api}
					ir={loop.ir}
					onApplyFix={(fix) => handleStudioApplyFix(loop, fix)}
				/>
			) : (
				<EmptyDesignNotice onStartEmpty={() => loop.setIr(createEmptyIr())} />
			)}
		</Drawer>
	);
}

function EditorDrawer({ loop, repo, ws }) {
	const resolvedRepo = repo ?? buildEditorRepo(ws);
	return (
		<Drawer
			title="Editor"
			open={loop.editorOpen}
			onClose={loop.closeEditor}
			width="100%"
			destroyOnHidden={false}
			className="bn-drawer"
			styles={{ body: { padding: 0, height: "100%" } }}
		>
			{loop.ir ? (
				<EditorScreen
					ir={loop.ir}
					board={null}
					onSave={loop.saveFromEditor}
					focusItemId={loop.focusItemId}
					api={loop.api}
					repo={resolvedRepo}
				/>
			) : (
				<EmptyDesignNotice onStartEmpty={() => loop.setIr(createEmptyIr())} />
			)}
		</Drawer>
	);
}

function DesignDrawers({ loop, commit, repo, ws }) {
	const handleSimulate = (ir) => {
		loop.closeAgent();
		loop.openSimulation(ir);
	};

	return (
		<>
			<Drawer
				placement="left"
				width={560}
				title="Design with AI"
				open={loop.agentOpen}
				onClose={loop.closeAgent}
				destroyOnHidden={false}
				className="bn-drawer"
			>
				<AgentDesignPanel
					api={loop.api}
					onOpenSimulation={handleSimulate}
					currentIr={loop.ir}
					onAcceptIr={loop.setIr}
				/>
			</Drawer>
			<SimulationDrawer
				open={loop.simOpen}
				onClose={loop.closeSimulation}
				ir={loop.ir}
				commit={commit}
				api={loop.api}
				onSelectItem={loop.focusInEditor}
			/>
			<StudioDrawer loop={loop} />
			<EditorDrawer loop={loop} repo={repo} ws={ws} />
		</>
	);
}

function AppLayout({ ws, compact }) {
	const loop = useDesignLoop();
	const { setLeftCollapsed, setRightCollapsed } = ws.edgeTabsProps;
	const repo = buildEditorRepo(ws);

	return (
		<Layout style={{ minHeight: "100vh", background: "var(--bn-bg)" }}>
			<WorkspaceShell
				{...ws.shellProps}
				compact={compact}
				onOpenControls={() => setLeftCollapsed(false)}
				onOpenAudit={() => setRightCollapsed(false)}
				onOpenAgent={loop.openAgent}
				onOpenSimulation={() => loop.openSimulation()}
				onOpenStudio={() => loop.openStudio()}
				onOpenEditor={() => loop.openEditor()}
			/>
			<Layout>
				<WorkspaceControlSidebar {...ws.sidebarProps} compact={compact} />
				<MainViewport
					compact={compact}
					edgeTabsProps={ws.edgeTabsProps}
					viewportProps={ws.viewportProps}
				/>
				<WorkspaceAuditSidebar {...ws.auditProps} compact={compact} />
			</Layout>
			<ChatbotDrawer {...ws.copilotProps} />
			<GithubConnectModal {...ws.githubModalProps} />
			<DesignDrawers
				loop={loop}
				commit={ws.viewportProps?.targetCommit}
				repo={repo}
				ws={ws}
			/>
		</Layout>
	);
}

export default function App() {
	const ws = useWorkspaceState();
	const screens = Grid.useBreakpoint();
	const compact = screens.lg === false;
	const { setLeftCollapsed, setRightCollapsed } = ws.edgeTabsProps;

	useAutoCollapse(compact, setLeftCollapsed, setRightCollapsed);

	return (
		<ConfigProvider theme={THEME_CONFIG}>
			<AppLayout ws={ws} compact={compact} />
		</ConfigProvider>
	);
}
