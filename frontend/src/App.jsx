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
const THEME_CONFIG = {
	algorithm: theme.darkAlgorithm,
	token: {
		colorPrimary: "#f5c542",
		colorBgBase: "#0b0d12",
		colorBgContainer: "#181c25",
		colorBgElevated: "#1f2430",
		colorBorder: "#2f3546",
		colorBorderSecondary: "#232836",
		colorText: "#e6e8ee",
		colorTextSecondary: "#8a91a3",
		colorTextTertiary: "#5d6476",
		colorSuccess: "#3dd68c",
		colorError: "#f0606a",
		colorInfo: "#5b9dff",
		colorTextLightSolid: "#1a1400",
		borderRadius: 8,
		fontFamily:
			"'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif",
	},
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

export default function App() {
	const ws = useWorkspaceState();
	const screens = Grid.useBreakpoint();
	// below lg (992px) the side panels become slide-over drawers so the viewport gets the full width
	const compact = screens.lg === false; // {} on first render: don't collapse desktop panels by mistake
	const { setLeftCollapsed, setRightCollapsed } = ws.edgeTabsProps;

	useEffect(() => {
		if (compact) {
			setLeftCollapsed(true);
			setRightCollapsed(true);
		}
	}, [compact, setLeftCollapsed, setRightCollapsed]);

	return (
		<ConfigProvider theme={THEME_CONFIG}>
			<Layout style={{ minHeight: "100vh", background: "var(--bn-bg)" }}>
				<WorkspaceShell
					{...ws.shellProps}
					compact={compact}
					onOpenControls={() => setLeftCollapsed(false)}
					onOpenAudit={() => setRightCollapsed(false)}
				/>

				<Layout>
					<WorkspaceControlSidebar {...ws.sidebarProps} compact={compact} />

					<Content
						style={{
							padding: compact ? "8px" : "20px",
							display: "flex",
							flexDirection: "column",
							justifyContent: "center",
							alignItems: "center",
							height: "calc(100vh - var(--bn-header-h))",
							background:
								"radial-gradient(ellipse at 50% 0%, rgba(245, 197, 66, 0.04), transparent 60%), var(--bn-bg)",
							overflow: "hidden",
							position: "relative",
						}}
					>
						{!compact && <EdgeCollapseTabs {...ws.edgeTabsProps} />}
						<DiffViewport {...ws.viewportProps} />
					</Content>

					<WorkspaceAuditSidebar {...ws.auditProps} compact={compact} />
				</Layout>

				<ChatbotDrawer {...ws.copilotProps} />
				<GithubConnectModal {...ws.githubModalProps} />
			</Layout>
		</ConfigProvider>
	);
}
