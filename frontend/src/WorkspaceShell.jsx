import {
	FileSearchOutlined,
	GithubOutlined,
	MenuOutlined,
	RobotOutlined,
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
				<span className="bn-brand-name">Banana 2.0</span>
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

function GithubUserButton({ githubUser, onOpenGithubModal, compact }) {
	if (githubUser) {
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

function BackendStatusBadge({ backendStatus, kicadVersion, compact }) {
	const isHealthy = backendStatus === "healthy";
	const label = isHealthy
		? `KiCad ${kicadVersion || "CLI"}`
		: "Backend offline";
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

export default function WorkspaceShell({
	onOpenCopilot,
	kicadVersion,
	backendStatus,
	githubUser,
	onOpenGithubModal,
	compact = false,
	onOpenControls,
	onOpenAudit,
}) {
	return (
		<header className={`bn-header${compact ? " is-compact" : ""}`}>
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

			<Space size={compact ? 6 : 10} align="center">
				<GithubUserButton
					githubUser={githubUser}
					onOpenGithubModal={onOpenGithubModal}
					compact={compact}
				/>
				<BackendStatusBadge
					backendStatus={backendStatus}
					kicadVersion={kicadVersion}
					compact={compact}
				/>
				<CopilotButton onOpenCopilot={onOpenCopilot} compact={compact} />
				{compact && (
					<Button
						type="text"
						className="bn-icon-btn"
						icon={<UnorderedListOutlined />}
						onClick={onOpenAudit}
						aria-label="Open audit list"
					/>
				)}
			</Space>
		</header>
	);
}
