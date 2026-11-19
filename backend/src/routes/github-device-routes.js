import express from "express";
import { createRateLimiter } from "../rate-limit.js";

const DEFAULT_CLIENT_ID = "Ov23liZc6GZz7Cg8Y1sZ";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEVICE_CODE_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const GITHUB_TIMEOUT_MS = 10000;
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX = 30;

function isValidDeviceCode(code) {
	if (typeof code !== "string") return false;
	return DEVICE_CODE_PATTERN.test(code);
}

function logUpstreamFailure(res) {
	if (!res.ok) {
		console.error(
			`[GitHub Device Flow] Upstream failed with status ${res.status}`,
		);
	}
}

async function postToGithub(url, payload, fetchImpl) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
	try {
		return await fetchImpl(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(payload),
			redirect: "error",
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
}

async function dispatchGithubPost(res, url, payload, fetchImpl) {
	let upstreamRes;
	try {
		upstreamRes = await postToGithub(url, payload, fetchImpl);
	} catch {
		// Catch network failure, timeout or redirect errors
		return res.status(502).json({ error: "GitHub unreachable" });
	}

	let data;
	try {
		data = await upstreamRes.json();
	} catch {
		// Catch non-JSON upstream response body
		return res.status(502).json({ error: "GitHub unreachable" });
	}

	logUpstreamFailure(upstreamRes);
	return res.status(upstreamRes.status).json(data);
}

async function handleDeviceCode(_req, res, clientId, fetchImpl) {
	const payload = {
		client_id: clientId,
		scope: "repo,read:user",
	};
	return dispatchGithubPost(res, GITHUB_DEVICE_CODE_URL, payload, fetchImpl);
}

async function handleDeviceToken(req, res, clientId, fetchImpl) {
	const code = req.body?.device_code;
	if (!isValidDeviceCode(code)) {
		return res.status(400).json({ error: "Invalid device_code" });
	}
	const payload = {
		client_id: clientId,
		device_code: code,
		grant_type: "urn:ietf:params:oauth:grant-type:device_code",
	};
	return dispatchGithubPost(res, GITHUB_ACCESS_TOKEN_URL, payload, fetchImpl);
}

function setNoStore(_req, res, next) {
	res.setHeader("Cache-Control", "no-store");
	next();
}

export function createGithubDeviceRouter(options = {}) {
	const fetchImpl = options.fetchImpl || globalThis.fetch;
	const clientId =
		options.clientId || process.env.GITHUB_CLIENT_ID || DEFAULT_CLIENT_ID;
	const limiter = createRateLimiter({
		windowMs: RATE_LIMIT_WINDOW_MS,
		max: RATE_LIMIT_MAX,
		...(options.now ? { now: options.now } : {}),
	});

	const router = express.Router();
	router.post(
		["/github/device/code", "/api/github/device/code"],
		setNoStore,
		limiter,
		(req, res) => handleDeviceCode(req, res, clientId, fetchImpl),
	);
	router.post(
		["/github/device/token", "/api/github/device/token"],
		setNoStore,
		limiter,
		(req, res) => handleDeviceToken(req, res, clientId, fetchImpl),
	);

	return router;
}

const defaultRouter = createGithubDeviceRouter();
export default defaultRouter;
