import { createSafeRouter } from "../safe-router.js";
import { handleMessage } from "../mcp/protocol.js";
import { callTool, toolList } from "../mcp/tools.js";
import { listProjects } from "../design/project.js";

const router = createSafeRouter();

/** GET /api/design/tools - the tool catalogue (same tools the MCP server exposes). */
router.get("/tools", (_req, res) => res.json({ tools: toolList() }));

router.get("/projects", (_req, res) => res.json({ projects: listProjects() }));

/** POST /api/design/tools/:name - run one tool with a JSON body of arguments. */
router.post("/tools/:name", async (req, res) => {
	const r = await callTool(req.params.name, req.body);
	if (r.ok) return res.json(r.result);
	const status = r.code === "unknown_tool" ? 404 : r.code === "internal" ? 500 : 400;
	res.status(status).json({ error: r.error, code: r.code, details: r.details });
});

/**
 * POST /api/design/mcp - MCP over HTTP (stateless JSON responses), so remote assistants can use the
 * same tools. Protected by the server's normal login or access token.
 */
router.post("/mcp", async (req, res) => {
	const body = req.body;
	if (Array.isArray(body)) {
		const replies = (await Promise.all(body.map(handleMessage))).filter(Boolean);
		return replies.length ? res.json(replies) : res.status(202).end();
	}
	const reply = await handleMessage(body);
	return reply ? res.json(reply) : res.status(202).end();
});

export default router;
