import {
	CheckCircleFilled,
	CopyOutlined,
	DisconnectOutlined,
	ExportOutlined,
	GithubOutlined,
	KeyOutlined,
	LaptopOutlined,
	LoadingOutlined,
	SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
	Alert,
	Avatar,
	Button,
	Card,
	Divider,
	Input,
	Modal,
	message,
	Space,
	Spin,
	Tabs,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../config.js";
import {
	DARK_BG,
	DARK_BORDER,
	MUTED_GRAY,
	YELLOW_ACCENT,
} from "./githubTheme.js";

const { Text, Paragraph } = Typography;

const NEW_TOKEN_URL =
	"https://github.com/settings/tokens/new?scopes=repo,read:user&description=Banana%20Hardware%20Diff%20Studio";

const MODAL_STYLES = Object.freeze({
	content: {
		backgroundColor: "#161821",
		border: `1px solid ${DARK_BORDER}`,
		borderRadius: "8px",
		boxShadow: "0 20px 40px rgba(0, 0, 0, 0.7)",
	},
});

const HEADER_ICON_STYLE = Object.freeze({
	width: 32,
	height: 32,
	borderRadius: "50%",
	background: "#24292e",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	border: "1px solid #30363d",
});

const CARD_BOX_STYLE = Object.freeze({
	background: DARK_BG,
	borderColor: DARK_BORDER,
	borderRadius: "8px",
});

const DETECTED_CARD_STYLE = Object.freeze({
	background: "#131b14",
	borderColor: "#234427",
	borderRadius: "8px",
	marginBottom: "16px",
});

const CODE_BOX_STYLE = Object.freeze({
	cursor: "pointer",
	background: DARK_BG,
	border: `2px dashed ${YELLOW_ACCENT}`,
	borderRadius: "8px",
	padding: "16px",
	display: "inline-block",
	margin: "10px auto 16px",
});

const CODE_TEXT_STYLE = Object.freeze({
	fontSize: "26px",
	fontWeight: 800,
	letterSpacing: "4px",
	color: YELLOW_ACCENT,
	fontFamily: "monospace",
});

const LINK_STYLE = Object.freeze({
	color: YELLOW_ACCENT,
	fontSize: "12px",
	display: "flex",
	alignItems: "center",
	gap: "4px",
});

const buttonStyle = (background, color, extra) =>
	Object.freeze({ background, color, fontWeight: 600, ...extra });

const YELLOW_BTN_STYLE = buttonStyle(YELLOW_ACCENT, "#000", { border: "none" });
const GREEN_BTN_STYLE = buttonStyle("#52c41a", "#000", {
	borderColor: "#52c41a",
});
const DARK_BTN_STYLE = buttonStyle("#24292e", "#fff", {
	borderColor: "#444c56",
});

// --- Pure Device Flow Helpers ---
export const DEVICE_POLL_ERRORS = Object.freeze({
	expired_token:
		"The authorization code has expired. Please try again, or use a Personal Access Token.",
	access_denied:
		"Access was denied on GitHub. Please try again, or use a Personal Access Token.",
});

const PENDING_ERRORS = new Set(["authorization_pending", "slow_down"]);

export function isSafeGithubUrl(url) {
	if (typeof url !== "string" || !url.startsWith("https://github.com/")) {
		return false;
	}
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" && parsed.hostname === "github.com";
	} catch {
		// Return false for malformed URLs
		return false;
	}
}

export function nextPollDelay(currentInterval, response) {
	const base =
		typeof currentInterval === "number" && currentInterval > 0
			? currentInterval
			: 5;
	if (response?.error === "slow_down") {
		return base + (base >= 1000 ? 5000 : 5);
	}
	return base;
}

export function pollOutcome(response) {
	if (response?.access_token) {
		return {
			status: "success",
			type: "success",
			outcome: "success",
			token: response.access_token,
			accessToken: response.access_token,
		};
	}
	if (!response || PENDING_ERRORS.has(response.error)) {
		return { status: "continue", type: "continue", outcome: "continue" };
	}
	const baseMsg =
		DEVICE_POLL_ERRORS[response.error] ||
		response.error_description ||
		`Authentication error: ${response.error}.`;
	const message = baseMsg.includes("Personal Access Token")
		? baseMsg
		: `${baseMsg} Try again or use a Personal Access Token.`;
	return {
		status: "error",
		type: "error",
		outcome: "error",
		error: response.error,
		message,
	};
}
// --- End Pure Device Flow Helpers ---

function ModalHeader() {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
			<div style={HEADER_ICON_STYLE}>
				<GithubOutlined style={{ fontSize: "18px", color: "#fff" }} />
			</div>
			<div>
				<Text strong style={{ fontSize: "15px", color: "#f5f5f5" }}>
					GitHub Cloud Integration
				</Text>
				<div
					style={{ fontSize: "11px", color: MUTED_GRAY, fontWeight: "normal" }}
				>
					Diff remote hardware repositories, branches & Pull Requests
				</div>
			</div>
		</div>
	);
}

function RepoBadges({ publicRepos, totalPrivateRepos }) {
	const badgeItems = [
		{ count: publicRepos, label: "Public Repos", active: true },
		{
			count: totalPrivateRepos,
			label: "Private Repos",
			active: totalPrivateRepos > 0,
		},
	];
	const tagStyle = {
		background: "#1c1f2b",
		borderColor: "#30363d",
		color: "#a6adbb",
		fontSize: "11px",
	};

	return (
		<div style={{ marginTop: "6px", display: "flex", gap: "8px" }}>
			{badgeItems
				.filter((b) => b.active)
				.map((b) => (
					<Tag key={b.label} color="default" style={tagStyle}>
						{b.count} {b.label}
					</Tag>
				))}
		</div>
	);
}

function UserTitleRow({ title, tag }) {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
			{title}
			{tag}
		</div>
	);
}

function UserHeaderLayout({
	avatar,
	title,
	tag,
	subtitle,
	children,
	gap = "14px",
}) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap,
				marginBottom: "16px",
			}}
		>
			{avatar}
			<div style={{ flex: 1 }}>
				<UserTitleRow title={title} tag={tag} />
				{subtitle}
				{children}
			</div>
		</div>
	);
}

function ProfileUserInfo({ user }) {
	const avatar = (
		<Avatar
			src={user.avatarUrl}
			size={56}
			icon={<GithubOutlined />}
			style={{ border: `2px solid ${YELLOW_ACCENT}` }}
		/>
	);
	const title = (
		<Text strong style={{ color: "#fff", fontSize: "16px" }}>
			{user.name || user.login}
		</Text>
	);
	const tag = (
		<Tag color="success" icon={<CheckCircleFilled />}>
			Connected
		</Tag>
	);
	const subtitle = (
		<div style={{ color: MUTED_GRAY, fontSize: "12px" }}>@{user.login}</div>
	);

	return (
		<UserHeaderLayout
			avatar={avatar}
			title={title}
			tag={tag}
			subtitle={subtitle}
		>
			<RepoBadges
				publicRepos={user.publicRepos}
				totalPrivateRepos={user.totalPrivateRepos}
			/>
		</UserHeaderLayout>
	);
}

function isGithubProfileUrl(url) {
	return isSafeGithubUrl(url);
}

function resolveVerificationUrl(uri) {
	return isSafeGithubUrl(uri) ? uri : "https://github.com/login/device";
}

function ExternalGithubLink({ href, children }) {
	return (
		<a href={href} target="_blank" rel="noreferrer" style={LINK_STYLE}>
			{children} <ExportOutlined />
		</a>
	);
}

function ViewGithubLink({ href }) {
	if (!isGithubProfileUrl(href)) {
		return (
			<span style={{ color: MUTED_GRAY, fontSize: "12px" }}>
				View on GitHub
			</span>
		);
	}
	return <ExternalGithubLink href={href}>View on GitHub</ExternalGithubLink>;
}

function ProfileActions({ htmlUrl, onDisconnect }) {
	const handleDisconnect = () => {
		onDisconnect();
		message.info("Disconnected from GitHub");
	};

	return (
		<div
			style={{
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
			}}
		>
			<ViewGithubLink href={htmlUrl} />
			<Button
				danger
				type="text"
				size="small"
				icon={<DisconnectOutlined />}
				onClick={handleDisconnect}
			>
				Disconnect Account
			</Button>
		</div>
	);
}

function AuthenticatedProfileCard({ githubUser, onDisconnect, onClose }) {
	return (
		<div style={{ padding: "16px 0 8px" }}>
			<Card style={CARD_BOX_STYLE}>
				<ProfileUserInfo user={githubUser} />
				<Divider style={{ borderColor: DARK_BORDER, margin: "12px 0" }} />
				<ProfileActions
					htmlUrl={githubUser.htmlUrl}
					onDisconnect={onDisconnect}
				/>
			</Card>

			<div style={{ marginTop: "16px", textAlign: "right" }}>
				<Button type="primary" onClick={onClose} style={YELLOW_BTN_STYLE}>
					Done
				</Button>
			</div>
		</div>
	);
}

// ----------------------------------------------------------------------
// 1. Detected System Credentials Card (Phase 3.1 & 4.2)
// ----------------------------------------------------------------------
function DetectedUserBadge({ user, source }) {
	const avatar = (
		<Avatar
			src={user.avatarUrl}
			size={48}
			icon={<GithubOutlined />}
			style={{ border: "2px solid #52c41a" }}
		/>
	);
	const title = (
		<Text strong style={{ color: "#fff", fontSize: "14px" }}>
			@{user.login}
		</Text>
	);
	const tag = (
		<Tag color="success" icon={<LaptopOutlined />}>
			{source}
		</Tag>
	);
	const subtitle = (
		<Text style={{ color: "#86efac", fontSize: "11px" }}>
			Existing credentials detected on this computer.
		</Text>
	);

	return (
		<UserHeaderLayout
			avatar={avatar}
			title={title}
			tag={tag}
			subtitle={subtitle}
			gap="12px"
		/>
	);
}

function SystemDetectedCard({ detected, onConnect, onIgnore }) {
	if (!detected?.user) return null;
	const { user, source, token } = detected;

	return (
		<Card style={DETECTED_CARD_STYLE}>
			<DetectedUserBadge user={user} source={source} />
			<div
				style={{
					display: "flex",
					gap: "8px",
					justifyContent: "flex-end",
					alignItems: "center",
				}}
			>
				<Button
					type="text"
					size="small"
					onClick={onIgnore}
					style={{ color: "#94a3b8", fontSize: "11px" }}
				>
					Use another account
				</Button>
				<Button
					type="primary"
					icon={<GithubOutlined />}
					onClick={() => onConnect(token, user)}
					style={GREEN_BTN_STYLE}
				>
					Connect as @{user.login} (1-Click)
				</Button>
			</div>
		</Card>
	);
}

// ----------------------------------------------------------------------
// 2. Device Flow View (Phase 3.2 & 4.3)
// ----------------------------------------------------------------------
function copyUserCode(code) {
	if (!code) return;
	try {
		navigator.clipboard?.writeText(code)?.catch?.(() => {});
	} catch {
		// Ignore clipboard access restrictions
	}
	message.success("Code copied to clipboard!");
}

function openDeviceVerification(deviceData) {
	if (!deviceData) return;
	copyUserCode(deviceData.user_code);
	const rawUrl =
		deviceData.verification_uri || "https://github.com/login/device";
	const targetUrl = resolveVerificationUrl(rawUrl);
	if (window.banana?.openExternal) {
		window.banana.openExternal(targetUrl);
		return;
	}
	window.open(targetUrl, "_blank", "noopener,noreferrer");
}

async function requestDeviceCode() {
	if (window.banana?.github?.startDeviceFlow) {
		return await window.banana.github.startDeviceFlow();
	}
	const res = await fetch(`${API_BASE_URL}/api/github/device/code`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({}),
	});
	const data = await res.json();
	if (!res.ok || data.error) {
		throw new Error(
			data.error_description ||
				data.error ||
				"Failed to start device authorization flow",
		);
	}
	return data;
}

async function executePollStep(deviceCode) {
	try {
		if (window.banana?.github?.pollDeviceFlow) {
			return await window.banana.github.pollDeviceFlow(deviceCode);
		}
		const res = await fetch(`${API_BASE_URL}/api/github/device/token`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ device_code: deviceCode }),
		});
		return await res.json();
	} catch (err) {
		// Log transient polling network error
		console.debug("Device poll error:", err.message);
		return null;
	}
}

async function handleVerifiedDeviceToken(token, ctx) {
	const verify = await verifyPatToken(token);
	if (verify.ok) {
		message.success(`Successfully connected as @${verify.user.login}!`);
		ctx.onAuthSuccess(token, verify.user);
		ctx.onClose();
		return;
	}
	ctx.setErrorMsg(verify.error);
}

async function pollLoopStep(data, expireTime, ctx) {
	if (Date.now() >= expireTime) {
		ctx.stopPolling();
		ctx.setErrorMsg(DEVICE_POLL_ERRORS.expired_token);
		return { done: true };
	}
	const res = await executePollStep(data.device_code);
	const outcome = pollOutcome(res);
	if (outcome.status === "success") {
		ctx.stopPolling();
		await handleVerifiedDeviceToken(outcome.token, ctx);
		return { done: true };
	}
	if (outcome.status === "error") {
		ctx.stopPolling();
		ctx.setErrorMsg(outcome.message);
		return { done: true };
	}
	return { done: false, res };
}

async function runDevicePollingLoop(data, gen, ctx) {
	let delayMs = (data?.interval || 5) * 1000;
	const expireTime = Date.now() + (data?.expires_in || 900) * 1000;

	while (ctx.isActive(gen)) {
		await ctx.sleep(delayMs);
		if (!ctx.isActive(gen)) break;

		const step = await pollLoopStep(data, expireTime, ctx);
		if (step.done || !ctx.isActive(gen)) break;

		delayMs = nextPollDelay(delayMs, step.res);
	}
}

async function executeStartFlow(setters, pollStart) {
	setters.setLoading(true);
	setters.setErrorMsg(null);
	setters.setDeviceData(null);
	try {
		const data = await requestDeviceCode();
		setters.setDeviceData(data);
		setters.setLoading(false);
		pollStart(data);
	} catch (e) {
		setters.setLoading(false);
		setters.setErrorMsg(
			e.message || "Failed to request device authorization code",
		);
	}
}

function usePollingRef() {
	const activePollRef = useRef(0);
	useEffect(() => {
		const ref = activePollRef;
		return () => {
			ref.current++;
		};
	}, []);
	return activePollRef;
}

function useDevicePolling({
	onAuthSuccess,
	onClose,
	setErrorMsg,
	clearDeviceData,
}) {
	const [polling, setPolling] = useState(false);
	const [statusMsg, setStatusMsg] = useState("");
	const activePollRef = usePollingRef();
	const timerRef = useRef(null);

	const cancel = useCallback(() => {
		activePollRef.current++;
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		setPolling(false);
	}, [activePollRef]);

	useEffect(() => {
		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};
	}, []);

	const sleep = (ms) =>
		new Promise((resolve) => {
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				resolve();
			}, ms);
		});

	const start = (data) => {
		const gen = ++activePollRef.current;
		setPolling(true);
		setStatusMsg("Waiting for you to approve on GitHub");
		runDevicePollingLoop(data, gen, {
			isActive: (g) => activePollRef.current === g,
			stopPolling: cancel,
			onAuthSuccess,
			onClose,
			setErrorMsg: (msg) => {
				setErrorMsg(msg);
				clearDeviceData?.();
			},
			sleep,
		});
	};

	return { polling, statusMsg, start, cancel };
}

function useDeviceFlow({ onAuthSuccess, onClose, open }) {
	const [deviceData, setDeviceData] = useState(null);
	const [loading, setLoading] = useState(false);
	const [errorMsg, setErrorMsg] = useState(null);
	const clearDeviceData = () => setDeviceData(null);
	const poll = useDevicePolling({
		onAuthSuccess,
		onClose,
		setErrorMsg,
		clearDeviceData,
	});

	const { cancel } = poll;
	useEffect(() => {
		if (!open) {
			cancel();
			setDeviceData(null);
		}
	}, [open, cancel]);

	const startFlow = () => {
		poll.cancel();
		executeStartFlow({ setLoading, setErrorMsg, setDeviceData }, poll.start);
	};

	return {
		...poll,
		deviceData,
		loading,
		errorMsg,
		startFlow,
		cancelFlow: () => {
			poll.cancel();
			clearDeviceData();
		},
		copyCode: () => copyUserCode(deviceData?.user_code),
		openPage: () => openDeviceVerification(deviceData),
	};
}

function DevicePromptAlert({ message: msg }) {
	if (!msg) return null;
	const hasPat = msg.includes("Personal Access Token");
	const description = hasPat
		? undefined
		: "You can try again, or use the Personal Access Token tab as a fallback.";
	return (
		<Alert
			type="error"
			message={msg}
			description={description}
			showIcon
			style={{ marginBottom: "16px", textAlign: "left" }}
		/>
	);
}

function DeviceFlowPrompt({ loading, errorMsg, onStart }) {
	return (
		<div>
			<Paragraph
				style={{ color: "#a6adbb", fontSize: "12px", marginBottom: "16px" }}
			>
				Connect securely without copying secrets or generating tokens. A
				one-time code will be opened in your browser to approve.
			</Paragraph>
			<DevicePromptAlert message={errorMsg} />
			<Button
				type="primary"
				size="large"
				loading={loading}
				icon={<GithubOutlined />}
				onClick={onStart}
				style={DARK_BTN_STYLE}
			>
				{errorMsg ? "Try Again" : "Start 1-Click Browser Login"}
			</Button>
		</div>
	);
}

function DeviceCodeBox({ userCode, onClick }) {
	const handleKeyDown = (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onClick?.(e);
		}
	};

	return (
		// biome-ignore lint/a11y/useSemanticElements: interactive container contains block layout
		<div
			role="button"
			tabIndex={0}
			onClick={onClick}
			onKeyDown={handleKeyDown}
			title="Click to copy and open GitHub"
			style={CODE_BOX_STYLE}
		>
			<div style={CODE_TEXT_STYLE}>{userCode}</div>
			<div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>
				<CopyOutlined /> Click to copy & open GitHub
			</div>
		</div>
	);
}

function DeviceFlowStatus({ polling, statusMsg }) {
	if (!polling) return null;
	const icon = (
		<LoadingOutlined style={{ fontSize: 16, color: YELLOW_ACCENT }} spin />
	);
	return (
		<div
			style={{
				color: "#94a3b8",
				fontSize: "12px",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				gap: "8px",
			}}
		>
			<Spin indicator={icon} />
			<span>{statusMsg || "Waiting for you to approve on GitHub"}</span>
		</div>
	);
}

function DeviceFlowApproval(props) {
	const { deviceData, polling, statusMsg, onCopy, onOpen, onCancel } = props;
	const openBtnStyle = { ...YELLOW_BTN_STYLE, marginRight: "8px" };

	return (
		<div>
			<Paragraph style={{ color: "#a6adbb", fontSize: "12px" }}>
				Enter this code on GitHub to authorize Banana Studio:
			</Paragraph>
			<DeviceCodeBox userCode={deviceData.user_code} onClick={onOpen} />
			<div style={{ marginBottom: "16px" }}>
				<Button
					icon={<CopyOutlined />}
					onClick={onCopy}
					style={{ marginRight: "8px" }}
				>
					Copy Code
				</Button>
				<Button type="primary" onClick={onOpen} style={openBtnStyle}>
					Open GitHub
				</Button>
				<Button onClick={onCancel}>Cancel</Button>
			</div>
			<DeviceFlowStatus polling={polling} statusMsg={statusMsg} />
		</div>
	);
}

function DeviceFlowTab({ onAuthSuccess, onClose, open }) {
	const flow = useDeviceFlow({ onAuthSuccess, onClose, open });

	return (
		<div style={{ padding: "8px 0", textAlign: "center" }}>
			{!flow.deviceData ? (
				<DeviceFlowPrompt
					loading={flow.loading}
					errorMsg={flow.errorMsg}
					onStart={flow.startFlow}
				/>
			) : (
				<DeviceFlowApproval
					deviceData={flow.deviceData}
					polling={flow.polling}
					statusMsg={flow.statusMsg}
					onCopy={flow.copyCode}
					onOpen={flow.openPage}
					onCancel={flow.cancelFlow}
				/>
			)}
		</div>
	);
}

// ----------------------------------------------------------------------
// 3. PAT Authentication Tab
// ----------------------------------------------------------------------
function PatInputSection({ patInput, setPatInput, onVerify }) {
	return (
		<div style={{ marginBottom: "16px" }}>
			<Paragraph
				style={{ color: "#a6adbb", fontSize: "12px", marginBottom: "14px" }}
			>
				Connect using a GitHub Personal Access Token (Classic or Fine-grained)
				with{" "}
				<Text code style={{ color: YELLOW_ACCENT }}>
					repo
				</Text>{" "}
				permissions.
			</Paragraph>
			<Text
				style={{
					fontSize: "12px",
					color: "#e2e8f0",
					display: "block",
					marginBottom: "6px",
				}}
			>
				GitHub Personal Access Token:
			</Text>
			<Input.Password
				placeholder="ghp_... or github_pat_..."
				value={patInput}
				onChange={(e) => setPatInput(e.target.value)}
				onPressEnter={onVerify}
				style={{
					background: DARK_BG,
					borderColor: DARK_BORDER,
					color: "#fff",
					fontFamily: "monospace",
				}}
			/>
		</div>
	);
}

function PatSecurityAlert() {
	return (
		<Alert
			type="info"
			showIcon
			icon={<SafetyCertificateOutlined style={{ color: YELLOW_ACCENT }} />}
			title="Encrypted via OS Keychain"
			description="In Desktop mode, tokens are encrypted in your operating system keychain (Windows Credential Manager / macOS Keychain)."
			style={{
				background: DARK_BG,
				borderColor: DARK_BORDER,
				color: "#a6adbb",
				fontSize: "11px",
				marginBottom: "16px",
			}}
		/>
	);
}

function PatFooterActions({ verifying, onVerify, onClose }) {
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
			}}
		>
			<ExternalGithubLink href={NEW_TOKEN_URL}>
				Generate Token on GitHub
			</ExternalGithubLink>
			<Space>
				<Button onClick={onClose}>Cancel</Button>
				<Button
					type="primary"
					loading={verifying}
					onClick={onVerify}
					style={YELLOW_BTN_STYLE}
				>
					Verify & Connect
				</Button>
			</Space>
		</div>
	);
}

function PatAuthTab(props) {
	const { patInput, setPatInput, verifying, onVerify, onClose } = props;
	return (
		<div>
			<PatInputSection
				patInput={patInput}
				setPatInput={setPatInput}
				onVerify={onVerify}
			/>
			<PatSecurityAlert />
			<PatFooterActions
				verifying={verifying}
				onVerify={onVerify}
				onClose={onClose}
			/>
		</div>
	);
}

async function verifyPatToken(token) {
	const res = await fetch(`${API_BASE_URL}/api/auth/github/verify`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	const data = await res.json();
	if (res.ok && data.authenticated) {
		return { ok: true, user: data.user };
	}
	return { ok: false, error: data.error || "Failed to authenticate token." };
}

// ----------------------------------------------------------------------
// Main Modal Component with State Machine
// ----------------------------------------------------------------------
function useSystemAuthDetection(open) {
	const [detectedCli, setDetectedCli] = useState(null);
	const [showDetected, setShowDetected] = useState(true);

	// Auto-detect system GitHub credentials on mount (T3.1, T4.1, T4.2)
	useEffect(() => {
		if (!open || !window.banana?.github?.detectSystemAuth) return;
		window.banana.github
			.detectSystemAuth()
			.then((res) => {
				const detected = Boolean(res?.detected);
				setDetectedCli(detected ? res : null);
				if (detected) setShowDetected(true);
			})
			.catch((err) => {
				console.debug("Failed to detect system auth:", err);
			});
	}, [open]);

	return {
		detectedCli,
		showDetected,
		dismissDetected: () => setShowDetected(false),
	};
}

async function executePatVerification(trimmed, actions) {
	try {
		const result = await verifyPatToken(trimmed);
		if (result.ok) {
			message.success(`Connected to GitHub as @${result.user.login}!`);
			actions.onSuccess(result.user);
			return;
		}
		message.error(result.error);
	} catch (e) {
		message.error(`Connection error: ${e.message}`);
	} finally {
		actions.onDone();
	}
}

function usePatVerification({ onAuthSuccess, onClose }) {
	const [patInput, setPatInput] = useState("");
	const [verifying, setVerifying] = useState(false);

	const handleVerifyPat = () => {
		const trimmed = patInput.trim();
		if (!trimmed) {
			message.error("Please enter a GitHub Personal Access Token");
			return;
		}
		setVerifying(true);
		executePatVerification(trimmed, {
			onSuccess: (user) => {
				onAuthSuccess(trimmed, user);
				setPatInput("");
				onClose();
			},
			onDone: () => setVerifying(false),
		});
	};

	return { patInput, setPatInput, verifying, handleVerifyPat };
}

function makeTabItem(key, icon, label, children) {
	return {
		key,
		label: (
			<span>
				{icon}
				{label}
			</span>
		),
		children,
	};
}

function buildAuthTabItems({ onAuthSuccess, onClose, open, patState }) {
	return [
		makeTabItem(
			"device",
			<GithubOutlined style={{ marginRight: "6px" }} />,
			"1-Click Browser Login",
			<DeviceFlowTab
				onAuthSuccess={onAuthSuccess}
				onClose={onClose}
				open={open}
			/>,
		),
		makeTabItem(
			"pat",
			<KeyOutlined style={{ marginRight: "6px" }} />,
			"Personal Access Token",
			<PatAuthTab
				patInput={patState.patInput}
				setPatInput={patState.setPatInput}
				verifying={patState.verifying}
				onVerify={patState.handleVerifyPat}
				onClose={onClose}
			/>,
		),
	];
}

function UnauthenticatedContent(props) {
	const {
		detected,
		onConnectDetected,
		onDismissDetected,
		tabItems,
		activeTab,
		onTabChange,
	} = props;
	return (
		<div style={{ padding: "8px 0 0" }}>
			{detected && (
				<SystemDetectedCard
					detected={detected}
					onConnect={onConnectDetected}
					onIgnore={onDismissDetected}
				/>
			)}

			<Tabs activeKey={activeTab} onChange={onTabChange} items={tabItems} />
		</div>
	);
}

function ConnectModalBody({ githubUser, onDisconnect, onClose, unauthProps }) {
	if (githubUser) {
		return (
			<AuthenticatedProfileCard
				githubUser={githubUser}
				onDisconnect={onDisconnect}
				onClose={onClose}
			/>
		);
	}
	return <UnauthenticatedContent {...unauthProps} />;
}

function useModalAuth({ open, onClose, onAuthSuccess }) {
	const [activeTab, setActiveTab] = useState("device");
	const patState = usePatVerification({ onAuthSuccess, onClose });
	const sysAuth = useSystemAuthDetection(open);

	const handleConnectDetected = (token, user) => {
		message.success(`Connected as @${user.login}!`);
		onAuthSuccess(token, user);
		onClose();
	};

	return {
		detected: sysAuth.showDetected ? sysAuth.detectedCli : null,
		onConnectDetected: handleConnectDetected,
		onDismissDetected: sysAuth.dismissDetected,
		tabItems: buildAuthTabItems({ onAuthSuccess, onClose, open, patState }),
		activeTab,
		onTabChange: setActiveTab,
	};
}

export default function GithubConnectModal({
	open,
	onClose,
	githubUser,
	onAuthSuccess,
	onDisconnect,
}) {
	const unauthProps = useModalAuth({ open, onClose, onAuthSuccess });

	return (
		<Modal
			open={open}
			onCancel={onClose}
			footer={null}
			width={520}
			title={<ModalHeader />}
			styles={MODAL_STYLES}
		>
			<ConnectModalBody
				githubUser={githubUser}
				onDisconnect={onDisconnect}
				onClose={onClose}
				unauthProps={unauthProps}
			/>
		</Modal>
	);
}
