import {
	DesktopOutlined,
	GithubOutlined,
	MenuFoldOutlined,
	SettingOutlined,
} from "@ant-design/icons";
import { Button, Drawer, Layout, Segmented, Space } from "antd";
import GithubControls from "./GithubControls.jsx";
import { LayerSelector } from "./LayerSelector.jsx";
import { LocalRepoControls } from "./LocalRepoControls.jsx";

const { Sider } = Layout;

export function WorkspaceControlSidebar({
	leftCollapsed,
	setLeftCollapsed,
	onFolderDrop,
	sourceMode,
	onSourceModeChange,
	localProps,
	githubProps,
	layerProps,
	compact = false,
}) {
	const body = (
		<Space orientation="vertical" size="large" style={{ width: "100%" }}>
			<div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						marginBottom: "12px",
					}}
				>
					<h5 className="bn-panel-title">
						<SettingOutlined /> Repository Source
					</h5>
					{!compact && (
						<Button
							type="text"
							size="small"
							icon={<MenuFoldOutlined />}
							onClick={() => setLeftCollapsed(true)}
							title="Hide Controls (Left Panel)"
							style={{ color: "var(--bn-text-muted)" }}
						/>
					)}
				</div>

				<Segmented
					block
					options={[
						{ label: "Local Git", value: "local", icon: <DesktopOutlined /> },
						{
							label: "GitHub Cloud",
							value: "github",
							icon: <GithubOutlined />,
						},
					]}
					value={sourceMode}
					onChange={onSourceModeChange}
					style={{ marginBottom: "16px" }}
				/>

				{sourceMode === "local" ? (
					<LocalRepoControls {...localProps} />
				) : (
					<GithubControls {...githubProps} />
				)}
			</div>

			<LayerSelector {...layerProps} />
		</Space>
	);

	if (compact) {
		return (
			<Drawer
				className="bn-drawer"
				placement="left"
				open={!leftCollapsed}
				onClose={() => setLeftCollapsed(true)}
				size="min(92vw, 380px)"
				title="Controls"
			>
				{body}
			</Drawer>
		);
	}

	return (
		<Sider
			width={340}
			collapsible
			collapsed={leftCollapsed}
			collapsedWidth={0}
			trigger={null}
			onDragOver={(e) => e.preventDefault()}
			onDrop={onFolderDrop}
			style={{
				background: "var(--bn-surface)",
				borderRight: leftCollapsed ? "none" : "1px solid var(--bn-border)",
				padding: leftCollapsed ? 0 : "20px",
				overflowY: "auto",
				height: "calc(100vh - var(--bn-header-h))",
				transition: "all 0.2s",
			}}
		>
			{!leftCollapsed && body}
		</Sider>
	);
}
