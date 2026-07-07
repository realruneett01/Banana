import dotenv from "dotenv";
dotenv.config({ override: true });
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getSignedCookie, setSignedCookie, deleteCookie } from "hono/cookie";
import crypto from "node:crypto";
import { config } from "./config.ts";
import git from "isomorphic-git";
import fs from "fs";
import path from "path";



const app = new Hono();

interface SessionData {
    access_token?: string;
    github_username?: string;
    github_avatar_url?: string;
}

// In-memory session store (Session ID -> SessionData)
const sessions = new Map<string, SessionData>();

/**
 * GET /auth/github/login
 * Generates HMAC-signed state, redirects to GitHub authorize endpoint.
 */
app.get("/auth/github/login", async (c) => {
    const nonce = crypto.randomUUID();
    const timestamp = Date.now().toString();
    const payload = `${nonce}.${timestamp}`;
    const signature = crypto
        .createHmac("sha256", config.SESSION_SECRET)
        .update(payload)
        .digest("base64url");

    const state = `${payload}.${signature}`;

    // MUST include redirect_uri — must match GitHub OAuth App settings EXACTLY
    const params = new URLSearchParams({
        client_id: config.GITHUB_CLIENT_ID,
        redirect_uri: config.GITHUB_CALLBACK_URL,
        scope: "repo",
        state: state,
    });

    const authorizeUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;

    return c.redirect(authorizeUrl);
});

/**
 * GET /auth/github/callback
 * Verifies state, exchanges code for access token, creates session, redirects home.
 */
app.get("/auth/github/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!state) {
        return c.text("Missing state parameter", 400);
    }

    const parts = state.split(".");
    if (parts.length !== 3) {
        return c.text("Invalid state format", 400);
    }

    const [nonce, timestampStr, signature] = parts;

    if (!/^[A-Za-z0-9_-]+$/.test(signature)) {
        return c.text("Invalid state format", 400);
    }

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
        return c.text("Invalid state format", 400);
    }

    const now = Date.now();
    if (now - timestamp > 10 * 60 * 1000) {
        return c.text("State has expired", 400);
    }
    if (timestamp > now) {
        return c.text("Invalid timestamp", 400);
    }

    const payload = `${nonce}.${timestampStr}`;
    const expectedSignature = crypto
        .createHmac("sha256", config.SESSION_SECRET)
        .update(payload)
        .digest("base64url");

    const sigBuf = Buffer.from(signature, "utf8");
    const expectedBuf = Buffer.from(expectedSignature, "utf8");

    if (sigBuf.length !== expectedBuf.length) {
        return c.text("CSRF validation failed", 400);
    }

    const isValid = crypto.timingSafeEqual(sigBuf, expectedBuf);
    if (!isValid) {
        return c.text("CSRF validation failed", 400);
    }

    if (!code) {
        return c.text("Missing authorization code", 400);
    }

    try {
        // Exchange code for access token
        const tokenResponse = await fetch(
            "https://github.com/login/oauth/access_token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    client_id: config.GITHUB_CLIENT_ID,
                    client_secret: config.GITHUB_CLIENT_SECRET,
                    code,
                    redirect_uri: config.GITHUB_CALLBACK_URL,
                }),
            },
        );

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error("Token exchange failed:", errorText);
            return c.text("Failed to exchange code for token", 500);
        }

        const tokenData = (await tokenResponse.json()) as any;
        const accessToken = tokenData.access_token;
        if (!accessToken) {
            console.error("No access token in response:", tokenData);
            return c.text("No access token returned from GitHub", 500);
        }

        // Fetch user profile
        const userResponse = await fetch("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/vnd.github+json",
                "User-Agent": "KiCanvas-Backend",
            },
        });

        if (!userResponse.ok) {
            return c.text("Failed to fetch user profile from GitHub", 500);
        }

        const userData = (await userResponse.json()) as any;

        // Create session
        const sessionId = crypto.randomUUID();
        sessions.set(sessionId, {
            access_token: accessToken,
            github_username: userData.login,
            github_avatar_url: userData.avatar_url,
        });

        // Set signed session cookie
        await setSignedCookie(
            c,
            "session_id",
            sessionId,
            config.SESSION_SECRET,
            {
                path: "/",
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "Lax",
            },
        );

        return c.redirect(`${config.FRONTEND_URL}/?picker=open`);
    } catch (err: any) {
        console.error("OAuth callback error:", err);
        return c.text(`OAuth callback failed: ${err.message}`, 500);
    }
});

/**
 * GET /auth/me
 */
app.get("/auth/me", async (c) => {
    const sessionId = await getSignedCookie(
        c,
        config.SESSION_SECRET,
        "session_id",
    );
    if (!sessionId) {
        return c.json({ loggedIn: false });
    }

    const session = sessions.get(sessionId);
    if (!session || !session.access_token) {
        return c.json({ loggedIn: false });
    }

    return c.json({
        loggedIn: true,
        username: session.github_username,
        avatar_url: session.github_avatar_url,
    });
});

/**
 * POST /auth/logout
 */
app.post("/auth/logout", async (c) => {
    const sessionId = await getSignedCookie(
        c,
        config.SESSION_SECRET,
        "session_id",
    );
    if (sessionId) {
        sessions.delete(sessionId);
    }
    deleteCookie(c, "session_id", { path: "/" });
    return c.json({ success: true });
});

/**
 * GET /api/repos
 */
app.get("/api/repos", async (c) => {
    const sessionId = await getSignedCookie(
        c,
        config.SESSION_SECRET,
        "session_id",
    );
    if (!sessionId) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const session = sessions.get(sessionId);
    if (!session || !session.access_token) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    try {
        const params = new URLSearchParams();
        params.set("visibility", "all");
        params.set("per_page", "100");
        params.set("sort", "updated");

        const queries = c.req.query();
        for (const [key, val] of Object.entries(queries)) {
            if (val !== undefined) {
                params.set(key, val);
            }
        }

        const reposResponse = await fetch(
            `https://api.github.com/user/repos?${params.toString()}`,
            {
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                    Accept: "application/vnd.github+json",
                    "User-Agent": "KiCanvas-Backend",
                },
            },
        );

        if (reposResponse.status === 401) {
            sessions.delete(sessionId);
            deleteCookie(c, "session_id", { path: "/" });
            return c.json(
                { error: "Session expired, please sign in again" },
                401,
            );
        }

        if (!reposResponse.ok) {
            return c.json(
                { error: "Failed to fetch repositories" },
                reposResponse.status as any,
            );
        }

        const reposData = await reposResponse.json();
        return c.json(reposData);
    } catch (err: any) {
        console.error("Error fetching repositories:", err);
        return c.json({ error: "Internal server error" }, 500);
    }
});

/**
 * GET /api/contents
 */
app.get("/api/contents", async (c) => {
    const sessionId = await getSignedCookie(
        c,
        config.SESSION_SECRET,
        "session_id",
    );
    if (!sessionId) {
        return c.text("Unauthorized", 401);
    }

    const session = sessions.get(sessionId);
    if (!session || !session.access_token) {
        return c.text("Unauthorized", 401);
    }

    const owner = c.req.query("owner");
    const repo = c.req.query("repo");
    const filePath = c.req.query("path");
    const ref = c.req.query("ref");
    const raw = c.req.query("raw") === "true";

    if (!owner || !repo || filePath === undefined) {
        return c.text("Missing owner, repo, or path", 400);
    }

    try {
        const params = new URLSearchParams();
        if (ref) {
            params.set("ref", ref);
        }
        const queryStr = params.toString();
        const githubUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}${queryStr ? "?" + queryStr : ""}`;

        const acceptHeader = raw
            ? "application/vnd.github.raw+json"
            : "application/vnd.github+json";

        const contentResponse = await fetch(githubUrl, {
            headers: {
                Authorization: `Bearer ${session.access_token}`,
                Accept: acceptHeader,
                "User-Agent": "KiCanvas-Backend",
            },
        });

        if (contentResponse.status === 401) {
            sessions.delete(sessionId);
            deleteCookie(c, "session_id", { path: "/" });
            return c.text("Unauthorized", 401);
        }

        if (!contentResponse.ok) {
            return c.text("not found at this ref", 404);
        }

        const contentType =
            contentResponse.headers.get("Content-Type") ||
            "application/octet-stream";
        c.header("Content-Type", contentType);

        const arrayBuffer = await contentResponse.arrayBuffer();
        return c.body(arrayBuffer);
    } catch (err: any) {
        console.error("Error fetching contents:", err);
        return c.text("not found at this ref", 404);
    }
});

/**
 * GET /api/commits
 */
app.get("/api/commits", async (c) => {
    const sessionId = await getSignedCookie(
        c,
        config.SESSION_SECRET,
        "session_id",
    );
    if (!sessionId) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const session = sessions.get(sessionId);
    if (!session || !session.access_token) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const owner = c.req.query("owner");
    const repo = c.req.query("repo");
    const filePath = c.req.query("path");
    const page = c.req.query("page");
    const per_page = c.req.query("per_page");

    if (!owner || !repo) {
        return c.json({ error: "Missing owner or repo" }, 400);
    }

    try {
        const params = new URLSearchParams();
        if (filePath) {
            params.set("path", filePath);
        }
        if (page) {
            params.set("page", page);
        }
        if (per_page) {
            params.set("per_page", per_page);
        }

        const commitsResponse = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/commits?${params.toString()}`,
            {
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                    Accept: "application/vnd.github+json",
                    "User-Agent": "KiCanvas-Backend",
                },
            },
        );

        if (commitsResponse.status === 401) {
            sessions.delete(sessionId);
            deleteCookie(c, "session_id", { path: "/" });
            return c.json(
                { error: "Session expired, please sign in again" },
                401,
            );
        }

        if (!commitsResponse.ok) {
            return c.json(
                { error: "Failed to fetch commits" },
                commitsResponse.status as any,
            );
        }

        const rawCommits = (await commitsResponse.json()) as any[];
        const commits = rawCommits.map((item: any) => ({
            sha: item.sha,
            message: item.commit.message,
            author: item.commit.author?.name ?? item.author?.login ?? "Unknown",
            date: item.commit.author?.date,
        }));

        return c.json(commits);
    } catch (err: any) {
        console.error("Error fetching commits:", err);
        return c.json({ error: "Internal server error" }, 500);
    }
});

// Git local API endpoints
app.get("/api/git/repos", async (c) => {
    const repos = [
        { path: process.cwd(), name: "Banana (Workspace)" },
    ];
    return c.json(repos);
});

app.get("/api/git/refs", async (c) => {
    const repo = c.req.query("repo");
    if (!repo) return c.json({ error: "repo required" }, 400);

    const { execSync } = await import("child_process");

    try {
        const branches = execSync(`git -C "${repo}" branch -a --format="%(refname:short)|%(objectname:short)"`, { encoding: "utf-8" })
            .split("\n")
            .filter(Boolean)
            .map((line) => {
                const [name, sha] = line.split("|");
                return { type: "branch", name, sha };
            });

        const tags = execSync(`git -C "${repo}" tag -l --format="%(refname:short)|%(objectname:short)"`, { encoding: "utf-8" })
            .split("\n")
            .filter(Boolean)
            .map((line) => {
                const [name, sha] = line.split("|");
                return { type: "tag", name, sha };
            });

        return c.json([...branches, ...tags]);
    } catch {
        return c.json({ error: "Failed to list refs" }, 500);
    }
});

app.get("/api/git/tree", async (c) => {
    const repo = c.req.query("repo");
    const ref = c.req.query("ref") || "HEAD";
    const path = c.req.query("path") || "";

    if (!repo) return c.json({ error: "repo required" }, 400);

    const { execSync } = await import("child_process");
    const treePath = path ? `${ref}:${path}` : `${ref}:`;

    try {
        const output = execSync(`git -C "${repo}" ls-tree ${treePath}`, { encoding: "utf-8" });
        const entries = output.split("\n").filter(Boolean).map((line) => {
            const [mode, type, sha, ...pathParts] = line.split(/\s+/);
            return { mode, type, sha, path: pathParts.join(" ") };
        });
        return c.json(entries);
    } catch {
        return c.json({ error: "Failed to read tree" }, 500);
    }
});

// ── Helpers ───────────────────────────────────────────────

async function readFileAtRef(
    repoPath: string,
    ref: string,
    filePath: string
): Promise<Buffer> {
    const commitOid = await git.resolveRef({ fs, dir: repoPath, ref });
    const { commit } = await git.readCommit({ fs, dir: repoPath, oid: commitOid });

    let treeOid = commit.tree;
    const parts = filePath.split('/').filter(Boolean);

    for (let i = 0; i < parts.length; i++) {
        const { tree } = await git.readTree({ fs, dir: repoPath, oid: treeOid });
        const entry = tree.find((e) => e.path === parts[i]);
        if (!entry) {
            throw new Error(`Path not found: ${filePath} (missing ${parts[i]})`);
        }
        if (i === parts.length - 1) {
            const { blob } = await git.readBlob({ fs, dir: repoPath, oid: entry.oid });
            return Buffer.from(blob);
        }
        treeOid = entry.oid;
    }
    throw new Error(`Invalid file path: ${filePath}`);
}

// ── Routes ──────────────────────────────────────────────

app.post('/api/git/init', async (c) => {
    try {
        const body = await c.req.json<{ repoPath?: string }>();
        const repoPath = body?.repoPath;

        if (!repoPath || typeof repoPath !== 'string') {
            return c.json({ error: 'repoPath required' }, 400);
        }

        const gitDir = path.join(repoPath, '.git');
        const hasGit = fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory();

        if (!hasGit) {
            return c.json({ hasGit: false, commits: [], branches: [], tags: [] });
        }

        const [commits, branches, tags] = await Promise.all([
            git.log({ fs, dir: repoPath, depth: 100 }),
            git.listBranches({ fs, dir: repoPath }),
            git.listTags({ fs, dir: repoPath }),
        ]);

        return c.json({ hasGit: true, commits, branches, tags });
    } catch (err) {
        console.error('/api/git/init error:', err);
        return c.json({ error: (err as Error).message }, 500);
    }
});

app.get('/api/git/log', async (c) => {
    try {
        const repoPath = c.req.query('repoPath');
        const filePath = c.req.query('filePath');

        if (!repoPath) {
            return c.json({ error: 'repoPath required' }, 400);
        }

        const commits = await git.log({
            fs,
            dir: repoPath,
            filepath: filePath || undefined,
            depth: 100,
        });

        return c.json({ commits });
    } catch (err) {
        console.error('/api/git/log error:', err);
        return c.json({ error: (err as Error).message }, 500);
    }
});

app.get('/api/git/blob', async (c) => {
    try {
        const repoPath = c.req.query('repoPath');
        const ref = c.req.query('ref');
        const filePath = c.req.query('filePath');

        if (!repoPath || !ref || !filePath) {
            return c.json({ error: 'repoPath, ref, and filePath required' }, 400);
        }

        const content = await readFileAtRef(repoPath, ref, filePath);
        c.header('Content-Type', 'text/plain; charset=utf-8');
        return c.body(content);
    } catch (err) {
        console.error('/api/git/blob error:', err);
        return c.json({ error: (err as Error).message }, 500);
    }
});

// Serve static assets
app.use(
    "/images/*",
    serveStatic({
        root: "./docs/docs/images",
        rewriteRequestPath: (path) => path.replace(/^\/images/, ""),
    }),
);

// Serve frontend static assets
app.use("/*", serveStatic({ root: "./debug" }));

// Graceful shutdown for dev server restarts
process.on("SIGTERM", () => {
    console.log("[backend] SIGTERM received, shutting down gracefully");
    process.exit(0);
});

process.on("SIGINT", () => {
    console.log("[backend] SIGINT received, shutting down gracefully");
    process.exit(0);
});

// Start server
const port = config.PORT;
serve({
    fetch: app.fetch,
    port: port,
});
console.log(`[backend] server listening at http://localhost:${port}`);

export { app };