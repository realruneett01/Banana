import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getSignedCookie, setSignedCookie, deleteCookie } from "hono/cookie";
import crypto from "node:crypto";
import { config } from "./config.ts";

const app = new Hono();

interface SessionData {
    access_token?: string;
    github_username?: string;
    github_avatar_url?: string;
    state?: string;
}

// In-memory session store (Session ID -> SessionData)
const sessions = new Map<string, SessionData>();

/**
 * GET /auth/github/login
 * Generates state, redirects to GitHub authorize endpoint.
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

    const redirectUri = encodeURIComponent(config.GITHUB_CALLBACK_URL);
    const authorizeUrl = `https://github.com/login/oauth/authorize?client_id=${config.GITHUB_CLIENT_ID}&redirect_uri=${redirectUri}&scope=repo&state=${state}`;

    return c.redirect(authorizeUrl);
});

/**
 * GET /auth/github/callback
 * Verifies state, exchanges code for access token, fetches profile, and redirects home.
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

    // Validate signature is well-formed base64url
    if (!/^[A-Za-z0-9_-]+$/.test(signature)) {
        return c.text("Invalid state format", 400);
    }

    // Parse timestamp
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
        return c.text("Invalid state format", 400);
    }

    const now = Date.now();
    // Expiration check (10 minutes in the past)
    if (now - timestamp > 10 * 60 * 1000) {
        return c.text("State has expired or is invalid", 400);
    }

    // Anti-future-timestamp check
    if (timestamp > now) {
        return c.text("State has expired or is invalid", 400);
    }

    // Recompute and verify HMAC signature
    const payload = `${nonce}.${timestampStr}`;
    const expectedSignature = crypto
        .createHmac("sha256", config.SESSION_SECRET)
        .update(payload)
        .digest("base64url");

    const sigBuf = Buffer.from(signature, "utf8");
    const expectedBuf = Buffer.from(expectedSignature, "utf8");

    const isValid = sigBuf.length === expectedBuf.length &&
                    crypto.timingSafeEqual(sigBuf, expectedBuf);

    if (!isValid) {
        return c.text("CSRF validation failed", 400);
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
            return c.text("Failed to exchange code for token", 500);
        }

        const tokenData = (await tokenResponse.json()) as any;
        const accessToken = tokenData.access_token;
        if (!accessToken) {
            return c.text("No access token returned from GitHub", 500);
        }

        // Fetch user profile info
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

        // Generate a fresh session ID only after token exchange and profile fetch succeed
        const sessionId = crypto.randomUUID();

        // Save access token and user info to session
        sessions.set(sessionId, {
            access_token: accessToken,
            github_username: userData.login,
            github_avatar_url: userData.avatar_url,
        });

        // Set signed session ID cookie (session-only, no maxAge/expires)
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

        return c.redirect(config.FRONTEND_URL);
    } catch (err: any) {
        console.error("OAuth callback error:", err);
        return c.text(`OAuth callback failed: ${err.message}`, 500);
    }
});

/**
 * GET /auth/me
 * Reads session cookie and returns user details. Never leaks token.
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
 * Deletes session and clears the cookie.
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
 * Proxy endpoint to list authenticated user's repositories.
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

        // Merge existing query parameters from the request
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
 * Proxy endpoint to fetch a file's raw contents securely.
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

    if (!owner || !repo || !filePath) {
        return c.text("Missing owner, repo, or path", 400);
    }

    try {
        const params = new URLSearchParams();
        if (ref) {
            params.set("ref", ref);
        }
        const queryStr = params.toString();
        const githubUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}${queryStr ? "?" + queryStr : ""}`;

        const contentResponse = await fetch(githubUrl, {
            headers: {
                Authorization: `Bearer ${session.access_token}`,
                Accept: "application/vnd.github.raw+json",
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
 * Proxy endpoint to fetch commits that touched a specific file.
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

// Serve static assets from the docs/docs/images folder for /images/* pathing
app.use(
    "/images/*",
    serveStatic({
        root: "./docs/docs/images",
        rewriteRequestPath: (path) => path.replace(/^\/images/, ""),
    }),
);

// Serve frontend static assets from the esbuild output directory
app.use("/*", serveStatic({ root: "./debug" }));

// Start the server using @hono/node-server
const port = config.PORT;
serve({
    fetch: app.fetch,
    port: port,
});
console.log(`[backend] server listening at http://localhost:${port}`);

export { app };
