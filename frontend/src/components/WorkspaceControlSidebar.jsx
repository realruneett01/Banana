import {
	DesktopOutlined,
	GithubOutlined,
	MenuFoldOutlined,
	SettingOutlined,
} from "@ant-design/icons";
import { Button, ConfigProvider, Drawer, Layout, Segmented, Space } from "antd";
import GithubControls from "./GithubControls.jsx";
import { LayerSelector } from "./LayerSelector.jsx";
import { LocalRepoControls } from "./LocalRepoControls.jsx";

const { Sider } = Layout;

const SOURCE_OPTIONS = [
	{ label: "Local Git", value: "local", icon: <DesktopOutlined /> },
	{
		label: "GitHub Cloud",
		value: "github",
		icon: <GithubOutlined />,
	},
];

const SIDEBAR_THEME = Object.freeze({
	components: {
		Form: {
			itemMarginBottom: 8,
		},
		Button: {
			controlHeightSM: 22,
			controlHeight: 26,
		},
	},
});

const SIDEBAR_STYLE = `
	.bn-control-sidebar .ant-form-item {
		margin-bottom: 8px;
	}
	.bn-control-sidebar .ant-btn-sm {
		height: var(--bn-btn-h-sm, 22px);
	}
	.bn-control-sidebar .ant-btn:not(.ant-btn-sm) {
		height: var(--bn-btn-h-md, 26px);
	}
`;

function getSiderStyle(collapsed) {
	return {
		background: "var(--bn-bg-surface, #161922)",
		borderRight: collapsed
			? "none"
			: "1px solid var(--bn-border-subtle, #232838)",
		padding: collapsed ? 0 : "20px",
		overflowY: "auto",
		height: "calc(100vh - var(--bn-header-h))",
		transition: "all 0.2s",
	};
}

function SourceHeader({ compact, onCollapse }) {
	return (
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
					onClick={onCollapse}
					title="Hide Controls (Left Panel)"
					style={{
						color: "var(--bn-text-muted)",
						height: "var(--bn-btn-h-sm, 22px)",
					}}
				/>
			)}
		</div>
	);
}

function SourceControls({ sourceMode, localProps, githubProps }) {
	if (sourceMode === "local") {
		return <LocalRepoControls {...localProps} />;
	}
	return <GithubControls {...githubProps} />;
}

function SourceSection({
	compact,
	onCollapse,
	sourceMode,
	onSourceModeChange,
	localProps,
	githubProps,
}) {
	return (
		<div>
			<SourceHeader compact={compact} onCollapse={onCollapse} />
			<Segmented
				block
				options={SOURCE_OPTIONS}
				value={sourceMode}
				onChange={onSourceModeChange}
				style={{ marginBottom: "16px" }}
			/>
			<SourceControls
				sourceMode={sourceMode}
				localProps={localProps}
				githubProps={githubProps}
			/>
		</div>
	);
}

function SidebarBody({
	compact,
	onCollapse,
	sourceMode,
	onSourceModeChange,
	localProps,
	githubProps,
	layerProps,
}) {
	return (
		<ConfigProvider theme={SIDEBAR_THEME}>
			<style>{SIDEBAR_STYLE}</style>
			<Space
				orientation="vertical"
				size={8}
				style={{ width: "100%", gap: "8px" }}
			>
				<SourceSection
					compact={compact}
					onCollapse={onCollapse}
					sourceMode={sourceMode}
					onSourceModeChange={onSourceModeChange}
					localProps={localProps}
					githubProps={githubProps}
				/>
				<LayerSelector {...layerProps} />
			</Space>
		</ConfigProvider>
	);
}

function renderDrawer(open, onClose, body) {
	return (
		<Drawer
			className="bn-drawer bn-control-sidebar"
			placement="left"
			open={open}
			onClose={onClose}
			size="min(92vw, 380px)"
			title="Controls"
			styles={{
				body: { background: "var(--bn-bg-surface, #161922)" },
				header: {
					background: "var(--bn-bg-surface, #161922)",
					borderBottom: "1px solid var(--bn-border-subtle, #232838)",
				},
			}}
		>
			{body}
		</Drawer>
	);
}

function renderSider(collapsed, onDrop, body) {
	return (
		<Sider
			className="bn-control-sidebar"
			width={340}
			collapsible
			collapsed={collapsed}
			collapsedWidth={0}
			trigger={null}
			onDragOver={(e) => e.preventDefault()}
			onDrop={onDrop}
			style={getSiderStyle(collapsed)}
		>
			{!collapsed && body}
		</Sider>
	);
}

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
	const close = () => setLeftCollapsed(true);
	const body = (
		<SidebarBody
			compact={compact}
			onCollapse={close}
			sourceMode={sourceMode}
			onSourceModeChange={onSourceModeChange}
			localProps={localProps}
			githubProps={githubProps}
			layerProps={layerProps}
		/>
	);
	return compact
		? renderDrawer(!leftCollapsed, close, body)
		: renderSider(leftCollapsed, onFolderDrop, body);
}
