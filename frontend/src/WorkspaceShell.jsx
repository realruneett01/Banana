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

function CopilotButton({ onOpenCopilot, compact }) {
	return (
		<Tooltip title="Open Banana Hardware Copilot (AI PCB Diff Assistant)">
			<Button
				type="primary"
				icon={<RobotOutlined />}
				onClick={() => onOpenCopilot?.()}
				className="bn-copilot-btn"
				style={{ height: BUTTON_HEIGHT }}
			>
				{!compact && "Copilot"}
			</Button>
		</Tooltip>
	);
}

function AgentButton({ onOpenAgent, compact }) {
	return (
		<Tooltip title="Design with AI">
			<Button
				type="primary"
				icon={<ExperimentOutlined />}
				onClick={() => onOpenAgent?.()}
				className="bn-copilot-btn"
				style={{ height: BUTTON_HEIGHT }}
				aria-label="Design with AI"
			>
				{!compact && "Design with AI"}
			</Button>
		</Tooltip>
	);
}

function SimulationButton({ onOpenSimulation, compact }) {
	return (
		<Tooltip title="Simulate">
			<Button
				type="primary"
				icon={<ThunderboltOutlined />}
				onClick={() => onOpenSimulation?.()}
				className="bn-copilot-btn"
				style={{ height: BUTTON_HEIGHT }}
				aria-label="Simulate"
			>
				{!compact && "Simulate"}
			</Button>
		</Tooltip>
	);
}

function StudioButton({ onOpenStudio, compact }) {
	return (
		<Tooltip title="3D Studio">
			<Button
				type="primary"
				icon={<ThunderboltFilled />}
				onClick={() => onOpenStudio?.()}
				className="bn-copilot-btn"
				style={{ height: BUTTON_HEIGHT }}
				aria-label="3D Studio"
			>
				{!compact && "3D Studio"}
			</Button>
		</Tooltip>
	);
}

function EditorButton({ onOpenEditor, compact }) {
	return (
		<Tooltip title="Editor">
			<Button
				type="primary"
				icon={<EditOutlined />}
				onClick={() => onOpenEditor?.()}
				className="bn-copilot-btn"
				style={{ height: BUTTON_HEIGHT }}
				aria-label="Editor"
			>
				{!compact && "Editor"}
			</Button>
		</Tooltip>
	);
}

function HeaderLeft({ compact, onOpenControls }) {
	return (
		<div className="bn-header-left">
			{compact && (
				<Button
					type="text"
					className="bn-icon-btn"
					icon={<MenuOutlined />}
					onClick={onOpenControls}
					aria-label="Open controls"
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
			<AgentButton onOpenAgent={props.onOpenAgent} compact={compact} />
			<SimulationButton
				onOpenSimulation={props.onOpenSimulation}
				compact={compact}
			/>
			<StudioButton onOpenStudio={props.onOpenStudio} compact={compact} />
			<EditorButton onOpenEditor={props.onOpenEditor} compact={compact} />
			{compact && (
				<Button
					type="text"
					className="bn-icon-btn"
					icon={<UnorderedListOutlined />}
					onClick={props.onOpenAudit}
					aria-label="Open audit list"
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
