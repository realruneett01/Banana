import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { API_BASE_URL } from "./config.js";

// Desktop hardening: automatically attach local security token to /api requests
if (typeof window !== "undefined" && window.banana?.getApiToken) {
	const originalFetch = window.fetch;
	const tokenPromise = window.banana.getApiToken().catch(() => null);
	const apiOrigin = new URL(API_BASE_URL || "/", window.location.href).origin;
	window.fetch = async (input, init = {}) => {
		try {
			const url = new URL(
				input instanceof Request ? input.url : String(input),
				window.location.href,
			);
			const token =
				url.origin === apiOrigin && url.pathname.startsWith("/api")
					? await tokenPromise
					: null;
			if (token) {
				const headers = new Headers(
					init.headers || (input instanceof Request ? input.headers : {}),
				);
				if (!headers.has("x-banana-auth")) {
					headers.set("x-banana-auth", token);
				}
				init = { ...init, headers };
			}
		} catch {}
		return originalFetch(input, init);
	};
}

createRoot(document.getElementById("root")).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
