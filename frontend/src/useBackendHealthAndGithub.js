import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "./config.js";

async function fetchBackendHealthStatus() {
	try {
		const res = await fetch(`${API_BASE_URL}/api/health-check`);
		if (!res.ok) return { status: "unhealthy", version: "" };
		const data = await res.json();
		if (data.status === "healthy") {
			return { status: "healthy", version: data.kicadVersion || "" };
		}
	} catch (err) {
		console.debug("[Banana] Health check error:", err);
	}
	return { status: "unhealthy", version: "" };
}

const HANDOFF_CODE_RE = /^[0-9a-fA-F]{64}$/;

function parseUrlAuthParams() {
	if (typeof window === "undefined" || !window.location) {
		return { handoff: null, error: null };
	}
	const hashParams = new URLSearchParams(
		window.location.hash ? window.location.hash.replace(/^#\/?/, "") : "",
	);
	return {
		handoff: hashParams.get("github_handoff"),
		error: hashParams.get("github_error"),
	};
}

function clearUrlAuthParams() {
	if (typeof window !== "undefined" && window.history) {
		window.history.replaceState({}, document.title, window.location.pathname);
	}
}

async function exchangeHandoffCode(code) {
	try {
		const res = await fetch(`${API_BASE_URL}/api/auth/github/handoff`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code }),
		});
		if (!res.ok) return null;
		const data = await res.json();
		return data?.token || null;
	} catch (err) {
		// Network or JSON parse failure during handoff
		console.warn("[Banana] GitHub handoff exchange error:", err?.message);
		return null;
	}
}

function getStoredGithubToken() {
	return localStorage.getItem("banana:githubToken") || "";
}

function saveStoredGithubToken(token) {
	if (window.banana?.github?.saveToken) {
		window.banana.github.saveToken(token);
	} else {
		localStorage.setItem("banana:githubToken", token);
	}
}

function clearStoredGithubToken() {
	localStorage.removeItem("banana:githubToken");
	if (window.banana?.github?.clearSavedToken) {
		window.banana.github.clearSavedToken();
	}
}

function saveStoredSourceMode(mode) {
	localStorage.setItem("banana:sourceMode", mode);
}

function saveAuthSession(token, setGithubToken, setSourceMode) {
	saveStoredGithubToken(token);
	setGithubToken(token);
	setSourceMode("github");
	saveStoredSourceMode("github");
}

async function completeHandoff(
	handoff,
	{ setGithubToken, setSourceMode, verifyGithubToken },
) {
	if (!HANDOFF_CODE_RE.test(handoff)) {
		message.error("GitHub sign-in failed");
		return;
	}
	const token = await exchangeHandoffCode(handoff);
	if (!token) {
		message.error("GitHub sign-in failed");
		return;
	}
	saveAuthSession(token, setGithubToken, setSourceMode);
	verifyGithubToken(token);
	message.success("GitHub OAuth login successful!");
}

async function handleUrlAuthCallback({
	setGithubToken,
	setSourceMode,
	verifyGithubToken,
	existingToken,
}) {
	const { handoff, error } = parseUrlAuthParams();

	if (error !== null) {
		clearUrlAuthParams();
		message.error("GitHub sign-in failed");
		return;
	}
	if (handoff !== null) {
		clearUrlAuthParams();
		await completeHandoff(handoff, {
			setGithubToken,
			setSourceMode,
			verifyGithubToken,
		});
		return;
	}
	if (existingToken) {
		verifyGithubToken(existingToken);
	}
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

function isLocalHost() {
	if (typeof window === "undefined") return false;
	const host = window.location.hostname;
	return LOCAL_HOSTNAMES.has(host);
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

async function requestGithubVerify(token) {
	try {
		const res = await fetch(`${API_BASE_URL}/api/auth/github/verify`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		return res.ok ? await res.json() : null;
	} catch (e) {
		console.warn("GitHub token verify error:", e.message);
		return { failed: true };
	}
}

function useVerifyGithubToken(setGithubUser, handleDisconnectGithub) {
	return useCallback(
		async (token) => {
			if (!token) return;
			const data = await requestGithubVerify(token);
			if (data?.failed) return;
			if (data?.authenticated) {
				setGithubUser(data.user);
			} else {
				handleDisconnectGithub();
			}
		},
		[handleDisconnectGithub, setGithubUser],
	);
}

function useAuthSuccess(setGithubToken, setGithubUser, setSourceMode) {
	return useCallback(
		(token, user) => {
			// Desktop keeps the token only in the OS keychain, never in plaintext localStorage
			saveAuthSession(token, setGithubToken, setSourceMode);
			setGithubUser(user);
		},
		[setGithubToken, setSourceMode, setGithubUser],
	);
}

function useSourceMode() {
	const [sourceMode, setSourceMode] = useState(initialSourceMode);
	const handleSourceModeChange = useCallback((val) => {
		setSourceMode(val);
		saveStoredSourceMode(val);
	}, []);
	return { sourceMode, setSourceMode, handleSourceModeChange };
}

function useGithubDialogState() {
	const [githubModalOpen, setGithubModalOpen] = useState(false);
	const [selectedRemoteRepo, setSelectedRemoteRepo] = useState(null);
	return {
		githubModalOpen,
		setGithubModalOpen,
		selectedRemoteRepo,
		setSelectedRemoteRepo,
	};
}

function useGithubAuthActions({
	setGithubToken,
	setGithubUser,
	setSelectedRemoteRepo,
	setSourceMode,
}) {
	const handleDisconnectGithub = useCallback(() => {
		clearStoredGithubToken();
		setGithubToken("");
		setGithubUser(null);
		setSelectedRemoteRepo(null);
		setSourceMode("local");
		saveStoredSourceMode("local");
	}, [setGithubToken, setGithubUser, setSelectedRemoteRepo, setSourceMode]);

	const verifyGithubToken = useVerifyGithubToken(
		setGithubUser,
		handleDisconnectGithub,
	);
	const handleAuthSuccess = useAuthSuccess(
		setGithubToken,
		setGithubUser,
		setSourceMode,
	);

	return { handleDisconnectGithub, verifyGithubToken, handleAuthSuccess };
}

function useGithubSession() {
	const source = useSourceMode();
	const dialog = useGithubDialogState();
	const [githubToken, setGithubToken] = useState(getStoredGithubToken);
	const [githubUser, setGithubUser] = useState(null);

	const actions = useGithubAuthActions({
		setGithubToken,
		setGithubUser,
		setSelectedRemoteRepo: dialog.setSelectedRemoteRepo,
		setSourceMode: source.setSourceMode,
	});

	return {
		props: {
			sourceMode: source.sourceMode,
			githubToken,
			githubUser,
			...dialog,
			handleDisconnectGithub: actions.handleDisconnectGithub,
			handleSourceModeChange: source.handleSourceModeChange,
			handleAuthSuccess: actions.handleAuthSuccess,
		},
		githubToken,
		setGithubToken,
		setSourceMode: source.setSourceMode,
		verifyGithubToken: actions.verifyGithubToken,
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
		...session.props,
		checkHealth: health.checkHealth,
	};
}
