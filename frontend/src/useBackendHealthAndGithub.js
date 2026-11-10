import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "./config.js";

async function fetchBackendHealthStatus() {
	try {
		const res = await fetch(`${API_BASE_URL}/api/health-check`);
		if (res.ok) {
			const data = await res.json();
			if (data.status === "healthy") {
				return { status: "healthy", version: data.kicadVersion || "" };
			}
		}
	} catch (err) {
		console.debug("[Banana] Health check error:", err);
	}
	return { status: "unhealthy", version: "" };
}

function handleUrlAuthCallback({
	setGithubToken,
	setSourceMode,
	verifyGithubToken,
	existingToken,
}) {
	const params = new URLSearchParams(window.location.search);
	const tokenFromUrl = params.get("github_token");
	const errorFromUrl = params.get("github_error");

	if (tokenFromUrl) {
		localStorage.setItem("banana:githubToken", tokenFromUrl);
		setGithubToken(tokenFromUrl);
		setSourceMode("github");
		localStorage.setItem("banana:sourceMode", "github");
		verifyGithubToken(tokenFromUrl);
		window.history.replaceState({}, document.title, window.location.pathname);
		message.success("GitHub OAuth login successful!");
	} else if (errorFromUrl) {
		message.error(`GitHub login error: ${errorFromUrl}`);
		window.history.replaceState({}, document.title, window.location.pathname);
	} else if (existingToken) {
		verifyGithubToken(existingToken);
	}
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

function isLocalHost() {
	if (typeof window === "undefined") return false;
	const host = window.location.hostname;
	return LOCAL_HOSTNAMES.has(host) || host.endsWith(".local");
}

function initialSourceMode() {
	return (
		localStorage.getItem("banana:sourceMode") ||
		(isLocalHost() ? "local" : "github")
	);
}

function loadDesktopSavedToken({ setGithubToken, verifyGithubToken }) {
	if (!window.banana?.github?.getSavedToken) return;
	window.banana.github
		.getSavedToken()
		.then((saved) => {
			if (saved) {
				setGithubToken(saved);
				verifyGithubToken(saved);
			}
		})
		.catch((err) =>
			console.warn("[Banana] Could not load saved GitHub token:", err?.message),
		);
}

function useBackendHealth() {
	const [backendStatus, setBackendStatus] = useState("checking"); // checking | healthy | unhealthy
	const [kicadVersion, setKicadVersion] = useState("");

	const checkHealth = useCallback(async () => {
		setBackendStatus("checking");
		const result = await fetchBackendHealthStatus();
		setBackendStatus(result.status);
		setKicadVersion(result.version);
	}, []);

	return { backendStatus, kicadVersion, checkHealth };
}

function useGithubSession() {
	const [sourceMode, setSourceMode] = useState(initialSourceMode);
	const [githubToken, setGithubToken] = useState(
		localStorage.getItem("banana:githubToken") || "",
	);
	const [githubUser, setGithubUser] = useState(null);
	const [githubModalOpen, setGithubModalOpen] = useState(false);
	const [selectedRemoteRepo, setSelectedRemoteRepo] = useState(null);

	const handleDisconnectGithub = useCallback(() => {
		localStorage.removeItem("banana:githubToken");
		if (window.banana?.github?.clearSavedToken) {
			window.banana.github.clearSavedToken();
		}
		setGithubToken("");
		setGithubUser(null);
		setSelectedRemoteRepo(null);
		setSourceMode("local");
		localStorage.setItem("banana:sourceMode", "local");
	}, []);

	const verifyGithubToken = useCallback(
		async (token) => {
			if (!token) return;
			try {
				const res = await fetch(`${API_BASE_URL}/api/auth/github/verify`, {
					headers: { Authorization: `Bearer ${token}` },
				});
				const data = res.ok ? await res.json() : null;
				if (data?.authenticated) {
					setGithubUser(data.user);
				} else {
					handleDisconnectGithub();
				}
			} catch (e) {
				console.warn("GitHub token verify error:", e.message);
			}
		},
		[handleDisconnectGithub],
	);

	const handleSourceModeChange = useCallback((val) => {
		setSourceMode(val);
		localStorage.setItem("banana:sourceMode", val);
	}, []);

	const handleAuthSuccess = useCallback((token, user) => {
		// Desktop keeps the token only in the OS keychain, never in plaintext localStorage
		if (window.banana?.github?.saveToken) {
			window.banana.github.saveToken(token);
		} else {
			localStorage.setItem("banana:githubToken", token);
		}
		setGithubToken(token);
		setGithubUser(user);
		setSourceMode("github");
		localStorage.setItem("banana:sourceMode", "github");
	}, []);

	return {
		sourceMode,
		setSourceMode,
		githubToken,
		setGithubToken,
		githubUser,
		githubModalOpen,
		setGithubModalOpen,
		selectedRemoteRepo,
		setSelectedRemoteRepo,
		handleDisconnectGithub,
		verifyGithubToken,
		handleSourceModeChange,
		handleAuthSuccess,
	};
}

export function useBackendHealthAndGithub({ onMountRepoInit }) {
	const health = useBackendHealth();
	const session = useGithubSession();

	// biome-ignore lint/correctness/useExhaustiveDependencies: onMount initialization only
	useEffect(() => {
		health.checkHealth();
		if (onMountRepoInit) onMountRepoInit();
		loadDesktopSavedToken(session);
		handleUrlAuthCallback({
			setGithubToken: session.setGithubToken,
			setSourceMode: session.setSourceMode,
			verifyGithubToken: session.verifyGithubToken,
			existingToken: session.githubToken,
		});
	}, []);

	return {
		backendStatus: health.backendStatus,
		kicadVersion: health.kicadVersion,
		sourceMode: session.sourceMode,
		githubToken: session.githubToken,
		githubUser: session.githubUser,
		githubModalOpen: session.githubModalOpen,
		setGithubModalOpen: session.setGithubModalOpen,
		selectedRemoteRepo: session.selectedRemoteRepo,
		setSelectedRemoteRepo: session.setSelectedRemoteRepo,
		handleDisconnectGithub: session.handleDisconnectGithub,
		handleSourceModeChange: session.handleSourceModeChange,
		handleAuthSuccess: session.handleAuthSuccess,
		checkHealth: health.checkHealth,
	};
}
