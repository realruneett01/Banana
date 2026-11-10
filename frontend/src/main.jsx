import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { API_BASE_URL } from "./config.js";

function getRequestUrl(input) {
	const raw = input instanceof Request ? input.url : String(input);
	return new URL(raw, window.location.href);
}

function isApiRequest(url, apiOrigin) {
	return url.origin === apiOrigin && url.pathname.startsWith("/api");
}

function attachAuthHeader(input, init, token) {
	const existing =
		init.headers || (input instanceof Request ? input.headers : {});
	const headers = new Headers(existing);
	if (!headers.has("x-banana-auth")) {
		headers.set("x-banana-auth", token);
	}
	return { ...init, headers };
}

async function resolveRequestInit(input, init, apiOrigin, tokenPromise) {
	try {
		const url = getRequestUrl(input);
		if (!isApiRequest(url, apiOrigin)) {
			return init;
		}
		const token = await tokenPromise;
		if (token) {
			return attachAuthHeader(input, init, token);
		}
	} catch (err) {
		console.warn("Failed to attach auth token:", err);
	}
	return init;
}

// Desktop hardening: automatically attach local security token to /api requests
if (typeof window !== "undefined" && window.banana?.getApiToken) {
	const originalFetch = window.fetch;
	const tokenPromise = window.banana.getApiToken().catch(() => null);
	const apiOrigin = new URL(API_BASE_URL || "/", window.location.href).origin;
	window.fetch = async (input, init = {}) => {
		const resolvedInit = await resolveRequestInit(
			input,
			init,
			apiOrigin,
			tokenPromise,
		);
		return originalFetch(input, resolvedInit);
	};
}

createRoot(document.getElementById("root")).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
