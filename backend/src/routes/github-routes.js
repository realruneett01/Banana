import express from "express";
import {
	exchangeCodeForToken,
	getOAuthAuthorizeUrl,
	getRepoBranches,
	getRepoCommits,
	getRepoHardwareFiles,
	getRepoPullRequests,
	getUserRepositories,
	verifyTokenAndGetUser,
} from "../github-service.js";

const router = express.Router();

function getDynamicOrigin(req) {
	const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
	const host = req.headers["x-forwarded-host"] || req.get("host");
	return `${protocol}://${host}`;
}

// 1. Get OAuth login URL
router.get("/auth/github/url", (req, res) => {
	try {
		const dynamicOrigin = getDynamicOrigin(req);
		const dynamicCallback =
			process.env.GITHUB_CALLBACK_URL &&
			!process.env.GITHUB_CALLBACK_URL.includes("localhost")
				? process.env.GITHUB_CALLBACK_URL
				: `${dynamicOrigin}/api/auth/github/callback`;

		const url = getOAuthAuthorizeUrl(
			req.query.state || "banana_auth",
			dynamicCallback,
		);
		res.json({ url, configured: true });
	} catch (err) {
		res.json({ configured: false, error: err.message });
	}
});

// 2. OAuth Callback
router.get("/auth/github/callback", async (req, res) => {
	const { code } = req.query;
	if (!code) {
		return res.status(400).send("Authorization code missing");
	}

	const dynamicOrigin = getDynamicOrigin(req);
	const targetFrontend =
		process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes("localhost")
			? process.env.FRONTEND_URL.trim().replace(/\/+$/, "")
			: dynamicOrigin;

	try {
		const token = await exchangeCodeForToken(code);
		const redirectUrl = `${targetFrontend}/?github_token=${encodeURIComponent(token)}`;
		res.redirect(redirectUrl);
	} catch (err) {
		console.error("[Banana API] GitHub OAuth callback error:", err);
		res.redirect(
			`${targetFrontend}/?github_error=${encodeURIComponent(err.message)}`,
		);
	}
});

// 3. Verify Token & Get User
router.get("/auth/github/verify", async (req, res) => {
	const token =
		req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.token;
	if (!token) {
		return res.status(401).json({ error: "GitHub token required" });
	}
	try {
		const user = await verifyTokenAndGetUser(token);
		res.json({ authenticated: true, user });
	} catch (err) {
		res.status(401).json({ authenticated: false, error: err.message });
	}
});

// 4. List User Repositories
router.get("/github/repos", async (req, res) => {
	const token =
		req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.token;
	if (!token) return res.status(401).json({ error: "GitHub token required" });

	try {
		const page = parseInt(req.query.page, 10) || 1;
		const repos = await getUserRepositories(token, page);
		res.json({ repos });
	} catch (err) {
		res
			.status(500)
			.json({ error: "Failed to list repositories", details: err.message });
	}
});

// 5. Get Repo Branches
router.get("/github/repos/:owner/:repo/branches", async (req, res) => {
	const token =
		req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.token;
	const { owner, repo } = req.params;
	if (!token) return res.status(401).json({ error: "GitHub token required" });

	try {
		const branches = await getRepoBranches(token, owner, repo);
		res.json({ branches });
	} catch (err) {
		res
			.status(500)
			.json({ error: "Failed to fetch branches", details: err.message });
	}
});

// 6. Get Repo Commits
router.get("/github/repos/:owner/:repo/commits", async (req, res) => {
	const token =
		req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.token;
	const { owner, repo } = req.params;
	const { sha, path: filePath } = req.query;
	if (!token) return res.status(401).json({ error: "GitHub token required" });

	try {
		const commits = await getRepoCommits(token, owner, repo, { sha, filePath });
		res.json({ commits });
	} catch (err) {
		res
			.status(500)
			.json({ error: "Failed to fetch commits", details: err.message });
	}
});

// 7. Get Repo Pull Requests
router.get("/github/repos/:owner/:repo/pulls", async (req, res) => {
	const token =
		req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.token;
	const { owner, repo } = req.params;
	const state = req.query.state || "open";
	if (!token) return res.status(401).json({ error: "GitHub token required" });

	try {
		const pulls = await getRepoPullRequests(token, owner, repo, state);
		res.json({ pulls });
	} catch (err) {
		res
			.status(500)
			.json({ error: "Failed to fetch pull requests", details: err.message });
	}
});

// 8. Get Repo Hardware Files (.kicad_pcb / .kicad_sch)
router.get("/github/repos/:owner/:repo/files", async (req, res) => {
	const token =
		req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.token;
	const { owner, repo } = req.params;
	const ref = req.query.ref || "main";
	if (!token) return res.status(401).json({ error: "GitHub token required" });

	try {
		const files = await getRepoHardwareFiles(token, owner, repo, ref);
		res.json({ files });
	} catch (err) {
		res.status(500).json({
			error: "Failed to fetch hardware files from repository",
			details: err.message,
		});
	}
});

export default router;
