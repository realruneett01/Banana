import { DesignError } from "../design/model.js";
import { createSafeRouter } from "../safe-router.js";
import { handleMessage } from "../mcp/protocol.js";
import { callTool, toolList } from "../mcp/tools.js";
import { AGENT_LIMITS, runAgent } from "../design/agent.js";
import { exportFile, exportKinds, runExport } from "../design/exports.js";
import { config } from "../config.js";
import { getCapabilities } from "../kicad-compat.js";
import {
	diffBuilds,
	diffWorking,
	listProjects,
	projectDir,
	projectState,
	redo,
	undo,
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

/** GET /api/design/exports - which exports this KiCad can produce (from its own help output). */
router.get("/exports", (_req, res) =>
	res.json({
		kinds: exportKinds(
			getCapabilities({
				cliPath: config.kicadCliPath,
				version: config.kicadVersion,
			}),
		),
	}),
);
/** POST /api/design/projects/:name/export/:kind - build the files without committing, run the export. */
router.post("/projects/:name/export/:kind", async (req, res) =>
	res.json(await runExport(req.params.name, req.params.kind)),
);
/** GET /api/design/projects/:name/export/:kind/:file - download one produced file. */
router.get("/projects/:name/export/:kind/:file", (req, res) => {
	const full = exportFile(req.params.name, req.params.kind, req.params.file);
	res.download(full, req.params.file);
});

router.post("/projects/:name/undo", async (req, res) =>
	res.json(await undo(req.params.name)),
);
router.post("/projects/:name/redo", async (req, res) =>
	res.json(await redo(req.params.name)),
);

const agentRuns = new Set();

/**
 * POST /api/design/agent  { project, messages: [{role, content}], model? }  header x-gemini-api-key
 * Server-sent events: text, tool_call, tool_result, design_changed, done, error. One run per project at a time.
 */
router.post("/agent", async (req, res) => {
	const { project, messages, model } = req.body ?? {};
	projectDir(project); // validates the name (400)
	if (
		!Array.isArray(messages) ||
		messages.length === 0 ||
		messages.length > AGENT_LIMITS.maxMessages * 2 ||
		messages.some(
			(m) =>
				!m ||
				typeof m !== "object" ||
				typeof (m.content ?? m.text) !== "string" ||
				!["user", "assistant", "model"].includes(m.role),
		)
	)
		throw new DesignError(
			"messages must be a non-empty list of {role: user|assistant, content: string}",
		);
	if (model !== undefined && !/^[A-Za-z0-9._-]{1,100}$/.test(String(model)))
		throw new DesignError("Invalid model name");
	const apiKey = req.get("x-gemini-api-key") || undefined;
	if (agentRuns.has(project)) {
		res
			.status(409)
			.json({ error: "The assistant is already working on this project." });
		return;
	}
	agentRuns.add(project);

	res.set({
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
		"X-Accel-Buffering": "no",
	});
	res.flushHeaders?.();
	const send = (event, data) => {
		if (!res.writableEnded)
			res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
	};
	const controller = new AbortController();
	res.on("close", () => {
		if (!res.writableFinished) controller.abort();
	});
	const beat = setInterval(() => {
		if (!res.writableEnded) res.write(": keep-alive\n\n");
	}, 15000);
	try {
		await runAgent({
			project,
			messages,
			apiKey,
			model,
			emit: send,
			signal: controller.signal,
		});
	} catch (err) {
		send("error", {
			message: err.message,
			code: /GEMINI_API_KEY_REQUIRED/.test(err.message)
				? "key_required"
				: "error",
		});
		send("done", { stopped: "error", changed: false, steps: 0 });
	} finally {
		clearInterval(beat);
		agentRuns.delete(project);
		res.end();
	}
});

export default router;
