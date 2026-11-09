import { Drawer, Layout } from "antd";
import { AuditSidebar } from "../AuditSidebar.jsx";
import { buildSidebarModifications } from "../utils/auditLogUtils.js";

const { Sider } = Layout;

export function WorkspaceAuditSidebar({
	rightCollapsed,
	setRightCollapsed,
	activeDiffData,
	activeAuditIdx,
	onHoverDiff,
	onSelectDiff,
	onClearFocus,
	compact = false,
}) {
	if (compact) {
		return (
			<Drawer
				className="bn-drawer"
				placement="right"
				open={!rightCollapsed}
				onClose={() => setRightCollapsed(true)}
				size="min(92vw, 380px)"
				closable={false}
				styles={{ body: { padding: 0 } }}
			>
				<AuditSidebar
					modifications={buildSidebarModifications(activeDiffData)}
					activeDiffIdx={activeAuditIdx}
					onHoverDiff={onHoverDiff}
					onSelectDiff={onSelectDiff}
					onClearFocus={onClearFocus}
					onCollapse={() => setRightCollapsed(true)}
				/>
			</Drawer>
		);
	}

	return (
		<Sider
			width={340}
			collapsible
			collapsed={rightCollapsed}
			collapsedWidth={0}
			trigger={null}
			style={{
				background: "var(--bn-surface)",
				borderLeft: rightCollapsed ? "none" : "1px solid var(--bn-border)",
				padding: 0,
				overflowY: "hidden",
				height: "calc(100vh - var(--bn-header-h))",
				transition: "all 0.2s",
			}}
		>
			{!rightCollapsed && (
				<AuditSidebar
					modifications={buildSidebarModifications(activeDiffData)}
					activeDiffIdx={activeAuditIdx}
					onHoverDiff={onHoverDiff}
					onSelectDiff={onSelectDiff}
					onClearFocus={onClearFocus}
					onCollapse={() => setRightCollapsed(true)}
				/>
			)}
		</Sider>
	);
}
