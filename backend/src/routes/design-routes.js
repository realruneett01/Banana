import { DesignError } from "../design/model.js";
import { createSafeRouter } from "../safe-router.js";
import { handleMessage } from "../mcp/protocol.js";
import { callTool, toolList } from "../mcp/tools.js";
import {
	diffBuilds,
	diffWorking,
	listProjects,
	projectState,
	viewSvg,
} from "../design/project.js";

const router = createSafeRouter();

/** GET /api/design/tools - the tool catalogue (same tools the MCP server exposes). */
router.get("/tools", (_req, res) => res.json({ tools: toolList() }));

router.get("/projects", (_req, res) => res.json({ projects: listProjects() }));

/** POST /api/design/tools/:name - run one tool with a JSON body of arguments. */
router.post("/tools/:name", async (req, res) => {
	const r = await callTool(req.params.name, req.body);
	if (r.ok) return res.json(r.result);
	const status =
		r.code === "unknown_tool" ? 404 : r.code === "internal" ? 500 : 400;
	res.status(status).json({ error: r.error, code: r.code, details: r.details });
});

/**
 * POST /api/design/mcp - MCP over HTTP (stateless JSON responses), so remote assistants can use the
 * same tools. Protected by the server's normal login or access token.
 */
router.post("/mcp", async (req, res) => {
	const body = req.body;
	if (Array.isArray(body)) {
		const replies = (await Promise.all(body.map(handleMessage))).filter(
			Boolean,
		);
		return replies.length ? res.json(replies) : res.status(202).end();
	}
	const reply = await handleMessage(body);
	return reply ? res.json(reply) : res.status(202).end();
});

const one = (v) => {
	if (v === undefined || typeof v === "string") return v;
	throw new DesignError("Query parameters must be single values");
};

/** GET /api/design/projects/:name/state - design, placements, courtyards, pads and the mm to SVG transform for overlays. */
router.get("/projects/:name/state", async (req, res) =>
	res.json(await projectState(req.params.name)),
);

/** GET /api/design/projects/:name/view/:kind.svg?view=front|back|all&rev=working|<commit> - KiCad's own rendering. */
router.get("/projects/:name/view/:kind.svg", async (req, res) => {
	const r = await viewSvg(req.params.name, {
		kind: req.params.kind,
		view: one(req.query.view) ?? "front",
		rev: one(req.query.rev) ?? "working",
	});
	res.set({
		"Content-Type": "image/svg+xml; charset=utf-8",
		"Cache-Control": "no-store",
		"X-Banana-Cached": String(Boolean(r.cached)),
	});
	res.send(r.svg);
});

/**
 * GET /api/design/projects/:name/changes?base=&target=&file=board|schematic
 * Same payload as /api/diff/process (yellow/green/red + grey rendering data); target=working compares the live design.
 */
router.get("/projects/:name/changes", async (req, res) => {
	const base = one(req.query.base) ?? "HEAD~1";
	const target = one(req.query.target) ?? "HEAD";
	const file = one(req.query.file) ?? "board";
	const payload =
		target === "working"
			? await diffWorking(req.params.name, {
					base: one(req.query.base) ?? "HEAD",
					file,
				})
			: await diffBuilds(req.params.name, { base, target, file });
	res.json(payload);
});

export default router;
