import {
	EditOutlined,
	ExperimentOutlined,
	FileSearchOutlined,
	GithubOutlined,
	MenuOutlined,
	RobotOutlined,
	ThunderboltFilled,
	ThunderboltOutlined,
	UnorderedListOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Space, Tooltip } from "antd";

const BUTTON_HEIGHT = 32;

function BrandLogo({ compact }) {
	return (
		<div className="bn-brand">
			<div className="bn-brand-mark" aria-hidden="true">
				🍌
			</div>
			<div className="bn-brand-text">
				<span className="bn-brand-name">Banana</span>
				{!compact && (
					<span className="bn-brand-sub">Visual Hardware Diff Studio</span>
				)}
			</div>
			{!compact && (
				<span className="bn-chip">
					<FileSearchOutlined /> PCB Diff Engine
				</span>
			)}
		</div>
	);
}

function GithubConnectedBtn({ githubUser, onOpenGithubModal, compact }) {
	return (
		<Tooltip title={`Connected as @${githubUser.login} (Click to manage)`}>
			<Button
				className="bn-ghost-btn"
				onClick={onOpenGithubModal}
				style={{ height: BUTTON_HEIGHT }}
			>
				<Avatar
					src={githubUser.avatarUrl}
					size={20}
					icon={<GithubOutlined />}
				/>
				{!compact && <span className="bn-gh-login">{githubUser.login}</span>}
				<span className="bn-dot bn-dot-ok" />
			</Button>
		</Tooltip>
	);
}

function GithubConnectBtn({ onOpenGithubModal, compact }) {
	return (
		<Tooltip title="Connect GitHub to diff remote repos & Pull Requests">
			<Button
				className="bn-ghost-btn"
				icon={<GithubOutlined />}
				onClick={onOpenGithubModal}
				style={{ height: BUTTON_HEIGHT }}
			>
				{!compact && "Connect GitHub"}
			</Button>
		</Tooltip>
	);
}

function GithubUserButton({ githubUser, onOpenGithubModal, compact }) {
	if (githubUser) {
		return (
			<GithubConnectedBtn
				githubUser={githubUser}
				onOpenGithubModal={onOpenGithubModal}
				compact={compact}
			/>
		);
	}
	return (
		<GithubConnectBtn onOpenGithubModal={onOpenGithubModal} compact={compact} />
	);
}

function BackendStatusBadge({ backendStatus, compact }) {
	const isHealthy = backendStatus === "healthy";
	const label = isHealthy ? "Connected" : "Backend offline";
	return (
		<Tooltip title={isHealthy ? "Backend connected" : "Backend not reachable"}>
			<span className={`bn-status ${isHealthy ? "is-ok" : "is-down"}`}>
				<span className={`bn-dot ${isHealthy ? "bn-dot-ok" : "bn-dot-down"}`} />
				{!compact && label}
			</span>
		</Tooltip>
	);
}

function ShellActionButton({
	title,
	icon,
	onClick,
	compact,
	label,
	ariaLabel,
}) {
	return (
		<Tooltip title={title}>
			<Button
				type="primary"
				icon={icon}
				onClick={() => onClick?.()}
				className="bn-copilot-btn"
				style={{ height: BUTTON_HEIGHT }}
				aria-label={ariaLabel}
			>
				{!compact && label}
			</Button>
		</Tooltip>
	);
}

function CopilotButton({ onOpenCopilot, compact }) {
	return (
		<ShellActionButton
			title="Open Banana Hardware Copilot (AI PCB Diff Assistant)"
			icon={<RobotOutlined />}
			onClick={onOpenCopilot}
			compact={compact}
			label="Copilot"
		/>
	);
}

const LABELLED_ACTIONS = [
	["onOpenAgent", "Design with AI", ExperimentOutlined],
	["onOpenSimulation", "Simulate", ThunderboltOutlined],
	["onOpenStudio", "3D Studio", ThunderboltFilled],
	["onOpenEditor", "Editor", EditOutlined],
];

function LabelledActionButtons(props) {
	return LABELLED_ACTIONS.map(([handler, label, Icon]) => (
		<ShellActionButton
			key={handler}
			title={label}
			icon={<Icon />}
			onClick={props[handler]}
			compact={props.compact}
			label={label}
			ariaLabel={label}
		/>
	));
}

function CompactIconButton({ icon, onClick, label }) {
	return (
		<Button
			type="text"
			className="bn-icon-btn"
			icon={icon}
			onClick={onClick}
			aria-label={label}
		/>
	);
}

function HeaderLeft({ compact, onOpenControls }) {
	return (
		<div className="bn-header-left">
			{compact && (
				<CompactIconButton
					icon={<MenuOutlined />}
					onClick={onOpenControls}
					label="Open controls"
				/>
			)}
			<BrandLogo compact={compact} />
		</div>
	);
}

function HeaderActions(props) {
	const { compact } = props;
	return (
		<Space size={compact ? 6 : 10} align="center">
			<GithubUserButton
				githubUser={props.githubUser}
				onOpenGithubModal={props.onOpenGithubModal}
				compact={compact}
			/>
			<BackendStatusBadge
				backendStatus={props.backendStatus}
				compact={compact}
			/>
			<CopilotButton onOpenCopilot={props.onOpenCopilot} compact={compact} />
			<LabelledActionButtons {...props} />
			{compact && (
				<CompactIconButton
					icon={<UnorderedListOutlined />}
					onClick={props.onOpenAudit}
					label="Open audit list"
				/>
			)}
		</Space>
	);
}

export default function WorkspaceShell(props) {
	const { compact = false, onOpenControls } = props;
	return (
		<header className={`bn-header${compact ? " is-compact" : ""}`}>
			<HeaderLeft compact={compact} onOpenControls={onOpenControls} />
			<HeaderActions {...props} />
		</header>
	);
}
