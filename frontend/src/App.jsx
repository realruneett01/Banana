import { ConfigProvider, Grid, Layout, theme } from "antd";
import { useEffect } from "react";
import "./harness.css";
import ChatbotDrawer from "./ChatbotDrawer";
import { DiffViewport } from "./components/DiffViewport";
import { EdgeCollapseTabs } from "./components/EdgeCollapseTabs";
import GithubConnectModal from "./components/GithubConnectModal";
import { WorkspaceAuditSidebar } from "./components/WorkspaceAuditSidebar";
import { WorkspaceControlSidebar } from "./components/WorkspaceControlSidebar";
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

function AppLayout({ ws, compact }) {
	const { setLeftCollapsed, setRightCollapsed } = ws.edgeTabsProps;

	return (
		<Layout style={{ minHeight: "100vh", background: "var(--bn-bg)" }}>
			<WorkspaceShell
				{...ws.shellProps}
				compact={compact}
				onOpenControls={() => setLeftCollapsed(false)}
				onOpenAudit={() => setRightCollapsed(false)}
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
		</Layout>
	);
}

export default function App() {
	const ws = useWorkspaceState();
	const screens = Grid.useBreakpoint();
	// below lg (992px) the side panels become slide-over drawers so the viewport gets the full width
	const compact = screens.lg === false; // {} on first render: don't collapse desktop panels by mistake
	const { setLeftCollapsed, setRightCollapsed } = ws.edgeTabsProps;

	useAutoCollapse(compact, setLeftCollapsed, setRightCollapsed);

	return (
		<ConfigProvider theme={THEME_CONFIG}>
			<AppLayout ws={ws} compact={compact} />
		</ConfigProvider>
	);
}
