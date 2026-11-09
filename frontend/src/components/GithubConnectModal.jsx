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
import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../config.js";

const { Text, Paragraph } = Typography;

const NEW_TOKEN_URL =
	"https://github.com/settings/tokens/new?scopes=repo,read:user&description=Banana%20Hardware%20Diff%20Studio";

const MODAL_STYLES = Object.freeze({
	content: {
		backgroundColor: "#161821",
		border: "1px solid #232738",
		borderRadius: "8px",
		boxShadow: "0 20px 40px rgba(0, 0, 0, 0.7)",
	},
});

function ModalHeader() {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
			<div
				style={{
					width: 32,
					height: 32,
					borderRadius: "50%",
					background: "#24292e",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					border: "1px solid #30363d",
				}}
			>
				<GithubOutlined style={{ fontSize: "18px", color: "#fff" }} />
			</div>
			<div>
				<Text strong style={{ fontSize: "15px", color: "#f5f5f5" }}>
					GitHub Cloud Integration
				</Text>
				<div
					style={{ fontSize: "11px", color: "#8b949e", fontWeight: "normal" }}
				>
					Diff remote hardware repositories, branches & Pull Requests
				</div>
			</div>
		</div>
	);
}

function AuthenticatedProfileCard({ githubUser, onDisconnect, onClose }) {
	return (
		<div style={{ padding: "16px 0 8px" }}>
			<Card
				style={{
					background: "#0f1015",
					borderColor: "#232738",
					borderRadius: "8px",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "14px",
						marginBottom: "16px",
					}}
				>
					<Avatar
						src={githubUser.avatarUrl}
						size={56}
						icon={<GithubOutlined />}
						style={{ border: "2px solid #fadb14" }}
					/>
					<div style={{ flex: 1 }}>
						<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
							<Text strong style={{ color: "#fff", fontSize: "16px" }}>
								{githubUser.name || githubUser.login}
							</Text>
							<Tag color="success" icon={<CheckCircleFilled />}>
								Connected
							</Tag>
						</div>
						<div style={{ color: "#8b949e", fontSize: "12px" }}>
							@{githubUser.login}
						</div>
						<div style={{ marginTop: "6px", display: "flex", gap: "8px" }}>
							<Tag
								color="default"
								style={{
									background: "#1c1f2b",
									borderColor: "#30363d",
									color: "#a6adbb",
									fontSize: "11px",
								}}
							>
								{githubUser.publicRepos} Public Repos
							</Tag>
							{githubUser.totalPrivateRepos > 0 && (
								<Tag
									color="default"
									style={{
										background: "#1c1f2b",
										borderColor: "#30363d",
										color: "#a6adbb",
										fontSize: "11px",
									}}
								>
									{githubUser.totalPrivateRepos} Private Repos
								</Tag>
							)}
						</div>
					</div>
				</div>

				<Divider style={{ borderColor: "#232738", margin: "12px 0" }} />

				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
					}}
				>
					<a
						href={githubUser.htmlUrl}
						target="_blank"
						rel="noreferrer"
						style={{
							color: "#fadb14",
							fontSize: "12px",
							display: "flex",
							alignItems: "center",
							gap: "4px",
						}}
					>
						View on GitHub <ExportOutlined />
					</a>

					<Button
						danger
						type="text"
						size="small"
						icon={<DisconnectOutlined />}
						onClick={() => {
							onDisconnect();
							message.info("Disconnected from GitHub");
						}}
					>
						Disconnect Account
					</Button>
				</div>
			</Card>

			<div style={{ marginTop: "16px", textAlign: "right" }}>
				<Button
					type="primary"
					onClick={onClose}
					style={{ background: "#fadb14", color: "#000", fontWeight: 600 }}
				>
					Done
				</Button>
			</div>
		</div>
	);
}

// ----------------------------------------------------------------------
// 1. Detected System Credentials Card (Phase 3.1 & 4.2)
// ----------------------------------------------------------------------
function SystemDetectedCard({ detected, onConnect, onIgnore }) {
	if (!detected?.user) return null;

	return (
		<Card
			style={{
				background: "#131b14",
				borderColor: "#234427",
				borderRadius: "8px",
				marginBottom: "16px",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "12px",
					marginBottom: "12px",
				}}
			>
				<Avatar
					src={detected.user.avatarUrl}
					size={48}
					icon={<GithubOutlined />}
					style={{ border: "2px solid #52c41a" }}
				/>
				<div style={{ flex: 1 }}>
					<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
						<Text strong style={{ color: "#fff", fontSize: "14px" }}>
							@{detected.user.login}
						</Text>
						<Tag color="success" icon={<LaptopOutlined />}>
							{detected.source}
						</Tag>
					</div>
					<Text style={{ color: "#86efac", fontSize: "11px" }}>
						Existing credentials detected on this computer.
					</Text>
				</div>
			</div>

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
					onClick={() => onConnect(detected.token, detected.user)}
					style={{
						background: "#52c41a",
						borderColor: "#52c41a",
						color: "#000",
						fontWeight: 600,
					}}
				>
					Connect as @{detected.user.login} (1-Click)
				</Button>
			</div>
		</Card>
	);
}

// ----------------------------------------------------------------------
// 2. Device Flow View (Phase 3.2 & 4.3)
// ----------------------------------------------------------------------
function DeviceFlowTab({ onAuthSuccess, onClose }) {
	const [loading, setLoading] = useState(false);
	const [deviceData, setDeviceData] = useState(null);
	const [polling, setPolling] = useState(false);
	const [statusMsg, setStatusMsg] = useState("");
	const [errorMsg, setErrorMsg] = useState(null);
	const activePollRef = useRef(0);

	const startFlow = async () => {
		setLoading(true);
		setErrorMsg(null);
		setDeviceData(null);
		activePollRef.current++;

		try {
			if (!window.banana?.github?.startDeviceFlow) {
				throw new Error(
					"Device flow is only available in the Banana Desktop application.",
				);
			}

			const data = await window.banana.github.startDeviceFlow();
			setDeviceData(data);
			setLoading(false);
			beginPolling(data);
		} catch (e) {
			setLoading(false);
			setErrorMsg(e.message || "Failed to request device authorization code");
		}
	};

	const beginPolling = async (data) => {
		const gen = ++activePollRef.current;
		setPolling(true);
		setStatusMsg("Waiting for approval in your browser...");

		let interval = (data.interval || 5) * 1000;

		while (activePollRef.current === gen) {
			await new Promise((r) => setTimeout(r, interval));
			if (activePollRef.current !== gen) break;

			try {
				const res = await window.banana.github.pollDeviceFlow(data.device_code);
				if (activePollRef.current !== gen) break;
				if (res.access_token) {
					activePollRef.current++;
					setPolling(false);
					const verify = await verifyPatToken(res.access_token);
					if (verify.ok) {
						message.success(`Successfully connected as @${verify.user.login}!`);
						onAuthSuccess(res.access_token, verify.user);
						onClose();
					} else {
						setErrorMsg(verify.error);
					}
					return;
				}

				if (res.error === "slow_down") {
					interval += 5000;
				} else if (res.error === "expired_token") {
					activePollRef.current++;
					setPolling(false);
					setErrorMsg(
						"The code has expired. Please click Restart to try again.",
					);
					return;
				} else if (res.error === "access_denied") {
					activePollRef.current++;
					setPolling(false);
					setErrorMsg("Access was denied on GitHub.");
					return;
				}
			} catch (err) {
				console.debug("Device poll poll error:", err.message);
			}
		}
	};

	const cancelFlow = () => {
		activePollRef.current++;
		setPolling(false);
		setDeviceData(null);
	};

	useEffect(() => {
		const pollGen = activePollRef; // counter ref, not a DOM node: stop any running poll loop on unmount
		return () => {
			pollGen.current++;
		};
	}, []);

	const openVerificationPage = () => {
		if (!deviceData) return;
		navigator.clipboard.writeText(deviceData.user_code);
		message.success("Code copied to clipboard!");
		const targetUrl =
			deviceData.verification_uri || "https://github.com/login/device";
		if (window.banana?.openExternal) {
			window.banana.openExternal(targetUrl);
		} else {
			window.open(targetUrl, "_blank");
		}
	};

	return (
		<div style={{ padding: "8px 0", textAlign: "center" }}>
			{!deviceData ? (
				<div>
					<Paragraph
						style={{ color: "#a6adbb", fontSize: "12px", marginBottom: "16px" }}
					>
						Connect securely without copying secrets or generating tokens. A
						one-time code will be opened in your browser to approve.
					</Paragraph>

					{errorMsg && (
						<Alert
							type="error"
							message={errorMsg}
							showIcon
							style={{ marginBottom: "16px", textAlign: "left" }}
						/>
					)}

					<Button
						type="primary"
						size="large"
						loading={loading}
						icon={<GithubOutlined />}
						onClick={startFlow}
						style={{
							background: "#24292e",
							borderColor: "#444c56",
							color: "#fff",
							fontWeight: 600,
						}}
					>
						Start 1-Click Browser Login
					</Button>
				</div>
			) : (
				<div>
					<Paragraph style={{ color: "#a6adbb", fontSize: "12px" }}>
						Enter this code on GitHub to authorize Banana Studio:
					</Paragraph>

					<div
						onClick={openVerificationPage}
						title="Click to copy and open GitHub"
						style={{
							cursor: "pointer",
							background: "#0f1015",
							border: "2px dashed #fadb14",
							borderRadius: "8px",
							padding: "16px",
							display: "inline-block",
							margin: "10px auto 16px",
						}}
					>
						<div
							style={{
								fontSize: "26px",
								fontWeight: 800,
								letterSpacing: "4px",
								color: "#fadb14",
								fontFamily: "monospace",
							}}
						>
							{deviceData.user_code}
						</div>
						<div
							style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}
						>
							<CopyOutlined /> Click to copy & open GitHub
						</div>
					</div>

					<div style={{ marginBottom: "16px" }}>
						<Button
							type="primary"
							onClick={openVerificationPage}
							style={{
								background: "#fadb14",
								color: "#000",
								fontWeight: 600,
								marginRight: "8px",
							}}
						>
							Open GitHub in Browser
						</Button>
						<Button onClick={cancelFlow}>Cancel</Button>
					</div>

					{polling && (
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
							<Spin
								indicator={
									<LoadingOutlined
										style={{ fontSize: 16, color: "#fadb14" }}
										spin
									/>
								}
							/>
							<span>{statusMsg}</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ----------------------------------------------------------------------
// 3. PAT Authentication Tab
// ----------------------------------------------------------------------
function PatAuthTab({ patInput, setPatInput, verifying, onVerify, onClose }) {
	return (
		<div>
			<Paragraph
				style={{ color: "#a6adbb", fontSize: "12px", marginBottom: "14px" }}
			>
				Connect using a GitHub Personal Access Token (Classic or Fine-grained)
				with{" "}
				<Text code style={{ color: "#fadb14" }}>
					repo
				</Text>{" "}
				permissions.
			</Paragraph>

			<div style={{ marginBottom: "16px" }}>
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
						background: "#0f1015",
						borderColor: "#232738",
						color: "#fff",
						fontFamily: "monospace",
					}}
				/>
			</div>

			<Alert
				type="info"
				showIcon
				icon={<SafetyCertificateOutlined style={{ color: "#fadb14" }} />}
				title="Encrypted via OS Keychain"
				description="In Desktop mode, tokens are encrypted in your operating system keychain (Windows Credential Manager / macOS Keychain)."
				style={{
					background: "#0f1015",
					borderColor: "#232738",
					color: "#a6adbb",
					fontSize: "11px",
					marginBottom: "16px",
				}}
			/>

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
				}}
			>
				<a
					href={NEW_TOKEN_URL}
					target="_blank"
					rel="noreferrer"
					style={{
						color: "#fadb14",
						fontSize: "12px",
						display: "flex",
						alignItems: "center",
						gap: "4px",
					}}
				>
					Generate Token on GitHub <ExportOutlined />
				</a>

				<Space>
					<Button onClick={onClose}>Cancel</Button>
					<Button
						type="primary"
						loading={verifying}
						onClick={onVerify}
						style={{
							background: "#fadb14",
							color: "#000",
							fontWeight: 600,
							border: "none",
						}}
					>
						Verify & Connect
					</Button>
				</Space>
			</div>
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
export default function GithubConnectModal({
	open,
	onClose,
	githubUser,
	onAuthSuccess,
	onDisconnect,
}) {
	const [activeTab, setActiveTab] = useState("device");
	const [patInput, setPatInput] = useState("");
	const [verifying, setVerifying] = useState(false);
	const [detectedCli, setDetectedCli] = useState(null);
	const [showDetected, setShowDetected] = useState(true);

	// Auto-detect system GitHub credentials on mount (T3.1, T4.1, T4.2)
	useEffect(() => {
		if (!open) return;
		if (window.banana?.github?.detectSystemAuth) {
			window.banana.github.detectSystemAuth().then((res) => {
				if (res?.detected) {
					setDetectedCli(res);
					setShowDetected(true);
				} else {
					setDetectedCli(null);
				}
			});
		}
	}, [open]);

	const handleVerifyPat = async () => {
		const trimmed = patInput.trim();
		if (!trimmed) {
			message.error("Please enter a GitHub Personal Access Token");
			return;
		}

		setVerifying(true);
		try {
			const result = await verifyPatToken(trimmed);
			if (result.ok) {
				message.success(`Connected to GitHub as @${result.user.login}!`);
				onAuthSuccess(trimmed, result.user);
				setPatInput("");
				onClose();
			} else {
				message.error(result.error);
			}
		} catch (e) {
			message.error(`Connection error: ${e.message}`);
		} finally {
			setVerifying(false);
		}
	};

	const handleConnectDetected = (token, user) => {
		message.success(`Connected as @${user.login}!`);
		onAuthSuccess(token, user);
		onClose();
	};

	const isDesktop = Boolean(window.banana?.isElectron);

	const tabItems = [
		...(isDesktop
			? [
					{
						key: "device",
						label: (
							<span>
								<GithubOutlined style={{ marginRight: "6px" }} />
								1-Click Browser Login
							</span>
						),
						children: (
							<DeviceFlowTab onAuthSuccess={onAuthSuccess} onClose={onClose} />
						),
					},
				]
			: []),
		{
			key: "pat",
			label: (
				<span>
					<KeyOutlined style={{ marginRight: "6px" }} />
					Personal Access Token
				</span>
			),
			children: (
				<PatAuthTab
					patInput={patInput}
					setPatInput={setPatInput}
					verifying={verifying}
					onVerify={handleVerifyPat}
					onClose={onClose}
				/>
			),
		},
	];

	return (
		<Modal
			open={open}
			onCancel={onClose}
			footer={null}
			width={520}
			title={<ModalHeader />}
			styles={MODAL_STYLES}
		>
			{githubUser ? (
				<AuthenticatedProfileCard
					githubUser={githubUser}
					onDisconnect={onDisconnect}
					onClose={onClose}
				/>
			) : (
				<div style={{ padding: "8px 0 0" }}>
					{showDetected && detectedCli && (
						<SystemDetectedCard
							detected={detectedCli}
							onConnect={handleConnectDetected}
							onIgnore={() => setShowDetected(false)}
						/>
					)}

					<Tabs
						activeKey={activeTab}
						onChange={setActiveTab}
						items={tabItems}
					/>
				</div>
			)}
		</Modal>
	);
}
